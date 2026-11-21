-- =====================================================================
-- Funcionário 24h — Fundação: organizações, perfis, membros, planos,
-- assinaturas, administradores da plataforma e funções de autorização.
-- =====================================================================

create extension if not exists pgcrypto;

-- Schema privado: funções auxiliares de autorização. Não é exposto pela API
-- do Supabase (PostgREST expõe apenas "public" por padrão).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Planos (configuráveis pelo administrador da plataforma)
-- ---------------------------------------------------------------------
create table public.plans (
  id                    text primary key,
  name                  text not null,
  description           text,
  price_cents           integer not null check (price_cents >= 0),
  currency              text not null default 'BRL',
  max_employees         integer not null check (max_employees > 0),
  max_whatsapp_numbers  integer not null check (max_whatsapp_numbers > 0),
  monthly_ai_tokens     bigint not null check (monthly_ai_tokens > 0),
  features              jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Organizações (tenants)
-- ---------------------------------------------------------------------
create table public.organizations (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (char_length(name) between 2 and 120),
  segment                  text,
  description              text,
  address                  text,
  business_hours           text,
  phone                    text,
  website                  text,
  timezone                 text not null default 'America/Sao_Paulo',
  status                   text not null default 'active'
                             check (status in ('active', 'suspended')),
  suspended_reason         text,
  onboarding_step          smallint not null default 1 check (onboarding_step between 1 and 9),
  onboarding_completed_at  timestamptz,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations (created_by);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Membros das organizações
--   owner  : tudo, inclusive cobrança e membros
--   admin  : configura funcionários, base, integrações, decide aprovações
--   agent  : atendente humano (conversas, contatos, CRM)
--   viewer : somente leitura
-- ---------------------------------------------------------------------
create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('owner', 'admin', 'agent', 'viewer')),
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- ---------------------------------------------------------------------
-- Assinaturas (uma por organização)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null unique references public.organizations (id) on delete cascade,
  plan_id                   text not null references public.plans (id),
  status                    text not null default 'trialing'
                              check (status in ('trialing', 'active', 'past_due', 'canceled', 'suspended')),
  trial_ends_at             timestamptz,
  current_period_start      timestamptz not null default now(),
  current_period_end        timestamptz not null default (now() + interval '1 month'),
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  cancel_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index subscriptions_plan_idx on public.subscriptions (plan_id);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Administradores da plataforma (equipe Funcionário 24h)
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Auditoria (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_type       text not null check (actor_type in ('user', 'employee', 'system', 'platform_admin')),
  actor_id         uuid,
  action           text not null,
  entity_type      text,
  entity_id        uuid,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funções de autorização (usadas nas policies RLS)
-- security definer + search_path vazio evita recursão de RLS e sequestro
-- de search_path. "(select auth.uid())" é avaliado uma vez por consulta.
-- ---------------------------------------------------------------------
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

create or replace function private.write_audit(
  p_org uuid, p_actor_type text, p_actor uuid, p_action text,
  p_entity_type text, p_entity uuid, p_meta jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, p_actor_type, p_actor, p_action, p_entity_type, p_entity, coalesce(p_meta, '{}'::jsonb));
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.is_platform_admin() to authenticated, service_role;

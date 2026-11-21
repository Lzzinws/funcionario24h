-- =====================================================================
-- Funcionários digitais, instruções versionadas e base de conhecimento
-- =====================================================================

-- Catálogo global de modelos (Atendente, Vendedor, Agendador, ...)
create table public.employee_templates (
  id                    text primary key,
  role_type             text not null,
  name                  text not null,
  title                 text not null,
  description           text not null,
  default_personality   text not null,
  default_instructions  text not null,
  default_goals         text[] not null default '{}',
  default_tools         text[] not null default '{}',
  default_permissions   jsonb not null default '{}'::jsonb,
  is_available          boolean not null default true,
  sort_order            integer not null default 0
);

create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  template_id      text references public.employee_templates (id),
  role_type        text not null check (role_type in (
                     'atendente', 'vendedor', 'agendador', 'administrativo',
                     'pos_venda', 'financeiro', 'marketing', 'personalizado')),
  name             text not null check (char_length(name) between 2 and 60),
  title            text not null check (char_length(title) between 2 and 80),
  personality      text not null default '' check (char_length(personality) <= 2000),
  goals            text[] not null default '{}',
  -- Ferramentas que o funcionário pode usar (allowlist).
  tools            text[] not null default '{}',
  -- Política por ferramenta: "auto" | "approval" | "denied".
  permissions      jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  is_active        boolean not null default false,
  -- Funcionário que recebe primeiro as novas conversas.
  is_default       boolean not null default false,
  color            text not null default '#65D69B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);
create index employees_org_idx on public.employees (organization_id);
create index employees_template_idx on public.employees (template_id);
create unique index employees_one_default_per_org
  on public.employees (organization_id) where is_default;
create trigger employees_updated_at before update on public.employees
  for each row execute function private.set_updated_at();

-- Instruções versionadas: cada alteração gera uma nova versão (auditável).
create table public.employee_instructions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  version          integer not null check (version > 0),
  content          text not null check (char_length(content) <= 8000),
  is_current       boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (employee_id, version)
);
create index employee_instructions_org_idx on public.employee_instructions (organization_id);
create unique index employee_instructions_one_current
  on public.employee_instructions (employee_id) where is_current;

-- Garante coerência: a organização da instrução é a do funcionário,
-- a versão é sequencial e só uma é a atual.
create or replace function private.employee_instructions_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.employees where id = new.employee_id;
  if v_org is null or v_org <> new.organization_id then
    raise exception 'Funcionário não pertence a esta organização' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) + 1 into new.version
    from public.employee_instructions where employee_id = new.employee_id;
  update public.employee_instructions set is_current = false
    where employee_id = new.employee_id and is_current;
  new.is_current := true;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end $$;
create trigger employee_instructions_bi before insert on public.employee_instructions
  for each row execute function private.employee_instructions_before_insert();

-- Limite de funcionários ativos conforme o plano.
create or replace function private.enforce_employee_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_active int; v_total int;
begin
  if tg_op = 'INSERT' then
    select p.max_employees into v_max
      from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.organization_id = new.organization_id;
    select count(*) into v_total from public.employees where organization_id = new.organization_id;
    if v_max is not null and v_total >= v_max then
      raise exception 'Limite do plano atingido: até % funcionário(s)', v_max using errcode = 'P0001';
    end if;
  end if;
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active then return new; end if;

  select p.max_employees into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.organization_id = new.organization_id
     and s.status in ('trialing', 'active', 'past_due');
  if v_max is null then
    raise exception 'Organização sem assinatura ativa' using errcode = 'P0001';
  end if;

  select count(*) into v_active from public.employees
   where organization_id = new.organization_id and is_active and id <> new.id;
  if v_active >= v_max then
    raise exception 'Limite do plano atingido: até % funcionário(s) ativo(s)', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger employees_limit before insert or update of is_active on public.employees
  for each row execute function private.enforce_employee_limit();

-- ---------------------------------------------------------------------
-- Base de conhecimento
-- ---------------------------------------------------------------------
create table public.knowledge_base (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  category              text not null check (category in (
                          'produto', 'servico', 'preco', 'horario', 'endereco',
                          'faq', 'politica', 'documento', 'outro')),
  title                 text not null check (char_length(title) between 1 and 200),
  content               text not null default '' check (char_length(content) <= 20000),
  price_cents           integer check (price_cents >= 0),
  -- Arquivo opcional no Supabase Storage (bucket "knowledge").
  storage_path          text,
  file_name             text,
  file_mime             text,
  is_published          boolean not null default true,
  -- null = todos os funcionários podem consultar.
  allowed_employee_ids  uuid[],
  search                tsvector generated always as (
                          setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
                          setweight(to_tsvector('portuguese', coalesce(content, '')), 'B')
                        ) stored,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index knowledge_base_org_cat_idx on public.knowledge_base (organization_id, category);
create index knowledge_base_search_idx on public.knowledge_base using gin (search);
create trigger knowledge_base_updated_at before update on public.knowledge_base
  for each row execute function private.set_updated_at();

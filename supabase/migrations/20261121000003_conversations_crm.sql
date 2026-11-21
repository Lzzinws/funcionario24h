-- =====================================================================
-- Integrações, contatos, conversas, mensagens, CRM e agendamentos
-- =====================================================================

create table public.integrations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  provider              text not null default 'whatsapp' check (provider in ('whatsapp')),
  status                text not null default 'disconnected'
                          check (status in ('disconnected', 'pending', 'connected', 'error')),
  phone_number_id       text,
  waba_id               text,
  display_phone_number  text,
  verified_name         text,
  last_error            text,
  last_checked_at       timestamptz,
  last_webhook_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index integrations_org_idx on public.integrations (organization_id);
-- Um número só pode pertencer a uma organização (roteamento do webhook).
create unique index integrations_phone_number_uq
  on public.integrations (provider, phone_number_id) where phone_number_id is not null;
create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();

-- Segredos: RLS ligada e NENHUMA policy => apenas service_role acessa.
create table public.integration_secrets (
  integration_id    uuid primary key references public.integrations (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  access_token_enc  text not null,
  updated_at        timestamptz not null default now()
);
create index integration_secrets_org_idx on public.integration_secrets (organization_id);

create or replace function private.enforce_whatsapp_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_count int;
begin
  select p.max_whatsapp_numbers into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.organization_id = new.organization_id;
  select count(*) into v_count from public.integrations
   where organization_id = new.organization_id and provider = new.provider;
  if v_max is not null and v_count >= v_max then
    raise exception 'Limite do plano atingido: % número(s) de WhatsApp', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger integrations_limit before insert on public.integrations
  for each row execute function private.enforce_whatsapp_limit();

-- ---------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text,
  phone_e164       text not null check (phone_e164 ~ '^\+?[0-9]{8,15}$'),
  wa_id            text,
  email            text,
  source           text not null default 'whatsapp',
  tags             text[] not null default '{}',
  notes            text,
  consent_at       timestamptz,
  opted_out_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, phone_e164)
);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
create table public.conversations (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  contact_id              uuid not null references public.contacts (id) on delete cascade,
  employee_id             uuid references public.employees (id) on delete set null,
  integration_id          uuid references public.integrations (id) on delete set null,
  channel                 text not null default 'whatsapp' check (channel in ('whatsapp', 'teste')),
  status                  text not null default 'open'
                            check (status in ('open', 'waiting_human', 'human', 'closed')),
  assigned_user_id        uuid references auth.users (id) on delete set null,
  handoff_reason          text,
  summary                 text,
  summary_updated_at      timestamptz,
  last_message_at         timestamptz not null default now(),
  last_inbound_at         timestamptz,
  unread_count            integer not null default 0 check (unread_count >= 0),
  first_response_seconds  integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index conversations_org_last_idx on public.conversations (organization_id, last_message_at desc);
create index conversations_org_status_idx on public.conversations (organization_id, status);
create index conversations_contact_idx on public.conversations (contact_id);
create index conversations_employee_idx on public.conversations (employee_id);
create index conversations_integration_idx on public.conversations (integration_id);
create index conversations_assigned_idx on public.conversations (assigned_user_id);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
create table public.messages (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  direction          text not null check (direction in ('inbound', 'outbound')),
  sender_type        text not null check (sender_type in ('contact', 'employee', 'human', 'system')),
  employee_id        uuid references public.employees (id) on delete set null,
  sender_user_id     uuid references auth.users (id) on delete set null,
  content_type       text not null default 'text'
                       check (content_type in ('text', 'image', 'audio', 'video', 'document',
                                               'location', 'template', 'interactive', 'other')),
  content            text not null default '' check (char_length(content) <= 8000),
  media              jsonb,
  integration_id     uuid references public.integrations (id) on delete set null,
  -- wamid do WhatsApp: chave de deduplicação.
  external_id        text,
  status             text not null default 'received'
                       check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error_code         text,
  error_message      text,
  status_updated_at  timestamptz,
  created_at         timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_org_created_idx on public.messages (organization_id, created_at desc);
create index messages_employee_idx on public.messages (employee_id);
create unique index messages_external_uq on public.messages (integration_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------
-- CRM
-- Regra de negócio: um lead só pode ser marcado como "ganho" com
-- confirmação humana e evidência — oportunidade não é venda.
-- ---------------------------------------------------------------------
create table public.leads (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  contact_id             uuid not null references public.contacts (id) on delete cascade,
  employee_id            uuid references public.employees (id) on delete set null,
  conversation_id        uuid references public.conversations (id) on delete set null,
  title                  text not null default 'Oportunidade',
  stage                  text not null default 'novo'
                           check (stage in ('novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido')),
  source                 text not null default 'whatsapp',
  interest               text,
  estimated_value_cents  integer check (estimated_value_cents >= 0),
  notes                  text,
  won_confirmed_by       uuid references auth.users (id) on delete set null,
  won_evidence           text,
  won_at                 timestamptz,
  last_interaction_at    timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint leads_won_requires_human_confirmation check (
    stage <> 'ganho' or (won_confirmed_by is not null and coalesce(won_evidence, '') <> '')
  )
);
create index leads_org_stage_idx on public.leads (organization_id, stage);
create index leads_contact_idx on public.leads (contact_id);
create index leads_employee_idx on public.leads (employee_id);
create index leads_conversation_idx on public.leads (conversation_id);
create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete set null,
  employee_id      uuid references public.employees (id) on delete set null,
  service          text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  status           text not null default 'requested'
                     check (status in ('requested', 'pending_approval', 'confirmed', 'cancelled')),
  notes            text,
  confirmed_by     uuid references auth.users (id) on delete set null,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_contact_idx on public.appointments (contact_id);
create index appointments_conversation_idx on public.appointments (conversation_id);
create index appointments_employee_idx on public.appointments (employee_id);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

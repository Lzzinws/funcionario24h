-- =====================================================================
-- Tarefas, aprovações, fila de jobs, eventos de webhook e consumo
-- =====================================================================

create table public.approvals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  employee_id      uuid references public.employees (id) on delete set null,
  contact_id       uuid references public.contacts (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  action_type      text not null,          -- nome da ferramenta (ex.: confirm_appointment)
  action_label     text not null,          -- descrição legível da ação pretendida
  justification    text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'changes_requested')),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create index approvals_org_status_idx on public.approvals (organization_id, status, created_at desc);
create index approvals_employee_idx on public.approvals (employee_id);
create index approvals_contact_idx on public.approvals (contact_id);
create index approvals_conversation_idx on public.approvals (conversation_id);
create trigger approvals_updated_at before update on public.approvals
  for each row execute function private.set_updated_at();

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  employee_id        uuid references public.employees (id) on delete set null,
  conversation_id    uuid references public.conversations (id) on delete set null,
  contact_id         uuid references public.contacts (id) on delete set null,
  approval_id        uuid unique references public.approvals (id) on delete set null,
  tool               text not null,
  input              jsonb not null default '{}'::jsonb,
  output             jsonb,
  status             text not null default 'pending'
                       check (status in ('pending', 'awaiting_approval', 'approved', 'running',
                                         'done', 'rejected', 'changes_requested', 'failed', 'cancelled')),
  requires_approval  boolean not null default false,
  error              text,
  executed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Uma tarefa que exige aprovação nunca pode ser executada sem ela.
  constraint tasks_approval_gate check (
    not requires_approval
    or status in ('awaiting_approval', 'rejected', 'changes_requested', 'cancelled')
    or approval_id is not null
  )
);
create index tasks_org_status_idx on public.tasks (organization_id, status, created_at desc);
create index tasks_employee_idx on public.tasks (employee_id);
create index tasks_conversation_idx on public.tasks (conversation_id);
create index tasks_contact_idx on public.tasks (contact_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- Defesa em profundidade: uma tarefa que requer aprovação só passa para
-- approved/running/done se a aprovação vinculada estiver "approved".
create or replace function private.tasks_guard_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if new.requires_approval and new.status in ('approved', 'running', 'done') then
    select status into v_status from public.approvals where id = new.approval_id;
    if v_status is distinct from 'approved' then
      raise exception 'Tarefa % exige aprovação humana antes da execução', new.id using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger tasks_guard_approval before insert or update on public.tasks
  for each row execute function private.tasks_guard_approval();

-- ---------------------------------------------------------------------
-- Fila de processamento assíncrono (somente service_role)
-- ---------------------------------------------------------------------
create table public.jobs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  type             text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  attempts         integer not null default 0,
  max_attempts     integer not null default 5,
  run_at           timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  dedupe_key       text unique,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index jobs_ready_idx on public.jobs (run_at) where status = 'queued';
create index jobs_org_idx on public.jobs (organization_id);

-- Eventos brutos de webhook (deduplicação e reprocessamento).
create table public.webhook_events (
  id            bigint generated always as identity primary key,
  provider      text not null,
  event_key     text not null unique,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

-- ---------------------------------------------------------------------
-- Consumo (IA e mensagens)
-- ---------------------------------------------------------------------
create table public.usage_records (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  employee_id      uuid references public.employees (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  kind             text not null check (kind in ('ai_tokens', 'message_in', 'message_out')),
  model            text,
  input_tokens     integer not null default 0 check (input_tokens >= 0),
  output_tokens    integer not null default 0 check (output_tokens >= 0),
  -- custo estimado em micro-dólares (1e-6 USD) para evitar ponto flutuante
  cost_micros      bigint not null default 0 check (cost_micros >= 0),
  latency_ms       integer,
  created_at       timestamptz not null default now()
);
create index usage_records_org_created_idx on public.usage_records (organization_id, created_at desc);
create index usage_records_employee_idx on public.usage_records (employee_id);
create index usage_records_conversation_idx on public.usage_records (conversation_id);

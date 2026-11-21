-- =====================================================================
-- Funções de negócio (RPC) e regras transacionais
-- =====================================================================

-- ---------------------------------------------------------------------
-- Criação de organização no onboarding (cria membro owner + assinatura
-- em período de teste). Única via de inserção em organizations.
-- ---------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text, p_segment text default null, p_plan text default 'starter'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Informe o nome da empresa' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and is_active) then
    raise exception 'Plano inválido' using errcode = '22023';
  end if;
  -- Evita criação em massa de organizações por um mesmo usuário.
  if (select count(*) from public.organization_members where user_id = v_user and role = 'owner') >= 5 then
    raise exception 'Limite de empresas por usuário atingido' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, segment, created_by)
  values (trim(p_name), nullif(trim(p_segment), ''), v_user)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  values (v_org, p_plan, 'trialing', now() + interval '7 days');

  perform private.write_audit(v_org, 'user', v_user, 'organization.created', 'organization', v_org,
                              jsonb_build_object('plan', p_plan));
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Decisão de aprovação (aprovar / rejeitar / solicitar alterações).
-- Única via para alterar approvals pela API. Ao aprovar, enfileira a
-- execução da tarefa — nada é executado antes da autorização.
-- ---------------------------------------------------------------------
create or replace function public.decide_approval(
  p_approval_id uuid, p_decision text, p_note text default null
) returns public.approvals
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_row  public.approvals;
  v_task_status text;
begin
  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'Decisão inválida' using errcode = '22023';
  end if;

  select * into v_row from public.approvals where id = p_approval_id for update;
  if not found or not private.has_org_role(v_row.organization_id, array['owner', 'admin']) then
    raise exception 'Aprovação não encontrada ou sem permissão' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Esta solicitação já foi decidida' using errcode = 'P0001';
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then
    raise exception 'Descreva as alterações solicitadas' using errcode = '22023';
  end if;

  update public.approvals
     set status = p_decision, decided_by = v_user, decided_at = now(),
         decision_note = nullif(trim(p_note), '')
   where id = p_approval_id
  returning * into v_row;

  v_task_status := case p_decision when 'approved' then 'approved'
                                   when 'rejected' then 'rejected'
                                   else 'changes_requested' end;
  update public.tasks set status = v_task_status where approval_id = p_approval_id;

  if p_decision = 'approved' then
    insert into public.jobs (organization_id, type, payload, dedupe_key)
    select v_row.organization_id, 'execute_task', jsonb_build_object('task_id', t.id), 'execute_task:' || t.id
      from public.tasks t where t.approval_id = p_approval_id
    on conflict (dedupe_key) do nothing;
  end if;

  -- Informa o funcionário/conversa sobre a decisão (para responder ao cliente).
  insert into public.jobs (organization_id, type, payload, dedupe_key)
  values (v_row.organization_id, 'approval_decided', jsonb_build_object('approval_id', v_row.id),
          'approval_decided:' || v_row.id)
  on conflict (dedupe_key) do nothing;

  perform private.write_audit(v_row.organization_id, 'user', v_user, 'approval.' || p_decision,
                              'approval', v_row.id,
                              jsonb_build_object('action_type', v_row.action_type, 'note', p_note));
  return v_row;
end $$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- CRM: "ganho" só por um humano autenticado (nunca pela IA/servidor).
-- ---------------------------------------------------------------------
create or replace function private.leads_won_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'ganho' and (tg_op = 'INSERT' or old.stage is distinct from 'ganho') then
    if (select auth.uid()) is null then
      raise exception 'Venda só pode ser confirmada por um usuário humano' using errcode = '42501';
    end if;
    new.won_confirmed_by := (select auth.uid());
    new.won_at := now();
  elsif new.stage <> 'ganho' then
    new.won_confirmed_by := null;
    new.won_at := null;
    new.won_evidence := null;
  end if;
  return new;
end $$;
create trigger leads_won_guard before insert or update of stage on public.leads
  for each row execute function private.leads_won_guard();

-- ---------------------------------------------------------------------
-- Fila: reserva atômica de jobs (FOR UPDATE SKIP LOCKED) — service_role.
-- Jobs presos em "running" por mais de 5 min voltam para a fila.
-- ---------------------------------------------------------------------
create or replace function public.claim_jobs(p_worker text, p_limit int default 10)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs set status = 'queued', locked_at = null, locked_by = null
   where status = 'running' and locked_at < now() - interval '5 minutes';

  return query
  update public.jobs j
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id in (
     select id from public.jobs
      where status = 'queued' and run_at <= now()
      order by run_at
      for update skip locked
      limit greatest(1, least(p_limit, 50))
   )
  returning j.*;
end $$;

create or replace function public.finish_job(p_job_id bigint, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_error is null then
    update public.jobs set status = 'done', finished_at = now(), last_error = null,
                           locked_at = null, locked_by = null
     where id = p_job_id;
  else
    -- backoff exponencial: 30s, 1m, 2m, 4m ... até max_attempts
    update public.jobs
       set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
           run_at = now() + (interval '30 seconds' * power(2, greatest(attempts - 1, 0))),
           last_error = left(p_error, 2000), locked_at = null, locked_by = null,
           finished_at = case when attempts >= max_attempts then now() end
     where id = p_job_id;
  end if;
end $$;

revoke all on function public.claim_jobs(text, int) from public, anon, authenticated;
revoke all on function public.finish_job(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, int) to service_role;
grant execute on function public.finish_job(bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- Indicadores do dashboard (security invoker => respeita RLS)
-- ---------------------------------------------------------------------
create or replace function public.org_dashboard_stats(p_org uuid, p_days int default 30)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with since as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as ts)
  select jsonb_build_object(
    'employees_active',   (select count(*) from public.employees where organization_id = p_org and is_active),
    'employees_total',    (select count(*) from public.employees where organization_id = p_org),
    'conversations',      (select count(*) from public.conversations, since
                            where organization_id = p_org and created_at >= since.ts and channel = 'whatsapp'),
    'conversations_open', (select count(*) from public.conversations
                            where organization_id = p_org and status in ('open', 'waiting_human', 'human')),
    'waiting_human',      (select count(*) from public.conversations
                            where organization_id = p_org and status = 'waiting_human'),
    'leads',              (select count(*) from public.leads, since
                            where organization_id = p_org and created_at >= since.ts),
    'tasks_done',         (select count(*) from public.tasks, since
                            where organization_id = p_org and status = 'done' and executed_at >= since.ts),
    'approvals_pending',  (select count(*) from public.approvals
                            where organization_id = p_org and status = 'pending'),
    'ai_input_tokens',    (select coalesce(sum(input_tokens), 0) from public.usage_records, since
                            where organization_id = p_org and kind = 'ai_tokens' and created_at >= since.ts),
    'ai_output_tokens',   (select coalesce(sum(output_tokens), 0) from public.usage_records, since
                            where organization_id = p_org and kind = 'ai_tokens' and created_at >= since.ts),
    'avg_first_response_seconds',
                          (select round(avg(first_response_seconds)) from public.conversations, since
                            where organization_id = p_org and created_at >= since.ts
                              and first_response_seconds is not null),
    -- Mensagens por hora do dia (fuso da organização), últimos 7 dias.
    'hourly', (
      select jsonb_agg(coalesce(h.n, 0) order by g.hr)
      from generate_series(0, 23) g(hr)
      left join (
        select extract(hour from m.created_at at time zone o.timezone)::int as hr, count(*) as n
        from public.messages m join public.organizations o on o.id = m.organization_id
        where m.organization_id = p_org and m.created_at >= now() - interval '7 days'
        group by 1
      ) h on h.hr = g.hr
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'conversations', d.c, 'messages', d.m) order by d.day)
      from (
        select g.day::date as day,
               (select count(*) from public.conversations c
                 where c.organization_id = p_org and c.channel = 'whatsapp'
                   and c.created_at >= g.day and c.created_at < g.day + interval '1 day') as c,
               (select count(*) from public.messages m
                 where m.organization_id = p_org
                   and m.created_at >= g.day and m.created_at < g.day + interval '1 day') as m
        from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') g(day)
      ) d), '[]'::jsonb)
  )
  where (select private.is_org_member(p_org));
$$;
revoke all on function public.org_dashboard_stats(uuid, int) from public, anon;
grant execute on function public.org_dashboard_stats(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Painel do administrador da plataforma: somente agregados, nunca
-- conteúdo de conversas, mensagens, contatos ou base de conhecimento.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_organizations()
returns table (
  id uuid, name text, segment text, status text, created_at timestamptz,
  plan_id text, subscription_status text, members bigint, employees_active bigint,
  conversations_30d bigint, messages_30d bigint, ai_tokens_30d bigint, ai_cost_micros_30d bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.segment, o.status, o.created_at, s.plan_id, s.status,
    (select count(*) from public.organization_members m where m.organization_id = o.id),
    (select count(*) from public.employees e where e.organization_id = o.id and e.is_active),
    (select count(*) from public.conversations c where c.organization_id = o.id and c.created_at > now() - interval '30 days'),
    (select count(*) from public.messages ms where ms.organization_id = o.id and ms.created_at > now() - interval '30 days'),
    (select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint from public.usage_records u
      where u.organization_id = o.id and u.created_at > now() - interval '30 days'),
    (select coalesce(sum(u.cost_micros), 0)::bigint from public.usage_records u
      where u.organization_id = o.id and u.created_at > now() - interval '30 days')
  from public.organizations o
  left join public.subscriptions s on s.organization_id = o.id
  order by o.created_at desc;
end $$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'organizations',        (select count(*) from public.organizations),
    'organizations_active', (select count(*) from public.organizations where status = 'active'),
    'users',                (select count(*) from public.profiles),
    'subscriptions_by_status', coalesce((select jsonb_object_agg(status, n) from
                               (select status, count(*) n from public.subscriptions group by status) x), '{}'::jsonb),
    'mrr_cents',            (select coalesce(sum(p.price_cents), 0) from public.subscriptions s
                               join public.plans p on p.id = s.plan_id where s.status = 'active'),
    'ai_cost_micros_30d',   (select coalesce(sum(cost_micros), 0) from public.usage_records
                               where created_at > now() - interval '30 days'),
    'ai_tokens_30d',        (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_records
                               where created_at > now() - interval '30 days'),
    'messages_30d',         (select count(*) from public.messages where created_at > now() - interval '30 days'),
    'jobs_dead',            (select count(*) from public.jobs where status = 'dead'),
    'jobs_queued',          (select count(*) from public.jobs where status = 'queued'),
    'integration_errors',   (select count(*) from public.integrations where status = 'error')
  );
end $$;

-- Erros operacionais: apenas metadados técnicos (sem payload de mensagens).
create or replace function public.admin_recent_errors(p_limit int default 50)
returns table (source text, organization_id uuid, kind text, error text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  return query
  (select 'job'::text, j.organization_id, j.type, j.last_error, coalesce(j.finished_at, j.run_at)
     from public.jobs j where j.last_error is not null
   union all
   select 'integration'::text, i.organization_id, i.provider, i.last_error, i.updated_at
     from public.integrations i where i.status = 'error')
  order by 5 desc
  limit greatest(1, least(p_limit, 200));
end $$;

create or replace function public.admin_set_organization_status(p_org uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  if p_status = 'suspended' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe o motivo da suspensão' using errcode = '22023';
  end if;
  update public.organizations
     set status = p_status, suspended_reason = case when p_status = 'suspended' then p_reason end
   where id = p_org;
  if p_status = 'suspended' then
    update public.employees set is_active = false where organization_id = p_org and is_active;
  end if;
  perform private.write_audit(p_org, 'platform_admin', (select auth.uid()), 'organization.' || p_status,
                              'organization', p_org, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_update_plan(
  p_id text, p_price_cents int, p_max_employees int, p_max_whatsapp int,
  p_monthly_ai_tokens bigint, p_is_active boolean
) returns public.plans
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  if not private.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma' using errcode = '42501';
  end if;
  update public.plans
     set price_cents = p_price_cents, max_employees = p_max_employees,
         max_whatsapp_numbers = p_max_whatsapp, monthly_ai_tokens = p_monthly_ai_tokens,
         is_active = p_is_active
   where id = p_id returning * into v;
  if not found then raise exception 'Plano não encontrado' using errcode = 'P0002'; end if;
  perform private.write_audit(null, 'platform_admin', (select auth.uid()), 'plan.updated', 'plan', null,
                              to_jsonb(v));
  return v;
end $$;

revoke all on function public.admin_list_organizations() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_recent_errors(int) from public, anon;
revoke all on function public.admin_set_organization_status(uuid, text, text) from public, anon;
revoke all on function public.admin_update_plan(text, int, int, int, bigint, boolean) from public, anon;
grant execute on function public.admin_list_organizations() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_recent_errors(int) to authenticated;
grant execute on function public.admin_set_organization_status(uuid, text, text) to authenticated;
grant execute on function public.admin_update_plan(text, int, int, int, bigint, boolean) to authenticated;

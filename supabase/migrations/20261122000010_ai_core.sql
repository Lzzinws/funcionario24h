-- =====================================================================
-- Núcleo de IA: operações atômicas usadas pelo orquestrador (somente
-- service_role) e indicadores que separam testes internos do atendimento.
-- =====================================================================

-- Tokens de IA consumidos no mês corrente (controle de franquia do plano).
create or replace function public.org_month_ai_tokens(p_org uuid)
returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
    from public.usage_records
   where organization_id = p_org
     and kind = 'ai_tokens'
     and created_at >= date_trunc('month', now());
$$;

-- Cria aprovação + tarefa pendente na mesma transação.
create or replace function public.create_ai_approval(
  p_org uuid, p_employee uuid, p_contact uuid, p_conversation uuid,
  p_tool text, p_label text, p_justification text, p_payload jsonb
) returns table (approval_id uuid, task_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_approval uuid; v_task uuid;
begin
  -- Garante que todas as referências pertencem à mesma organização.
  if not exists (select 1 from public.conversations c
                  where c.id = p_conversation and c.organization_id = p_org and c.contact_id = p_contact)
     or not exists (select 1 from public.employees e where e.id = p_employee and e.organization_id = p_org) then
    raise exception 'Referências inválidas para a organização' using errcode = '42501';
  end if;

  insert into public.approvals (organization_id, employee_id, contact_id, conversation_id,
                                action_type, action_label, justification, payload)
  values (p_org, p_employee, p_contact, p_conversation, p_tool, left(p_label, 300), left(p_justification, 500), coalesce(p_payload, '{}'::jsonb))
  returning id into v_approval;

  insert into public.tasks (organization_id, employee_id, conversation_id, contact_id, approval_id,
                            tool, input, status, requires_approval)
  values (p_org, p_employee, p_conversation, p_contact, v_approval, p_tool, coalesce(p_payload, '{}'::jsonb),
          'awaiting_approval', true)
  returning id into v_task;

  return query select v_approval, v_task;
end $$;

revoke all on function public.org_month_ai_tokens(uuid) from public, anon, authenticated;
revoke all on function public.create_ai_approval(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.org_month_ai_tokens(uuid) to service_role;
grant execute on function public.create_ai_approval(uuid, uuid, uuid, uuid, text, text, text, jsonb) to service_role;

-- Indicadores do painel: conversas de teste interno não contam como
-- atendimento (o consumo de IA dos testes continua contando, pois é real).
create or replace function public.org_dashboard_stats(p_org uuid, p_days int default 30)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with since as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as ts),
  real_msgs as (
    select m.created_at from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.organization_id = p_org and c.channel = 'whatsapp'
  )
  select jsonb_build_object(
    'employees_active',   (select count(*) from public.employees where organization_id = p_org and is_active),
    'employees_total',    (select count(*) from public.employees where organization_id = p_org),
    'conversations',      (select count(*) from public.conversations, since
                            where organization_id = p_org and created_at >= since.ts and channel = 'whatsapp'),
    'conversations_open', (select count(*) from public.conversations
                            where organization_id = p_org and channel = 'whatsapp' and status in ('open', 'waiting_human', 'human')),
    'waiting_human',      (select count(*) from public.conversations
                            where organization_id = p_org and channel = 'whatsapp' and status = 'waiting_human'),
    'leads',              (select count(*) from public.leads, since
                            where organization_id = p_org and created_at >= since.ts and source <> 'teste'),
    'tasks_done',         (select count(*) from public.tasks t, since
                            where t.organization_id = p_org and t.status = 'done' and t.executed_at >= since.ts
                              and not exists (select 1 from public.conversations c where c.id = t.conversation_id and c.channel = 'teste')),
    'approvals_pending',  (select count(*) from public.approvals
                            where organization_id = p_org and status = 'pending'),
    'ai_input_tokens',    (select coalesce(sum(input_tokens), 0) from public.usage_records, since
                            where organization_id = p_org and kind = 'ai_tokens' and created_at >= since.ts),
    'ai_output_tokens',   (select coalesce(sum(output_tokens), 0) from public.usage_records, since
                            where organization_id = p_org and kind = 'ai_tokens' and created_at >= since.ts),
    'avg_first_response_seconds',
                          (select round(avg(first_response_seconds)) from public.conversations, since
                            where organization_id = p_org and channel = 'whatsapp' and created_at >= since.ts
                              and first_response_seconds is not null),
    'hourly', (
      select jsonb_agg(coalesce(h.n, 0) order by g.hr)
      from generate_series(0, 23) g(hr)
      left join (
        select extract(hour from r.created_at at time zone o.timezone)::int as hr, count(*) as n
          from real_msgs r cross join public.organizations o
         where o.id = p_org and r.created_at >= now() - interval '7 days'
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
               (select count(*) from real_msgs r
                 where r.created_at >= g.day and r.created_at < g.day + interval '1 day') as m
        from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') g(day)
      ) d), '[]'::jsonb)
  )
  where (select private.is_org_member(p_org));
$$;

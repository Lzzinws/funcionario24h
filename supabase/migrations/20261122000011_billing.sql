-- =====================================================================
-- Cobrança (Mercado Pago — assinaturas "preapproval").
-- O estado é sempre aplicado a partir da consulta à API do gateway
-- (nunca a partir do corpo do webhook), por isso as funções abaixo são
-- idempotentes: reaplicar o mesmo estado não muda nada.
-- =====================================================================

alter table public.subscriptions
  add column if not exists provider_status text,
  add column if not exists last_payment_at timestamptz,
  add column if not exists last_payment_status text;

-- Tentativas de contratação (um checkout por clique em "Assinar").
create table public.billing_checkouts (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  plan_id                   text not null references public.plans (id),
  amount_cents              integer not null check (amount_cents > 0),
  provider                  text not null default 'mercadopago',
  provider_subscription_id  text unique,
  init_point                text,
  payer_email               text not null,
  status                    text not null default 'created'
                              check (status in ('created', 'pending', 'authorized', 'paused', 'canceled', 'failed')),
  mode                      text not null check (mode in ('test', 'live')),
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index billing_checkouts_org_idx on public.billing_checkouts (organization_id, created_at desc);
create index billing_checkouts_plan_idx on public.billing_checkouts (plan_id);
create trigger billing_checkouts_updated_at before update on public.billing_checkouts
  for each row execute function private.set_updated_at();

-- Cobranças recebidas (faturas da assinatura).
create table public.billing_payments (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  checkout_id           uuid references public.billing_checkouts (id) on delete set null,
  provider              text not null default 'mercadopago',
  provider_invoice_id   text not null,
  provider_payment_id   text,
  amount_cents          integer not null check (amount_cents >= 0),
  status                text not null,
  status_detail         text,
  paid_at               timestamptz,
  mode                  text not null check (mode in ('test', 'live')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);
create index billing_payments_org_idx on public.billing_payments (organization_id, created_at desc);
create index billing_payments_checkout_idx on public.billing_payments (checkout_id);
create trigger billing_payments_updated_at before update on public.billing_payments
  for each row execute function private.set_updated_at();

alter table public.billing_checkouts enable row level security;
alter table public.billing_payments enable row level security;
create policy billing_checkouts_select on public.billing_checkouts for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin'])));
create policy billing_payments_select on public.billing_payments for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin'])));
revoke insert, update, delete on public.billing_checkouts, public.billing_payments from anon, authenticated;

-- Ajusta funcionários ativos ao limite do plano (rebaixamento de plano).
create or replace function private.enforce_plan_limits(p_org uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_max int; v_paused int := 0;
begin
  select p.max_employees into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.organization_id = p_org;
  if v_max is null then return 0; end if;
  with keep as (
    select id from public.employees
     where organization_id = p_org and is_active
     order by is_default desc, created_at
     limit v_max
  )
  update public.employees e set is_active = false
   where e.organization_id = p_org and e.is_active and e.id not in (select id from keep);
  get diagnostics v_paused = row_count;
  if v_paused > 0 then
    perform private.write_audit(p_org, 'system', null, 'billing.employees_paused_by_plan', 'organization', p_org,
                                jsonb_build_object('paused', v_paused, 'max_employees', v_max));
  end if;
  return v_paused;
end $$;

-- ---------------------------------------------------------------------
-- Aplica o estado de uma assinatura do gateway (chamado pelo webhook
-- e pela sincronização no retorno do checkout). Somente service_role.
-- Retorna o id da assinatura do gateway que ficou substituída (para o
-- servidor cancelá-la no Mercado Pago), ou null.
-- ---------------------------------------------------------------------
create or replace function public.billing_apply_subscription(
  p_provider_subscription_id text,
  p_provider_status text,
  p_next_payment_date timestamptz default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_co public.billing_checkouts;
  v_sub public.subscriptions;
  v_status text := lower(coalesce(p_provider_status, ''));
  v_replaced text;
begin
  select * into v_co from public.billing_checkouts
   where provider_subscription_id = p_provider_subscription_id for update;
  if not found then
    raise exception 'Checkout desconhecido para a assinatura %', p_provider_subscription_id using errcode = 'P0002';
  end if;
  if v_status = 'cancelled' then v_status := 'canceled'; end if;
  if v_status not in ('pending', 'authorized', 'paused', 'canceled') then
    raise exception 'Status de assinatura inválido: %', p_provider_status using errcode = '22023';
  end if;

  update public.billing_checkouts set status = v_status where id = v_co.id;

  select * into v_sub from public.subscriptions where organization_id = v_co.organization_id for update;

  if v_status = 'authorized' then
    -- Esta assinatura passa a ser a vigente da organização.
    if v_sub.provider_subscription_id is not null and v_sub.provider_subscription_id <> p_provider_subscription_id then
      v_replaced := v_sub.provider_subscription_id;
    end if;
    update public.subscriptions
       set plan_id = v_co.plan_id,
           status = case when status = 'active' and provider_subscription_id = p_provider_subscription_id then status
                         else 'active' end,
           provider = v_co.provider,
           provider_subscription_id = p_provider_subscription_id,
           provider_status = v_status,
           trial_ends_at = null,
           current_period_start = case when provider_subscription_id is distinct from p_provider_subscription_id then now() else current_period_start end,
           current_period_end = greatest(current_period_end, coalesce(p_next_payment_date, now() + interval '1 month')),
           cancel_at = null
     where organization_id = v_co.organization_id;
    perform private.enforce_plan_limits(v_co.organization_id);
    if v_sub.provider_subscription_id is distinct from p_provider_subscription_id or v_sub.plan_id <> v_co.plan_id then
      perform private.write_audit(v_co.organization_id, 'system', null, 'billing.plan_activated', 'organization', v_co.organization_id,
        jsonb_build_object('plan', v_co.plan_id, 'previous_plan', v_sub.plan_id, 'mode', v_co.mode));
    end if;
  elsif v_sub.provider_subscription_id = p_provider_subscription_id then
    -- Mudanças só afetam a organização se for a assinatura vigente.
    if v_status = 'canceled' then
      update public.subscriptions
         set status = case when current_period_end > now() then status else 'canceled' end,
             provider_status = v_status, cancel_at = current_period_end
       where organization_id = v_co.organization_id;
      perform private.write_audit(v_co.organization_id, 'system', null, 'billing.subscription_canceled', 'organization', v_co.organization_id,
        jsonb_build_object('until', v_sub.current_period_end));
    elsif v_status = 'paused' then
      update public.subscriptions set status = 'past_due', provider_status = v_status
       where organization_id = v_co.organization_id;
    end if;
  end if;
  return v_replaced;
end $$;

-- ---------------------------------------------------------------------
-- Registra uma cobrança (fatura) da assinatura. Pagamento aprovado
-- renova o período; recusado marca a assinatura como "pagamento pendente".
-- ---------------------------------------------------------------------
create or replace function public.billing_record_payment(
  p_provider_subscription_id text,
  p_invoice_id text,
  p_payment_id text,
  p_amount_cents int,
  p_payment_status text,
  p_status_detail text,
  p_paid_at timestamptz default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_co public.billing_checkouts;
  v_prev text;
  v_status text := lower(coalesce(p_payment_status, 'pending'));
begin
  select * into v_co from public.billing_checkouts where provider_subscription_id = p_provider_subscription_id;
  if not found then
    raise exception 'Checkout desconhecido para a assinatura %', p_provider_subscription_id using errcode = 'P0002';
  end if;

  select status into v_prev from public.billing_payments where provider = v_co.provider and provider_invoice_id = p_invoice_id;

  insert into public.billing_payments (organization_id, checkout_id, provider, provider_invoice_id, provider_payment_id,
                                       amount_cents, status, status_detail, paid_at, mode)
  values (v_co.organization_id, v_co.id, v_co.provider, p_invoice_id, p_payment_id, greatest(p_amount_cents, 0),
          v_status, p_status_detail, case when v_status = 'approved' then coalesce(p_paid_at, now()) end, v_co.mode)
  on conflict (provider, provider_invoice_id) do update
     set provider_payment_id = excluded.provider_payment_id, amount_cents = excluded.amount_cents,
         status = excluded.status, status_detail = excluded.status_detail,
         paid_at = coalesce(public.billing_payments.paid_at, excluded.paid_at);

  -- Efeitos na assinatura só quando o status muda (idempotência).
  if v_prev is distinct from v_status then
    if v_status = 'approved' then
      update public.subscriptions
         set status = 'active', last_payment_at = coalesce(p_paid_at, now()), last_payment_status = v_status,
             current_period_end = greatest(current_period_end, coalesce(p_paid_at, now()) + interval '1 month')
       where organization_id = v_co.organization_id and provider_subscription_id = p_provider_subscription_id;
    elsif v_status in ('rejected', 'cancelled', 'canceled', 'charged_back', 'refunded') then
      update public.subscriptions
         set status = case when status in ('active', 'trialing') then 'past_due' else status end,
             last_payment_status = v_status
       where organization_id = v_co.organization_id and provider_subscription_id = p_provider_subscription_id;
    end if;
    perform private.write_audit(v_co.organization_id, 'system', null, 'billing.payment_' || v_status, 'organization', v_co.organization_id,
      jsonb_build_object('invoice', p_invoice_id, 'amount_cents', p_amount_cents, 'mode', v_co.mode));
  end if;
end $$;

revoke all on function public.billing_apply_subscription(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_record_payment(text, text, text, int, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_subscription(text, text, timestamptz) to service_role;
grant execute on function public.billing_record_payment(text, text, text, int, text, text, timestamptz) to service_role;

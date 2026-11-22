-- Testes do fluxo de cobrança (funções chamadas pelo webhook do gateway).
\set ON_ERROR_STOP on
begin;
create schema t;
create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;
create function t.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU (deveria ter sido bloqueado): %', p_label;
exception
  when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; raise notice 'ok  %', p_label;
  when others then raise notice 'ok  % (%)', p_label, sqlerrm;
end $$;
grant usage on schema t to authenticated, service_role;
grant execute on all functions in schema t to authenticated, service_role;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'dono@ex.com');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set role authenticated;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
insert into ids select 'org', public.create_organization('Loja Teste', 'varejo', 'business');
-- 3 funcionários ativos no plano Business (limite 5)
insert into public.employees (organization_id, role_type, name, title, is_active, is_default)
  select v, 'atendente', n, 'Cargo', true, n = 'Ana' from ids, unnest(array['Ana','Bruno','Carla']) n where k = 'org';
select t.expect_error($$select public.billing_apply_subscription('x', 'authorized')$$, 'usuário não aplica cobrança');
select t.expect_error($$insert into public.billing_checkouts (organization_id, plan_id, amount_cents, payer_email, mode)
  select v, 'starter', 1, 'a@b.com', 'test' from ids$$, 'usuário não cria checkout direto');

reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.billing_checkouts (organization_id, plan_id, amount_cents, payer_email, mode, provider_subscription_id, status)
  select v, 'profissional', 11990, 'dono@ex.com', 'test', 'mp-sub-1', 'pending' from ids;

select public.billing_apply_subscription('mp-sub-1', 'pending');
select t.ok((select status from public.subscriptions) = 'trialing', 'checkout pendente não altera o plano');

select public.billing_apply_subscription('mp-sub-1', 'authorized', now() + interval '1 month');
select t.ok((select plan_id || '/' || status from public.subscriptions) = 'profissional/active', 'assinatura autorizada ativa o plano contratado');
select t.ok((select count(*) from public.employees where is_active) = 3, 'plano Profissional mantém 3 funcionários');
select public.billing_apply_subscription('mp-sub-1', 'authorized', now() + interval '1 month');
select t.ok((select count(*) from public.audit_logs where action = 'billing.plan_activated') = 1, 'reaplicar o mesmo evento é idempotente');

select public.billing_record_payment('mp-sub-1', 'inv-1', 'pay-1', 11990, 'approved', 'accredited', now());
select public.billing_record_payment('mp-sub-1', 'inv-1', 'pay-1', 11990, 'approved', 'accredited', now());
select t.ok((select count(*) from public.billing_payments) = 1, 'pagamento duplicado é registrado uma vez');
select t.ok((select last_payment_status from public.subscriptions) = 'approved', 'pagamento aprovado registrado na assinatura');

select public.billing_record_payment('mp-sub-1', 'inv-2', 'pay-2', 11990, 'rejected', 'cc_rejected_insufficient_amount');
select t.ok((select status from public.subscriptions) = 'past_due', 'pagamento recusado marca pagamento pendente');
select public.billing_record_payment('mp-sub-1', 'inv-2', 'pay-3', 11990, 'approved', 'accredited', now());
select t.ok((select status from public.subscriptions) = 'active', 'nova tentativa aprovada reativa a assinatura');

-- Troca para o Starter (1 funcionário): os excedentes são pausados, o padrão continua.
insert into public.billing_checkouts (organization_id, plan_id, amount_cents, payer_email, mode, provider_subscription_id, status)
  select v, 'starter', 5990, 'dono@ex.com', 'test', 'mp-sub-2', 'pending' from ids;
select t.ok(public.billing_apply_subscription('mp-sub-2', 'authorized') = 'mp-sub-1', 'troca de plano devolve a assinatura antiga para cancelar');
select t.ok((select plan_id from public.subscriptions) = 'starter', 'novo plano aplicado');
select t.ok((select string_agg(name, ',') from public.employees where is_active) = 'Ana', 'rebaixamento pausa funcionários excedentes e mantém o padrão');

-- Cancelamento da assinatura antiga não afeta a vigente.
select public.billing_apply_subscription('mp-sub-1', 'cancelled');
select t.ok((select status from public.subscriptions) = 'active', 'cancelar assinatura substituída não afeta a vigente');
-- Cancelamento da vigente: mantém acesso até o fim do período pago.
select public.billing_apply_subscription('mp-sub-2', 'canceled');
select t.ok((select status = 'active' and cancel_at is not null from public.subscriptions), 'cancelamento mantém acesso até o fim do período');

select t.expect_error($$select public.billing_apply_subscription('nao-existe', 'authorized')$$, 'assinatura desconhecida é rejeitada');
select t.expect_error($$select public.billing_apply_subscription('mp-sub-2', 'hacked')$$, 'status inválido é rejeitado');

-- Dono vê seus pagamentos; outros usuários não.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'outro@ex.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select t.ok((select count(*) from public.billing_payments) = 2, 'dono vê os pagamentos da empresa');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
select t.ok((select count(*) from public.billing_payments) = 0, 'outro usuário não vê pagamentos');
reset role;

\echo 'TESTES DE COBRANÇA PASSARAM'
rollback;

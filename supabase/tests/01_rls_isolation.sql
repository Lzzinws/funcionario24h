-- Testes de isolamento multi-tenant, permissões e regras de negócio.
-- Executar com: npm run test:db   (falha no primeiro erro)
\set ON_ERROR_STOP on
begin;

-- Helpers de teste ---------------------------------------------------
create schema t;
create function t.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;
create function t.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU (deveria ter sido bloqueado): %', p_label;
exception
  when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice 'ok  %', p_label;
  when others then raise notice 'ok  % (%)', p_label, sqlerrm;
end $$;
create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Visitante anônimo vê os planos ativos (página de preços) ----------------
set role anon;
select t.ok((select count(*) from public.plans) = 3, 'visitante anônimo lê os planos ativos');
select t.ok((select count(*) from public.organizations) = 0, 'visitante anônimo não vê organizações');
reset role;

-- Usuários -------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@ex.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@ex.com', '{"full_name":"Beto"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@ex.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'admin@f24h.com', '{}');
insert into public.platform_admins values ('00000000-0000-0000-0000-00000000000d');
select t.ok((select count(*) from public.profiles) = 4, 'perfil criado automaticamente no cadastro');

-- Alice cria a org A, Beto cria a org B -------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
insert into ids select 'orgA', public.create_organization('Clínica Alfa', 'saude', 'starter');
select t.login('00000000-0000-0000-0000-00000000000b');
insert into ids select 'orgB', public.create_organization('Loja Beta', 'varejo', 'profissional');

select t.login(null);
select t.expect_error($$select public.create_organization('X')$$, 'anônimo não cria organização');

-- Alice: dados na org A
select t.login('00000000-0000-0000-0000-00000000000a');
insert into public.employees (organization_id, role_type, name, title, is_active)
  select v, 'atendente', 'Ana', 'Atendente', true from ids where k = 'orgA';
select t.expect_error(
  $$insert into public.employees (organization_id, role_type, name, title, is_active)
    select v, 'vendedor', 'Bruno', 'Vendedor', true from ids where k = 'orgA'$$,
  'limite do plano Starter (1 funcionário ativo)');
select t.expect_error(
  $$insert into public.employees (organization_id, role_type, name, title, is_active)
    select v, 'vendedor', 'Bruno', 'Vendedor', false from ids where k = 'orgA'$$,
  'limite total de funcionários do plano (mesmo pausados)');
insert into public.contacts (organization_id, name, phone_e164)
  select v, 'Cliente A', '+5511999990001' from ids where k = 'orgA';
insert into public.knowledge_base (organization_id, category, title, content)
  select v, 'servico', 'Limpeza dental', 'Limpeza completa com flúor' from ids where k = 'orgA';
select t.expect_error(
  $$update public.organizations set status = 'active' where id = (select v from ids where k='orgA')$$,
  'owner não altera status (suspensão) da própria organização');
update public.organizations set description = 'Clínica odontológica' where id = (select v from ids where k='orgA');

-- Instruções versionadas
insert into public.employee_instructions (organization_id, employee_id, content)
  select e.organization_id, e.id, 'v1' from public.employees e where e.name = 'Ana';
insert into public.employee_instructions (organization_id, employee_id, content)
  select e.organization_id, e.id, 'v2' from public.employees e where e.name = 'Ana';
select t.ok((select version from public.employee_instructions where is_current) = 2,
            'instruções versionadas, apenas a última é atual');
update public.employee_instructions set content = 'hack';  -- sem policy: afeta 0 linhas
select t.ok((select count(*) from public.employee_instructions where content = 'hack') = 0,
            'instruções são imutáveis');

-- Beto não enxerga nem altera nada da org A ---------------------------
select t.login('00000000-0000-0000-0000-00000000000b');
select t.ok((select count(*) from public.organizations) = 1, 'Beto vê só a própria organização');
select t.ok((select count(*) from public.employees) = 0, 'Beto não vê funcionários da org A');
select t.ok((select count(*) from public.contacts) = 0, 'Beto não vê contatos da org A');
select t.ok((select count(*) from public.knowledge_base) = 0, 'Beto não vê base de conhecimento da org A');
select t.expect_error(
  $$insert into public.employees (organization_id, role_type, name, title)
    select v, 'atendente', 'Intruso', 'Atendente' from ids where k = 'orgA'$$,
  'Beto não cria funcionário na org A');
update public.employees set name = 'Hackeado';
select t.expect_error(
  $$insert into public.organization_members (organization_id, user_id, role)
    select v, '00000000-0000-0000-0000-00000000000b', 'owner' from ids where k = 'orgA'$$,
  'Beto não se adiciona como membro da org A');
select t.ok(public.org_dashboard_stats((select v from ids where k='orgA')) is null,
            'Beto não lê indicadores da org A');

-- Tabelas exclusivas do servidor
select t.expect_error($$select * from public.integration_secrets$$, 'segredos inacessíveis pela API');
select t.expect_error($$select * from public.jobs$$, 'fila inacessível pela API');
select t.expect_error($$select public.claim_jobs('x', 1)$$, 'claim_jobs restrito ao servidor');

-- Servidor (service_role) cria conversa, mensagem, tarefa e aprovação na org A
reset role;
set role service_role;
select t.login(null);
select t.ok((select name from public.employees where name in ('Ana','Hackeado') limit 1) = 'Ana',
            'update de Beto não afetou a org A');
insert into public.conversations (organization_id, contact_id, employee_id)
  select c.organization_id, c.id, (select id from public.employees where name = 'Ana')
  from public.contacts c where c.phone_e164 = '+5511999990001';
insert into public.messages (organization_id, conversation_id, direction, sender_type, content, external_id, integration_id)
  select organization_id, id, 'inbound', 'contact', 'Quero marcar limpeza', 'wamid.1', null from public.conversations;
insert into public.approvals (organization_id, employee_id, action_type, action_label, justification, payload)
  select organization_id, employee_id, 'request_appointment', 'Agendar limpeza', 'Cliente pediu', '{}'
  from public.conversations;
select t.expect_error(
  $$insert into public.tasks (organization_id, tool, status, requires_approval)
    select v, 'request_appointment', 'running', true from ids where k = 'orgA'$$,
  'tarefa sensível não executa sem aprovação');
insert into public.tasks (organization_id, tool, status, requires_approval, approval_id)
  select organization_id, 'request_appointment', 'awaiting_approval', true, id from public.approvals;
select t.expect_error(
  $$update public.tasks set status = 'done'$$, 'tarefa pendente não pode ir para done');
insert into public.leads (organization_id, contact_id)
  select organization_id, id from public.contacts;
select t.expect_error(
  $$update public.leads set stage = 'ganho', won_evidence = 'nf 1'$$,
  'IA/servidor não confirma venda');

-- Papel "viewer" e "agent" ---------------------------------------------
insert into public.organization_members (organization_id, user_id, role)
  select v, '00000000-0000-0000-0000-00000000000c', 'agent' from ids where k = 'orgA';
reset role;
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000c');
select t.ok((select count(*) from public.messages) = 1, 'atendente humano lê mensagens da org');
select t.expect_error(
  $$select public.decide_approval((select id from public.approvals limit 1), 'approved')$$,
  'agent não decide aprovações');
select t.expect_error(
  $$insert into public.messages (organization_id, conversation_id, direction, sender_type)
    select organization_id, id, 'outbound', 'human' from public.conversations$$,
  'mensagens só são inseridas pelo servidor');
update public.leads set stage = 'ganho', won_evidence = 'Pedido 123 pago';
select t.ok((select won_confirmed_by from public.leads) = '00000000-0000-0000-0000-00000000000c',
            'venda confirmada por humano registra quem confirmou');

-- Owner aprova -> tarefa liberada e job enfileirado
select t.login('00000000-0000-0000-0000-00000000000a');
select t.expect_error(
  $$select public.decide_approval((select id from public.approvals limit 1), 'changes_requested', '')$$,
  'pedido de alteração exige descrição');
select public.decide_approval((select id from public.approvals limit 1), 'approved', 'ok');
select t.ok((select status from public.tasks limit 1) = 'approved', 'tarefa liberada após aprovação');
select t.expect_error(
  $$select public.decide_approval((select id from public.approvals limit 1), 'rejected')$$,
  'aprovação não pode ser decidida duas vezes');
select t.ok((select count(*) from public.audit_logs where action = 'approval.approved') = 1,
            'decisão registrada na auditoria');

-- Administrador da plataforma: agregados sim, conteúdo não -------------
select t.login('00000000-0000-0000-0000-00000000000d');
select t.ok((select count(*) from public.admin_list_organizations()) = 2, 'admin lista empresas');
select t.ok((select (public.admin_overview() ->> 'organizations')::int) = 2, 'admin vê indicadores globais');
select t.ok((select count(*) from public.messages) = 0, 'admin NÃO lê mensagens');
select t.ok((select count(*) from public.contacts) = 0, 'admin NÃO lê contatos');
select t.ok((select count(*) from public.knowledge_base) = 0, 'admin NÃO lê base de conhecimento');
select public.admin_set_organization_status((select v from ids where k='orgB'), 'suspended', 'inadimplência');
select t.login('00000000-0000-0000-0000-00000000000a');
select t.expect_error($$select * from public.admin_overview()$$, 'cliente não acessa painel admin');

reset role;
select t.ok((select count(*) from public.jobs where type = 'execute_task') = 1, 'job de execução enfileirado');
select t.ok((select status from public.organizations where name = 'Loja Beta') = 'suspended', 'suspensão aplicada');

select t.ok((select count(*) from public.audit_logs where action = 'employee.created') = 1, 'criação de funcionários auditada');
select t.ok((select count(*) from public.audit_logs where action = 'employee.instructions_updated') = 2, 'versões de instruções auditadas');
select t.ok((select count(*) from public.audit_logs where action = 'knowledge.created') = 1, 'base de conhecimento auditada');
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok(jsonb_array_length(public.org_dashboard_stats((select v from ids where k='orgA')) -> 'hourly') = 24
            and (select sum(x::int) from jsonb_array_elements_text(public.org_dashboard_stats((select v from ids where k='orgA')) -> 'hourly') x) = 1,
            'indicadores: 24 horas e 1 mensagem contabilizada');
reset role;
-- Núcleo de IA: operações atômicas do servidor ------------------------
set role service_role;
select t.ok((select count(*) from public.create_ai_approval(
  (select v from ids where k='orgA'), (select id from public.employees where name='Ana'),
  (select contact_id from public.conversations limit 1), (select id from public.conversations limit 1),
  'request_discount', 'Oferecer 10%', 'Cliente fiel', '{"offer":"10%"}')) = 1, 'IA cria aprovação + tarefa atomicamente');
select t.ok((select count(*) from public.tasks where tool = 'request_discount' and status = 'awaiting_approval' and requires_approval) = 1,
            'tarefa sensível nasce aguardando aprovação');
select t.expect_error(
  $$select * from public.create_ai_approval((select v from ids where k='orgB'), (select id from public.employees where name='Ana'),
    (select contact_id from public.conversations limit 1), (select id from public.conversations limit 1), 'request_discount', 'x', 'y', '{}')$$,
  'IA não cria aprovação apontando para outra organização');
select t.ok(public.org_month_ai_tokens((select v from ids where k='orgA')) = 0, 'consumo mensal calculado');
reset role;
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select t.expect_error($$select public.org_month_ai_tokens((select v from ids where k='orgA'))$$, 'consumo mensal restrito ao servidor');
select t.expect_error($$select * from public.create_ai_approval(null,null,null,null,'x','x','x','{}')$$, 'usuário não cria aprovação em nome da IA');
reset role;

\echo 'TODOS OS TESTES DE BANCO PASSARAM'
rollback;

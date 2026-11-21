-- =====================================================================
-- Row Level Security
-- Regra geral: a leitura exige ser membro da organização; a escrita exige
-- o papel adequado. Tabelas operacionais (jobs, webhook_events, segredos)
-- não têm policies: somente o service_role (que ignora RLS) as acessa.
-- O administrador da plataforma NÃO possui policy sobre conversas,
-- mensagens, contatos ou base de conhecimento.
-- =====================================================================

alter table public.plans                 enable row level security;
alter table public.organizations         enable row level security;
alter table public.profiles              enable row level security;
alter table public.organization_members  enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.platform_admins       enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.employee_templates    enable row level security;
alter table public.employees             enable row level security;
alter table public.employee_instructions enable row level security;
alter table public.knowledge_base        enable row level security;
alter table public.integrations          enable row level security;
alter table public.integration_secrets   enable row level security;
alter table public.contacts              enable row level security;
alter table public.conversations         enable row level security;
alter table public.messages              enable row level security;
alter table public.leads                 enable row level security;
alter table public.appointments          enable row level security;
alter table public.approvals             enable row level security;
alter table public.tasks                 enable row level security;
alter table public.jobs                  enable row level security;
alter table public.webhook_events        enable row level security;
alter table public.usage_records         enable row level security;

-- Tabelas exclusivas do servidor: sem acesso algum pelos papéis da API.
revoke all on public.integration_secrets, public.jobs, public.webhook_events from anon, authenticated;
-- Auditoria é somente leitura para a API.
revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- ---------------------------------------------------------------- plans
create policy plans_read on public.plans for select to anon, authenticated
  using (is_active or (select private.is_platform_admin()));

-- -------------------------------------------------------- organizations
create policy orgs_select on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
create policy orgs_update on public.organizations for update to authenticated
  using ((select private.has_org_role(id, array['owner', 'admin'])))
  with check ((select private.has_org_role(id, array['owner', 'admin'])));
-- Inserção somente via RPC create_organization().
-- "status" e "suspended_reason" só mudam via admin_set_organization_status().
revoke update on public.organizations from authenticated;
grant update (name, segment, description, address, business_hours, phone, website, timezone,
              onboarding_step, onboarding_completed_at)
  on public.organizations to authenticated;
revoke insert, delete on public.organizations from authenticated;

-- ------------------------------------------------------------- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ------------------------------------------------- organization_members
create policy members_select on public.organization_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy members_insert on public.organization_members for insert to authenticated
  with check ((select private.has_org_role(organization_id, array['owner'])));
create policy members_update on public.organization_members for update to authenticated
  using ((select private.has_org_role(organization_id, array['owner'])) and user_id <> (select auth.uid()))
  with check ((select private.has_org_role(organization_id, array['owner'])));
create policy members_delete on public.organization_members for delete to authenticated
  using ((select private.has_org_role(organization_id, array['owner'])) and user_id <> (select auth.uid()));

-- -------------------------------------------------------- subscriptions
create policy subscriptions_select on public.subscriptions for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- ------------------------------------------------------ platform_admins
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------- audit_logs
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin'])));

-- --------------------------------------------------- employee_templates
create policy templates_read on public.employee_templates for select to authenticated
  using (is_available);

-- ------------------------------------------- tabelas de configuração
-- employees, employee_instructions, knowledge_base, integrations:
-- leitura por membros, escrita por owner/admin.
do $$
declare t text;
begin
  foreach t in array array['employees', 'employee_instructions', 'knowledge_base', 'integrations'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using ((select private.is_org_member(organization_id)))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check ((select private.has_org_role(organization_id, array[''owner'',''admin''])))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using ((select private.has_org_role(organization_id, array[''owner'',''admin''])))
         with check ((select private.has_org_role(organization_id, array[''owner'',''admin''])))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using ((select private.has_org_role(organization_id, array[''owner'',''admin''])))', t);
  end loop;
end $$;
-- Instruções são imutáveis (novas versões são inseridas).
drop policy employee_instructions_update on public.employee_instructions;
drop policy employee_instructions_delete on public.employee_instructions;
-- Status da integração é controlado pelo servidor após validar credenciais.
revoke insert, update on public.integrations from authenticated;
drop policy integrations_insert on public.integrations;
drop policy integrations_update on public.integrations;

-- ---------------------------------------------- tabelas de atendimento
-- contacts, conversations, leads, appointments: leitura por membros,
-- escrita por owner/admin/agent. Exclusão apenas owner/admin.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'conversations', 'leads', 'appointments'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using ((select private.is_org_member(organization_id)))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check ((select private.has_org_role(organization_id, array[''owner'',''admin'',''agent''])))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using ((select private.has_org_role(organization_id, array[''owner'',''admin'',''agent''])))
         with check ((select private.has_org_role(organization_id, array[''owner'',''admin'',''agent''])))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using ((select private.has_org_role(organization_id, array[''owner'',''admin''])))', t);
  end loop;
end $$;

-- ------------------------------------------------------------- messages
-- Mensagens são inseridas pelo servidor (envio passa pela API do WhatsApp).
create policy messages_select on public.messages for select to authenticated
  using ((select private.is_org_member(organization_id)));
revoke insert, update, delete on public.messages from authenticated;

-- ---------------------------------------------------- approvals / tasks
-- Somente leitura pela API. Decisões apenas via decide_approval().
create policy approvals_select on public.approvals for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy tasks_select on public.tasks for select to authenticated
  using ((select private.is_org_member(organization_id)));
revoke insert, update, delete on public.approvals, public.tasks from authenticated;

-- -------------------------------------------------------- usage_records
create policy usage_select on public.usage_records for select to authenticated
  using ((select private.is_org_member(organization_id)));
revoke insert, update, delete on public.usage_records from authenticated;

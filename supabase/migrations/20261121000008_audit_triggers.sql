-- =====================================================================
-- Auditoria automática de alterações de configuração.
-- Feita no banco para que nenhuma alteração escape do registro,
-- independentemente de qual interface ou client a originou.
-- =====================================================================

create or replace function private.audit_employees()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_type  text := case when v_actor is null then 'system' else 'user' end;
  v_row   public.employees := coalesce(new, old);
  v_action text;
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    v_action := 'employee.created';
  elsif tg_op = 'DELETE' then
    v_action := 'employee.deleted';
  elsif new.is_active is distinct from old.is_active then
    v_action := case when new.is_active then 'employee.activated' else 'employee.deactivated' end;
  else
    select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(new)) n
     where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key);
    if v_changed is null then return null; end if;
    v_action := 'employee.updated';
  end if;
  perform private.write_audit(v_row.organization_id, v_type, v_actor, v_action, 'employee', v_row.id,
    jsonb_build_object('name', v_row.name, 'changed', coalesce(to_jsonb(v_changed), '[]'::jsonb),
                       'tools', case when tg_op = 'UPDATE' and new.permissions is distinct from old.permissions
                                     then jsonb_build_object('before', old.permissions, 'after', new.permissions) end));
  return null;
end $$;
create trigger employees_audit after insert or update or delete on public.employees
  for each row execute function private.audit_employees();

create or replace function private.audit_instructions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_audit(new.organization_id,
    case when new.created_by is null then 'system' else 'user' end, new.created_by,
    'employee.instructions_updated', 'employee', new.employee_id, jsonb_build_object('version', new.version));
  return null;
end $$;
create trigger employee_instructions_audit after insert on public.employee_instructions
  for each row execute function private.audit_instructions();

create or replace function private.audit_knowledge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.knowledge_base := coalesce(new, old);
begin
  perform private.write_audit(v_row.organization_id, case when v_actor is null then 'system' else 'user' end, v_actor,
    'knowledge.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    'knowledge', v_row.id, jsonb_build_object('title', v_row.title, 'category', v_row.category));
  return null;
end $$;
create trigger knowledge_base_audit after insert or update or delete on public.knowledge_base
  for each row execute function private.audit_knowledge();

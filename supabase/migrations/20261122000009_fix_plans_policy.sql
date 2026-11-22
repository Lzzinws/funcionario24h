-- Visitantes (anon) não executam funções do schema private: a leitura
-- pública de planos não pode depender de is_platform_admin().
-- Também fixa o search_path de private.set_updated_at (advisor do Supabase).
drop policy if exists plans_read on public.plans;
create policy plans_read_public on public.plans for select to anon
  using (is_active);
create policy plans_read_authenticated on public.plans for select to authenticated
  using (is_active or (select private.is_platform_admin()));
alter function private.set_updated_at() set search_path = '';

-- ═══════════════════════════════════════════════════════════════════════════
--  T7.6/أ-٢ — تشديد صلاحيات الإسقاطين (طُبِّق على الإنتاج 2026-11-09)
--
--  ما حدث فعليًا: Supabase يمنح anon/authenticated صلاحيات كاملة تلقائيًا على
--  أي كائن جديد في schema public (default privileges)، فورث الإسقاطان
--  INSERT/UPDATE/DELETE/TRUNCATE رغم تنفيذ `revoke all … from public`.
--  الإسقاط ليس قابلًا للكتابة أصلًا (فيه أعمدة محسوبة)، لكن الصلاحية
--  الممنوحة بلا داعٍ سطح هجوم مجاني — تُسحب.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.items_public from anon, authenticated;
revoke all on public.items_staff  from anon, authenticated;

grant select on public.items_public to anon, authenticated;
grant select on public.items_staff  to authenticated;

notify pgrst, 'reload schema';

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('items_public','items_staff')
       and grantee in ('anon','authenticated')
       and privilege_type <> 'SELECT'
  ) then
    raise exception 'T7.6/أ-٢: صلاحية غير SELECT باقية على الإسقاطين';
  end if;
  if has_table_privilege('anon', 'public.items_staff', 'select') then
    raise exception 'T7.6/أ-٢: anon يقرأ items_staff (يجب أن يكون للموظف فقط)';
  end if;
  raise notice '✅ T7.6/أ-٢: الإسقاطان للقراءة فقط · items_staff موظفون فقط';
end $$;

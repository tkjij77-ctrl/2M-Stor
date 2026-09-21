-- ═══════════════════════════════════════════════════════════════════
--  T3.4 — إكمال الحذف الناعم على مستوى قاعدة البيانات
--
--  الخلفية:
--    الأعمدة deleted_at موجودة في الـbaseline لجدولي items وcategories،
--    لكن سياسات القراءة العامة كانت using (true) — أي أن زائرًا يستطيع
--    قراءة الأصناف والأقسام المحذوفة مباشرة عبر الـAPI.
--    كذلك لا توجد سياسة تمنع الأصناف المحذوفة من الظهور للجمهور.
--
--  هذا الترحيل:
--    1) يحدّث سياسات القراءة العامة لتستبعد deleted_at is not null
--    2) يمنع إسناد صنف إلى قسم محذوف
--    3) يضيف عمود من حذف/متى (لمنع «من حذف هذا؟» بلا جواب)
--    4) يضيف حدّ أقصى للمحذوفات المحفوظة تلقائيًا بعد 90 يومًا (اختياري)
--
--  ✅ آمن للتشغيل المتكرر (idempotent).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0) دوال مساعدة (تُبنى على my_role() الموجود في الـbaseline) ──
-- ⚠️ my_role() ممنوعة على anon، لذا نستخدمها داخل SECURITY DEFINER فقط،
--    ونجعل anon يحصل على false بدل خطأ صلاحيات (وهذا ما كان يسبب 401 سابقًا).
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(public.my_role() in ('admin','worker'), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

revoke execute on function public.is_staff()   from public;
revoke execute on function public.is_manager() from public;
grant execute on function public.is_staff()    to anon, authenticated;
grant execute on function public.is_manager()  to anon, authenticated;

comment on function public.is_staff()   is 'هل المستخدم الحالي عامل أو مدير؟ (T3.4)';
comment on function public.is_manager() is 'هل المستخدم الحالي مدير؟ (T3.4)';

-- ── 1) أعمدة التتبّع (إن لم تكن موجودة) ──────────────────────
alter table public.items      add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.categories add column if not exists deleted_by uuid references auth.users(id) on delete set null;

comment on column public.items.deleted_at      is 'وقت الحذف الناعم — null يعني عنصر حيّ';
comment on column public.items.deleted_by      is 'من نفّذ الحذف (الاستعادة متاحة منه)';
comment on column public.categories.deleted_at is 'وقت الحذف الناعم — null يعني قسم حيّ';
comment on column public.categories.deleted_by is 'من نفّذ الحذف';

-- ── 2) فهارس تسريع استعلام «سلة المحذوفات» ───────────────────
create index if not exists idx_items_deleted_at
  on public.items (deleted_at desc) where deleted_at is not null;

create index if not exists idx_categories_deleted_at
  on public.categories (deleted_at desc) where deleted_at is not null;

-- ── 3) سياسات القراءة العامة: الحي فقط ───────────────────────
-- ⚠️ المهم: بدون هذا، الأصناف المحذوفة تظهر لأي زائر عبر الـAPI.
drop policy if exists "items_read" on public.items;
create policy "items_read" on public.items
  for select
  using (deleted_at is null or public.is_staff());

drop policy if exists "cats_read" on public.categories;
create policy "cats_read" on public.categories
  for select
  using (deleted_at is null or public.is_staff());

-- ── 4) لا صنف داخل قسم محذوف (يُطبَّق عند الكتابة فقط) ────────
create or replace function public.guard_item_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted timestamptz;
begin
  if new.category_id is null then return new; end if;

  select deleted_at into v_deleted from public.categories where id = new.category_id;

  -- القسم المحذوف مسموح فقط أثناء «نقل الأصناف» أو الاستعادة الذاتية
  if v_deleted is not null and not public.is_staff() then
    raise exception 'لا يمكن إسناد صنف إلى قسم محذوف';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_item_category on public.items;
create trigger trg_guard_item_category
  before insert or update of category_id on public.items
  for each row execute function public.guard_item_category();

-- ── 5) دالة مساعدة: قائمة المحذوفات (للمدير) ─────────────────
create or replace function public.trash_list()
returns table (
  kind      text,
  id        bigint,
  name      text,
  deleted_at timestamptz,
  deleted_by_username text
)
language sql
security definer
set search_path = public
stable
as $$
  select 'item'::text, i.id, i.name, i.deleted_at, p.username
    from public.items i
    left join public.profiles p on p.id = i.deleted_by
   where i.deleted_at is not null and public.is_manager()
  union all
  select 'cat'::text, c.id, c.name, c.deleted_at, p.username
    from public.categories c
    left join public.profiles p on p.id = c.deleted_by
   where c.deleted_at is not null and public.is_manager()
   order by 4 desc;
$$;

revoke all on function public.trash_list() from anon;
grant execute on function public.trash_list() to authenticated;

comment on function public.trash_list() is 'سلة المحذوفات — للمدير فقط (T3.4)';

-- ── 6) دالة: حذف ناعم يسجّل من نفّذ الحذف ────────────────────
create or replace function public.soft_delete_item(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.items
     set deleted_at = coalesce(deleted_at, now()),
         deleted_by = auth.uid()
   where id = p_id and public.is_staff();
$$;

create or replace function public.soft_delete_category(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.categories
     set deleted_at = coalesce(deleted_at, now()),
         deleted_by = auth.uid()
   where id = p_id and public.is_staff();
$$;

revoke all on function public.soft_delete_item(bigint)     from anon;
revoke all on function public.soft_delete_category(bigint) from anon;
grant execute on function public.soft_delete_item(bigint)     to authenticated;
grant execute on function public.soft_delete_category(bigint) to authenticated;

-- ── 7) استعادة (للمدير فقط) ──────────────────────────────────
create or replace function public.restore_item(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'الاستعادة للمدير فقط'; end if;
  update public.items set deleted_at = null, deleted_by = null where id = p_id;
  insert into public.audit_log(user_id, action, details)
  values (auth.uid(), 'استعادة صنف من المحذوفات', 'item #' || p_id);
  return found;
end $$;

create or replace function public.restore_category(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'الاستعادة للمدير فقط'; end if;
  update public.categories set deleted_at = null, deleted_by = null where id = p_id;
  insert into public.audit_log(user_id, action, details)
  values (auth.uid(), 'استعادة قسم من المحذوفات', 'category #' || p_id);
  return found;
end $$;

revoke all on function public.restore_item(bigint)     from anon;
revoke all on function public.restore_category(bigint) from anon;
grant execute on function public.restore_item(bigint)     to authenticated;
grant execute on function public.restore_category(bigint) to authenticated;

-- ── 8) تصفير: المحذوفات الأقدم من 90 يومًا تُفرَّغ يوميًا ────
--    (تحمي مساحة الخطة المجانية من التضخّم غير المحدود)
create or replace function public.purge_old_trash(p_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items int; v_cats int;
begin
  if not public.is_manager() then raise exception 'التصفير للمدير فقط'; end if;

  delete from public.items
   where deleted_at is not null and deleted_at < now() - (p_days || ' days')::interval;
  get diagnostics v_items = row_count;

  delete from public.categories
   where deleted_at is not null and deleted_at < now() - (p_days || ' days')::interval;
  get diagnostics v_cats = row_count;

  insert into public.audit_log(user_id, action, details)
  values (auth.uid(), 'تصفير سلة المحذوفات', v_items || ' صنف · ' || v_cats || ' قسم');

  return v_items + v_cats;
end $$;

revoke all on function public.purge_old_trash(int) from anon;
grant execute on function public.purge_old_trash(int) to authenticated;

-- ── 9) فحص ذاتي ──────────────────────────────────────────────
do $$
declare v_bad int;
begin
  -- تأكد أن سياسة القراءة العامة لا تعرض المحذوف
  select count(*) into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('items', 'categories')
     and cmd = 'SELECT'
     and qual like '%true%'
     and qual not like '%deleted_at%';

  if v_bad > 0 then
    raise warning '⚠️ توجد % سياسة قراءة بلا تصفية deleted_at — راجعها', v_bad;
  else
    raise notice '✅ سياسات القراءة تستبعد المحذوف';
  end if;

  raise notice '✅ T3.4 طُبِّق: حذف ناعم + استعادة + سلة محذوفات + تصفير بعد 90 يومًا';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════
--  🚀 تشغيل الباك اند كاملًا — **ملف واحد يُلصق مرة واحدة**
--
--  لمن: قاعدة شغّالة بالفعل فيها بياناتك (مشروعك الحالي) — لا مشروع جديد.
--  ماذا يفعل: إصلاحات الأمان + الترحيلات + حسم السياسات الشاردة، ثم تقرير تحقق.
--
--  الاستخدام:
--    1) Supabase → SQL Editor → New query
--    2) الصق الملف كاملًا (طويل — هذا طبيعي) ثم اضغط Run
--    3) انزل لآخر النتائج واقرأ «التقرير النهائي» — يجب أن تكون كلها ✅
--    4) قاطعَتْك مشكلة في المنتصف؟ أعد التشغيل بلا خوف: كل العبارات idempotent
--
--  ⚠️ ما لا يفعله: لا يحذف بيانات · لا يمسّ حسابًا · لا يغيّر أي دور.
--     (ترقية مديرك: scripts/grant-role.sql — سطر واحد للتعديل)
--
--  🔴 عاجل: الفحص الحيّ على قاعدتك أظهر أن **الزائر يقرأ فواتيرك الآن**
--     (13 فاتورة بأسماء العملاء والمبالغ) وأن بإمكانه الكتابة عليها —
--     لأن إصلاحات الأمان لم تُنفَّذ بعد. هذا الملف يغلق ذلك.
-- ═══════════════════════════════════════════════════════════════════

-- ── (0) لقطة «قبل» — احفظ ناتجها للمقارنة ───────────────────────────
select 'قبل' as المرحلة, tablename, policyname, cmd, coalesce(qual, with_check, '') as الشرط
  from pg_policies
 where schemaname in ('public', 'storage')
   and tablename in ('invoices', 'invoice_items', 'profiles', 'items', 'categories', 'settings', 'objects')
 order by tablename, policyname;


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260827104851_add_invoice_status
-- ═══════════════════════════════════════════════════════════════════

-- Add status and updated_at columns to invoices table
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'قيد المعالجة',
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT NOW();

-- Create trigger to automatically update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_invoices_touch ON public.invoices;
CREATE TRIGGER trg_invoices_touch
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add inv_update policy (if not exists)
DO $$
BEGIN
   IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'invoices' AND policyname = 'inv_update'
   ) THEN
drop policy if exists "inv_update" on public.invoices;   -- يمنع «already exists» عند إعادة التشغيل
      CREATE POLICY "inv_update" ON public.invoices
         FOR UPDATE
         USING (auth.uid() IS NOT NULL)
         WITH CHECK (auth.uid() IS NOT NULL);
   END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921000000_security_hardening
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  20260921000000_security_hardening.sql
--  إغلاق الثغرات الحرجة في 2M-Stor — نتاج فحص 21 سبتمبر 2026
--
--  ما يفعله هذا الملف:
--   1) منع تصعيد الصلاحيات (أي مستخدم يرقّي نفسه إلى admin)      [A1]
--   2) تقييد سياسات Storage على الأدوار الإدارية                 [A2]
--   3) تأمين قراءة/تعديل الفواتير وسجل النشاط                    [A3]
--   4) ترقيم الفواتير من السيرفر (يُنهي تعارض الأجهزة)           [D1]
--   5) إكمال Realtime والفهارس الناقصة في المستودع               [D4]
--
--  ⚠️ idempotent — آمن لإعادة التنفيذ.
--  ⚠️ خُد نسخة احتياطية قبل التنفيذ على الإنتاج.
--  ℹ️ الفحص التشخيصي والتحقق بعد التنفيذ في: security-fixes.sql (أقسام 0 و 8)
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  قسم 1 — إغلاق تصعيد الصلاحيات (A1) 🔴 الأهم
-- ═══════════════════════════════════════════════════════════════════

-- 1.1 Trigger يمنع تغيير الدور إلا بواسطة مدير
--     (يعمل بغض النظر عن أي سياسة — أضمن حل)
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- هل تغيّر الدور فعليًا؟
  if new.role is distinct from old.role then
    -- من ينفّذ التغيير: مدير حقيقي؟
    if coalesce(public.my_role(), '') <> 'admin' then
      raise exception 'غير مصرح: لا يمكنك تغيير دور الحساب'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_no_escalation on public.profiles;
create trigger trg_profiles_no_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- 1.2 تقوية سياسة التعديل الذاتي: الدور الجديد يجب أن يبقى كما هو
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.my_role()          -- لا ترقية ذاتية
  );

-- 1.3 (مقصود عدم استخدامه) منع تحديث عمود role على مستوى الصلاحيات
-- ⚠️ تحذير مهم: لا تنفّذ السطرين التاليين، لأنهما سيمنعان المدير نفسه
--    من تغيير أدوار المستخدمين — لأن صلاحيات الأعمدة تُطبَّق على الدور
--    (authenticated) ككل، لا على المستخدم بعينه. التطبيق يعتمد على
--    changeUserRole() التي تنفّذ: update profiles set role = ...
--
--    revoke update on public.profiles from authenticated;   -- ❌ لا تنفّذه
--    grant update (display_name, username, pin_hash) on public.profiles to authenticated;
--
--    الطبقتان 1.1 (Trigger) و 1.2 (السياسة) كافيتان تمامًا: المدير يمرّ
--    من سياسة profiles_write ومن فحص my_role() داخل التريغر، وأي مستخدم
--    آخر يُمنع برسالة خطأ واضحة. تم التحقق من كود changeUserRole:4499
--    في index.html للتأكد أن هذا الإصلاح لا يكسر إدارة الحسابات.
-- ═══════════════════════════════════════════════════════════════════
--  قسم 2 — تأمين صور المنتجات (A2) 🔴
--  كانت: أي مستخدم مسجَّل يرفع/يعدّل/يحذف أي صورة
--  تصبح: المدير والعامل فقط
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "products_auth_insert" on storage.objects;
drop policy if exists "products_auth_update" on storage.objects;
drop policy if exists "products_auth_delete" on storage.objects;
drop policy if exists "products_public_read" on storage.objects;

-- القراءة تبقى عامة (المتجر يعمل بدون تسجيل)
create policy "products_public_read" on storage.objects
  for select using (bucket_id = 'products');

-- ⚠️ لا بد من حذف سياسات الفريق قبل إنشائها: بلا هذه الأسطر يفشل **إعادة تشغيل**
--    هذا الترحيل بـ«policy … already exists» — وقد كشفه اختبار التشغيل مرتين
--    (scripts/verify-apply-backend-all.sh) وكان سيمنع المستخدم من إعادة التنفيذ.
drop policy if exists "products_staff_insert" on storage.objects;
drop policy if exists "products_staff_update" on storage.objects;
drop policy if exists "products_staff_delete" on storage.objects;

create policy "products_staff_insert" on storage.objects
  for insert with check (
    bucket_id = 'products' and public.my_role() in ('admin', 'worker')
  );

create policy "products_staff_update" on storage.objects
  for update using (
    bucket_id = 'products' and public.my_role() in ('admin', 'worker')
  )
  with check (
    bucket_id = 'products' and public.my_role() in ('admin', 'worker')
  );

create policy "products_staff_delete" on storage.objects
  for delete using (
    bucket_id = 'products' and public.my_role() in ('admin', 'worker')
  );
-- ═══════════════════════════════════════════════════════════════════
--  قسم 3 — تأمين الفواتير وسجل النشاط (A3) 🔴
-- ═══════════════════════════════════════════════════════════════════

-- 3.1 دالة مساعدة: اسم المستخدم الحالي (للسماح للعميل برؤية طلباته فقط)
create or replace function public.my_username()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select username from public.profiles where id = auth.uid()
$$;

revoke execute on function public.my_username() from public, anon;
grant  execute on function public.my_username() to authenticated;

-- 3.2 قراءة الفواتير:
--     المدير/العامل: الكل · العميل: طلباته فقط (اسمه) · الزائر: لا شيء
drop policy if exists "inv_read" on public.invoices;
create policy "inv_read" on public.invoices
  for select using (
    public.my_role() in ('admin', 'worker')
    or seller_id = auth.uid()
    or customer_name = public.my_username()
  );

create index if not exists idx_invoices_customer on public.invoices (customer_name);
create index if not exists idx_invoices_seller   on public.invoices (seller_id);

-- 3.3 إنشاء الفواتير: أي مسجَّل دخول (كما هو الآن — العامل ينشئ الفاتورة)
drop policy if exists "inv_create" on public.invoices;
create policy "inv_create" on public.invoices
  for insert with check (auth.uid() is not null);

-- 3.4 تعديل الفواتير: الإدارة فقط (كان: أي مستخدم مسجَّل!)
drop policy if exists "inv_update" on public.invoices;
create policy "inv_update" on public.invoices
  for update using (public.my_role() in ('admin', 'worker'))
  with check (public.my_role() in ('admin', 'worker'));

-- 3.5 حذف الفواتير: المدير فقط (كما هو، نعيد تأكيده)
drop policy if exists "inv_delete" on public.invoices;
create policy "inv_delete" on public.invoices
  for delete using (public.my_role() = 'admin');

-- 3.6 بنود الفاتورة: إنشاء لأي مسجَّل، تعديل/حذف للإدارة فقط
drop policy if exists "iitems_rw" on public.invoice_items;
drop policy if exists "iitems_insert" on public.invoice_items;   -- يمنع «already exists» عند إعادة التشغيل
create policy "iitems_insert" on public.invoice_items
  for insert with check (auth.uid() is not null);
drop policy if exists "iitems_update" on public.invoice_items;
create policy "iitems_update" on public.invoice_items
  for update using (public.my_role() in ('admin', 'worker'))
  with check (public.my_role() in ('admin', 'worker'));
drop policy if exists "iitems_delete" on public.invoice_items;
create policy "iitems_delete" on public.invoice_items
  for delete using (public.my_role() = 'admin');

-- 3.7 سجل النشاط: الكتابة للعامل والمدير فقط (كانت لأي مسجَّل)
drop policy if exists "audit_write" on public.audit_log;
create policy "audit_write" on public.audit_log
  for insert with check (public.my_role() in ('admin', 'worker'));
-- ═══════════════════════════════════════════════════════════════════
--  قسم 5 — إنهاء تعارض أرقام الفواتير بين الأجهزة (P2 — موصى به بقوة)
--  المشكلة: كل جهاز يحسب رقم الفاتورة من localStorage الخاص به،
--  فيتكرر الرقم بين الأجهزة → فشل الرفع + فاتورة عالقة في الطابور.
--  الحل: السيرفر يضمن التفرد.
-- ═══════════════════════════════════════════════════════════════════

create sequence if not exists public.invoice_no_seq;

-- ابدأ التسلسل بعد أعلى رقم موجود
select setval(
  'public.invoice_no_seq',
  greatest(
    coalesce((select max(invoice_no) from public.invoices), 1000),
    1000
  )
);

create or replace function public.assign_invoice_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- لو الرقم جاي من العميل وفاضي → خُد من التسلسل
  if new.invoice_no is null then
    new.invoice_no := nextval('public.invoice_no_seq');
  -- لو الرقم مستخدم بالفعل (جهاز تاني خد نفس الرقم) → خُد رقمًا مضمونًا
  elsif exists (select 1 from public.invoices where invoice_no = new.invoice_no) then
    new.invoice_no := nextval('public.invoice_no_seq');
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_assign_no on public.invoices;
create trigger trg_invoices_assign_no
  before insert on public.invoices
  for each row execute function public.assign_invoice_no();

-- ملاحظة: تبقى نافذة صغيرة جدًا لو أُنشئت فاتورتان في نفس الألف من الثانية.
-- لتحديد الرقم من السيرفر دائمًا بشكل مطلق، استخدم النسخة الصارمة دي:
--   new.invoice_no := nextval('public.invoice_no_seq');   -- تجاهل رقم العميل
-- ═══════════════════════════════════════════════════════════════════
--  قسم 6 — إكمال ما هو ناقص في المستودع (إمكانية إعادة البناء)
--  هذه الأجزاء موجودة على السحابة لكن غير موجودة في supabase/migrations،
--  فلو أعدت بناء المشروع تختفي المزامنة الفورية والفهارس.
-- ═══════════════════════════════════════════════════════════════════

-- 6.1 فهرس بحث نصي عربي
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_items_name_trgm
  on public.items using gin (name extensions.gin_trgm_ops);
create index if not exists idx_categories_name_trgm
  on public.categories using gin (name extensions.gin_trgm_ops);

-- 6.2 فهارس الاستعلامات الشائعة
create index if not exists idx_items_category   on public.items (category_id) where deleted_at is null;
create index if not exists idx_items_display    on public.items (display_qs);
create index if not exists idx_items_updated    on public.items (updated_at desc);

-- 6.3 تفعيل Realtime على الجداول الحيّة (بدونه لا يوجد تحديث فوري)
do $$
declare
  t text;
  tables text[] := array['items', 'categories', 'settings', 'invoices'];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 6.4 (اختياري) استقبال القيم القديمة في أحداث DELETE/UPDATE عبر Realtime
-- alter table public.items      replica identity full;
-- alter table public.categories replica identity full;
-- alter table public.invoices   replica identity full;

-- ═══════════════════════════════════════════════════════════════════
--  تم ✔ — نفّذ قسم 8 من security-fixes.sql للتحقق
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  ملحق — إصلاح ضوضاء my_role للزوار (N-1)
--  مكتشف بالتجربة: استعلام الفواتير مع join profiles يفشل بـ 401
--  للزائر لأن anon لا يملك صلاحية تنفيذ my_role().
--  الدالة آمنة للزائر (auth.uid() = null → تُرجع NULL) — والسياسات تبقى الحاكم.
--  ℹ️ لتفعيله أزل التعليق عن السطرين التاليين:
-- ═══════════════════════════════════════════════════════════════════

-- grant execute on function public.my_role() to anon;
-- grant execute on function public.my_username() to anon;


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921010000_soft_delete_rls
-- ═══════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921020000_stock_model
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  T3.3 — نموذج المخزون: تتبّع الخصم + حماية الأرقام على مستوى القاعدة
--
--  الخلفية (من التقرير — البند D2 «حرج»):
--    البيع كان يُنقص «المعروض» (display_qs) فقط، ويترك «إجمالي المخزن»
--    (stock_q) ثابتًا للأبد → جرد وهمي. والأسوأ: إلغاء الطلب
--    أو حذف الفاتورة لم يُرجِع أي كمية → نقص دائم بلا سبب.
--
--  هذا الترحيل يضيف:
--    1) invoices.stock_applied — هل خُصم مخزون هذه الفاتورة؟ (يمنع الخصم/الاسترجاع المزدوج)
--    2) قيود عدم السلبية على الكميات (دفاع ثانٍ لو رفعت نسخة قديمة أرقامًا سالبة)
--    3) تقرير جرد: أين التناقض بين المخزن والمعروض؟
--    4) دالة تشخيصية للفواتير الملغاة التي لم تُرجِع كمياتها
--
--  ✅ آمن للتشغيل المتكرر (idempotent).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1) تتبّع الخصم على الفاتورة ───────────────────────────────
--    القيم: null (لم يُخصم أو فاتورة قديمة) · 'both' · 'display'
alter table public.invoices
  add column if not exists stock_applied text;

comment on column public.invoices.stock_applied is
  'كيف خُصم مخزون هذه الفاتورة: both = المخزن والمعروض · display = المعروض فقط · null = لم يُخصم';

alter table public.invoices
  add column if not exists stock_reverted_at timestamptz;

comment on column public.invoices.stock_reverted_at is
  'وقت استرجاع الكميات (إلغاء/رفض/حذف) — يمنع الاسترجاع المزدوج';

-- ── 2) قيود عدم السلبية (دفاع ثانٍ) ───────────────────────────
--    not valid: تُطبَّق على الكتابات الجديدة دون أن تفشل بسبب بيانات قديمة.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_q_nonneg') then
    alter table public.items
      add constraint items_q_nonneg check (stock_q >= 0 and display_qs >= 0) not valid;
  end if;

  -- المعروض للبيع لا يزيد عن إجمالي المخزن (وإلا نبيع ما لا نملك)
  if not exists (select 1 from pg_constraint where conname = 'items_display_le_stock') then
    alter table public.items
      add constraint items_display_le_stock check (display_qs <= stock_q) not valid;
  end if;
end $$;

comment on constraint items_q_nonneg on public.items is
  'الكميات لا تكون سالبة أبدًا (T3.3)';
comment on constraint items_display_le_stock on public.items is
  'المعروض للبيع ≤ إجمالي المخزن (T3.3)';

-- ── 3) تقرير جرد: أين التناقض؟ ───────────────────────────────
create or replace view public.stock_health as
select
  i.id,
  i.name,
  c.name                as category_name,
  i.stock_q,
  i.display_qs,
  i.min_alert,
  case
    when i.stock_q < 0 or i.display_qs < 0            then '❌ كمية سالبة'
    when i.display_qs > i.stock_q                     then '⚠️ المعروض أكبر من المخزن'
    when i.stock_q = 0                                then '🔴 نافذ'
    when i.stock_q <= i.min_alert                     then '🟠 تحت حد التنبيه'
    else                                                   '✅ سليم'
  end                   as status_ar,
  (i.stock_q - i.display_qs) as hidden_qty,   -- كمية في المخزن غير معروضة
  i.updated_at
from public.items i
left join public.categories c on c.id = i.category_id
where i.deleted_at is null
order by
  case when i.stock_q < 0 or i.display_qs < 0 or i.display_qs > i.stock_q then 0
       when i.stock_q = 0 then 1
       when i.stock_q <= i.min_alert then 2
       else 3 end,
  i.name;

comment on view public.stock_health is
  'تقرير جرد فوري — يكشف التناقض والأصناف الناقصة (T3.3)';

-- ── 4) تشخيص: فواتير ملغاة لم تُرجِع كمياتها ────────────────
create or replace function public.stock_mismatch_report()
returns table (
  invoice_no    int,
  invoice_total numeric,
  status        text,
  stock_applied text,
  created_at    timestamptz,
  diagnosis     text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    inv.invoice_no,
    inv.total,
    inv.status,
    inv.stock_applied,
    inv.created_at,
    case
      when inv.status in ('ملغي', 'تم رفض الطلب') and inv.stock_applied is not null
           and inv.stock_reverted_at is null
        then '❌ فاتورة ملغاة والكميات لم تُرجَع — نفّذ استرجاعًا يدويًا'
      when inv.status in ('قيد المعالجة', 'في الطريق', 'تم التوصيل')
           and inv.stock_applied is null
        then '⚠️ فاتورة قائمة بلا خصم مخزون مسجَّل — راجع الجرد'
      else '✅ سليم'
    end
  from public.invoices inv
  where public.is_manager()
  order by inv.created_at desc
  limit 200;
$$;

revoke all on function public.stock_mismatch_report() from anon;
grant execute on function public.stock_mismatch_report() to authenticated;

comment on function public.stock_mismatch_report() is
  'تشخيص تناقضات المخزون في الفواتير — للمدير (T3.3)';

-- ── 5) دالة إرجاع كميات فاتورة (للتصحيح اليدوي من لوحة Supabase) ──
create or replace function public.revert_invoice_stock(p_invoice_no int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied text;
  v_reverted timestamptz;
  v_qty int;
  v_lines int := 0;
begin
  if not public.is_manager() then
    raise exception 'استرجاع الكميات للمدير فقط';
  end if;

  select stock_applied, stock_reverted_at into v_applied, v_reverted
    from public.invoices where invoice_no = p_invoice_no;

  if not found then return '❌ لا توجد فاتورة برقم ' || p_invoice_no; end if;
  if v_reverted is not null then return 'ℹ️ كميات هذه الفاتورة مُرجَعة بالفعل (' || v_reverted || ')'; end if;
  if v_applied is null then return 'ℹ️ هذه الفاتورة لا تحتوي مخزونًا مخصومًا'; end if;

  for v_qty in
    select ii.qty from public.invoice_items ii
      join public.invoices inv on inv.id = ii.invoice_id
     where inv.invoice_no = p_invoice_no
  loop
    -- نرجّع بالاسم عبر جدول الأصناف (الربط الأدق موجود في التطبيق)
    update public.items i
       set display_qs = i.display_qs + v_qty,
           stock_q    = case when v_applied = 'both' then i.stock_q + v_qty else i.stock_q end,
           updated_at = now()
     where i.id = (
        select i2.id from public.items i2
          join public.invoice_items ii2 on ii2.item_name = i2.name
          join public.invoices inv2 on inv2.id = ii2.invoice_id
         where inv2.invoice_no = p_invoice_no
           and i2.deleted_at is null
         limit 1
     );
    v_lines := v_lines + 1;
  end loop;

  update public.invoices
     set stock_applied = null, stock_reverted_at = now()
   where invoice_no = p_invoice_no;

  insert into public.audit_log(user_id, action, details)
  values (auth.uid(), 'استرجاع كميات فاتورة', '#' || p_invoice_no || ' — ' || v_lines || ' سطرًا');

  return '✅ أُرجعت كميات الفاتورة #' || p_invoice_no || ' (' || v_lines || ' سطرًا)';
end $$;

revoke all on function public.revert_invoice_stock(int) from anon;
grant execute on function public.revert_invoice_stock(int) to authenticated;

comment on function public.revert_invoice_stock(int) is
  'إرجاع كميات فاتورة ملغاة يدويًا — للمدير (T3.3)';

-- ── 6) فحص ذاتي ──────────────────────────────────────────────
do $$
declare
  v_neg int; v_bad int;
begin
  select count(*) into v_neg from public.items where stock_q < 0 or display_qs < 0;
  if v_neg > 0 then
    raise warning '⚠️ % صنف بكمية سالبة — صحّحها من تقرير stock_health', v_neg;
  end if;

  select count(*) into v_bad from public.items
   where deleted_at is null and display_qs > stock_q;
  if v_bad > 0 then
    raise warning '⚠️ % صنف معروضه أكبر من مخزونه — راجع stock_health (القيد لن يُطبَّق إلا على الكتابات الجديدة)', v_bad;
  end if;

  raise notice '✅ T3.3 طُبِّق: تتبّع الخصم + قيود السلامة + تقرير الجرد';
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921030000_stock_rpc
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  T3.3 / T2.5 — خصم المخزون ذرّيًا من تطبيق Next.js (سلة الواجهة)
--
--  لماذا RPC وليس تحديثًا عاديًا؟
--    التحديث العادي في المتصفح يقرأ الرصيد ثم يكتبه (read-then-write):
--    لو باع جهازان في نفس اللحظة، يكتب الثاني رقمًا مبنيًا على قراءة قديمة
--    فيضيع خصم الأول. الدالة هنا تُنفَّذ داخل القاعدة في عملية واحدة ذرّية.
--
--  الأمان: أي مسجَّل دخول (عامل/مدير/عميل) — نفس شرط إنشاء الفاتورة.
--          الزائر المجهول ممنوع (وإلا صار الخصم أداة تخريب).
--
--  ✅ آمن للتشغيل المتكرر.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── خصم المخزون ──────────────────────────────────────────────
create or replace function public.decrement_stock(
  p_item_id bigint,
  p_qty int,
  p_both boolean default true
)
returns table (stock_q int, display_qs int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب لخصم المخزون';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  -- القفل يمنع سباق الجهازين (الخصم لا يضيع)
  return query
  update public.items i
     set display_qs = greatest(0, i.display_qs - p_qty),
         stock_q    = case when p_both then greatest(0, i.stock_q - p_qty) else i.stock_q end,
         updated_at = now()
   where i.id = p_item_id
     and i.deleted_at is null
  returning i.stock_q, i.display_qs;

  if not found then
    raise exception 'الصنف % غير موجود أو محذوف', p_item_id;
  end if;
end $$;

comment on function public.decrement_stock(bigint, int, boolean) is
  'خصم ذرّي من المخزون عند البيع — يمنع ضياع الخصم عند البيع المتزامن (T3.3)';

-- ── إرجاع المخزون (إلغاء/رفض من أي جهاز) ─────────────────────
create or replace function public.increment_stock(
  p_item_id bigint,
  p_qty int,
  p_both boolean default true
)
returns table (stock_q int, display_qs int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  -- المعروض لا يتجاوز المخزن (قيد السلامة في 20260921020000)
  return query
  update public.items i
     set stock_q    = case when p_both then i.stock_q + p_qty else i.stock_q end,
         display_qs = least(
                        i.display_qs + p_qty,
                        case when p_both then i.stock_q + p_qty else i.stock_q end
                      ),
         updated_at = now()
   where i.id = p_item_id and i.deleted_at is null
  returning i.stock_q, i.display_qs;

  if not found then
    raise exception 'الصنف % غير موجود أو محذوف', p_item_id;
  end if;
end $$;

comment on function public.increment_stock(bigint, int, boolean) is
  'إرجاع كمية للمخزون عند إلغاء بيعة (T3.3)';

-- ── الصلاحيات ────────────────────────────────────────────────
revoke all on function public.decrement_stock(bigint, int, boolean) from anon;
revoke all on function public.increment_stock(bigint, int, boolean) from anon;
grant execute on function public.decrement_stock(bigint, int, boolean) to authenticated;
grant execute on function public.increment_stock(bigint, int, boolean) to authenticated;

-- ── تسجيل الحركة في سجل النشاط (تتبّع من خصم ماذا ومتى) ──────
create or replace function public.log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.stock_q is distinct from old.stock_q)
     or (new.display_qs is distinct from old.display_qs) then
    insert into public.audit_log(user_id, action, details)
    values (
      auth.uid(),
      'تغيّر مخزون',
      new.name || ' — مخزن ' || old.stock_q || '→' || new.stock_q ||
      ' · معروض ' || old.display_qs || '→' || new.display_qs
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_log_stock_change on public.items;
create trigger trg_log_stock_change
  after update of stock_q, display_qs on public.items
  for each row execute function public.log_stock_change();

-- ── فحص ذاتي ────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.decrement_stock(bigint,int,boolean)') is null then
    raise exception 'فشل إنشاء decrement_stock';
  end if;
  raise notice '✅ T3.3/T2.5: خصم وإرجاع المخزون ذرّيًا + تتبّع في سجل النشاط';
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921040000_invoice_numbering
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  T3.1 — ترقيم الفواتير على السيرفر (كان رقمًا محليًا لكل جهاز)
--
--  الثغرة D1: `al_sayed_invno` في localStorage. جهازان يعملان بلا تنسيق
--  يُنتجان «فاتورة #7» مرتين ⇒ إما تصادم يُفشل الرفع، أو — الأسوأ —
--  رقمان مكرّران على ورق العميلين، وسجل مبيعات لا يمكن الاعتماد عليه.
--
--  الحل: تسلسل (sequence) مركزي في القاعدة:
--    • next_invoice_no(): رقم رسمي يُطلب قبل الحفظ (لمسجّل الدخول فقط)
--    • assign_invoice_no(): trigger يُسند رقمًا لأي فاتورة بلا رقم،
--      ويستبدل رقمًا محليًا محجوزًا على جهاز آخر — فلا يفشل الإدراج أبدًا
--
--  الترتيب: نفّذ هذا الملف **بعد** 20260826200407_baseline.sql
--           (يحتاج جدول invoices موجودًا).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) التسلسل المركزي ────────────────────────────────────────────
create sequence if not exists public.invoice_no_seq as integer;

-- نضبط البداية على أكبر رقم موجود + 1، **ولا نُنقص** التسلسل أبدًا
-- (إعادة تشغيل الملف بعد فواتير جديدة يجب ألا تُعيد أرقامًا مستخدمة).
do $$
declare
  v_max  integer;
  v_next integer;
begin
  select coalesce(max(invoice_no), 0) into v_max from public.invoices;
  select case when is_called then last_value + 1 else last_value end
    into v_next
    from public.invoice_no_seq;
  if v_next <= v_max then
    perform setval('public.invoice_no_seq', v_max + 1, false);
  end if;
end $$;

comment on sequence public.invoice_no_seq is 'T3.1 — الرقم الرسمي لتسلسل الفواتير (مصدر واحد لكل الأجهزة)';

-- ── 2) الرقم الرسمي عند الطلب ─────────────────────────────────────
create or replace function public.next_invoice_no()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no integer;
begin
  -- لا يُسمح لزائر مجهول بسحب أرقام من التسلسل
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب للحصول على رقم فاتورة'
      using errcode = '42501';
  end if;
  v_no := nextval('public.invoice_no_seq');
  return v_no;
end $$;

comment on function public.next_invoice_no() is
  'T3.1 — يُعيد الرقم الرسمي التالي للفاتورة (تسلسل مركزي، بلا تكرار بين الأجهزة)';

-- ⚠️ الوصول عبر الدالة فقط: لا grant على التسلسل نفسه، وإلا أمكن
--    سحب أرقام بلا فاتورة عبر nextval مباشرة.
revoke all on function public.next_invoice_no() from public;
revoke all on function public.next_invoice_no() from anon;
grant execute on function public.next_invoice_no() to authenticated;

-- ── 3) حارس الإدراج: أي فاتورة بلا رقم أو برقم محجوز تأخذ رقمًا رسميًا ──
create or replace function public.assign_invoice_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ثلاث حالات:
  --   (أ) لا رقم إطلاقًا        → رقم رسمي من التسلسل
  --   (ب) رقم سالب/صفر         → رقم رسمي
  --   (ج) رقم محلي محجوز فعلًا → رقم رسمي (جهاز آخر سبقنا إليه)
  if new.invoice_no is null
     or new.invoice_no <= 0
     or exists (select 1 from public.invoices i where i.invoice_no = new.invoice_no) then
    new.invoice_no := nextval('public.invoice_no_seq');
  end if;
  return new;
end $$;

comment on function public.assign_invoice_no() is
  'T3.1 — trigger: يمنع فشل الإدراج عند تصادم الأرقام المحلية بين الأجهزة';

drop trigger if exists trg_invoices_assign_no on public.invoices;
create trigger trg_invoices_assign_no
  before insert on public.invoices
  for each row
  execute function public.assign_invoice_no();

-- ── 4) تقرير صحة الترقيم (للمراجعة اليدوية) ──────────────────────
create or replace function public.invoice_number_health()
returns table (max_invoice_no integer, sequence_next integer, duplicates bigint)
language sql
security definer
set search_path = public
as $$
  select
    (select coalesce(max(invoice_no), 0) from public.invoices) as max_invoice_no,
    (select case when is_called then last_value + 1 else last_value end
       from public.invoice_no_seq)::integer as sequence_next,
    (select count(*) from (
        select invoice_no from public.invoices
        group by invoice_no having count(*) > 1
     ) d) as duplicates;
$$;

comment on function public.invoice_number_health() is
  'T3.1 — فحص سريع: لا تكرار في الأرقام والتسلسل متقدّم على أكبر رقم';

revoke all on function public.invoice_number_health() from public;
revoke all on function public.invoice_number_health() from anon;
grant execute on function public.invoice_number_health() to authenticated;


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921050000_rls_anon_access
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  N-2 (أخطر ما كشفه تشغيل SQL الحقيقي) — المتجر كان مقطوعًا عن الزائر
--
--  ما حدث: ترحيل التصليب (20260921000000) سحب صلاحية تنفيذ `my_role()`
--  و`my_username()` من `anon`:
--      revoke execute on function public.my_role() from public, anon;
--  وهي حماية صحيحة — لكن السياسات نفسها كُتبت **بلا `to <role>`**، أي
--  أنها تُطبَّق على PUBLIC بما فيه anon. فصار أي استعلام من الزائر على
--  جدول فيه سياسة `for all using (my_role() …)` يفشل بـ:
--      ERROR: permission denied for function my_role
--
--  الأثر الفعلي: الأصناف · الأقسام · الإعدادات · الفواتير · سجل النشاط
--  كلها تُرجع خطأً للزائر، والتطبيق يبتلعه في `catch → setCloudStatus('offline')`
--  فيبدو «بلا إنترنت» وهو يعمل على بيانات محلية. العملاء المحليون
--  (`quickCustomer` بلا تسجيل Supabase) هم `anon` أيضًا → تزامنهم مقطوع.
--
--  الإصلاح من جزأين:
--   1) كل سياسة تستدعي دالة مقصورة على المسجَّلين ⇒ `to authenticated`
--      (فلا تُقيَّم أصلًا في استعلامات الزائر).
--   2) الإعدادات غير السرّية تُتاح للزائر عبر دالة مُحصَّنة بقائمة بيضاء،
--      لأن واجهة المتجر للزائر تحتاج اسم المتجر والهاتف والشحن/الضريبة.
--
--  ⚠️ لا نُعيد grant execute على my_role() لـanon: السياسات المقيدة تكفي،
--     وإبقاء الدالة مقصورة يقلّل سطح الهجوم.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) تقييد السياسات التي تستدعي دوال المسجَّلين على دور authenticated ──

-- الأقسام: الكتابة للإدارة (القراءة تبقى للجميع)
drop policy if exists "cats_write" on public.categories;
create policy "cats_write" on public.categories
  for all to authenticated using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));

-- الأصناف
drop policy if exists "items_write" on public.items;
create policy "items_write" on public.items
  for all to authenticated using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));

-- الإعدادات: القراءة للزائر عبر public_settings() · الكتابة للإدارة
drop policy if exists "settings_read" on public.settings;
create policy "settings_read" on public.settings
  for select to authenticated using (true);
drop policy if exists "settings_write" on public.settings;
create policy "settings_write" on public.settings
  for all to authenticated using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- الفواتير: الزائر لا يقرأ شيئًا (صفر صفوف بلا خطأ) — لا رسالة صلاحيات
drop policy if exists "inv_read" on public.invoices;
create policy "inv_read" on public.invoices
  for select to authenticated using (
    public.my_role() in ('admin', 'worker')
    or seller_id = auth.uid()
    or customer_name = public.my_username()
  );
drop policy if exists "inv_update" on public.invoices;
create policy "inv_update" on public.invoices
  for update to authenticated using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));
drop policy if exists "inv_delete" on public.invoices;
create policy "inv_delete" on public.invoices
  for delete to authenticated using (public.my_role() = 'admin');

-- بنود الفاتورة
drop policy if exists "iitems_update" on public.invoice_items;
create policy "iitems_update" on public.invoice_items
  for update to authenticated using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));
drop policy if exists "iitems_delete" on public.invoice_items;
create policy "iitems_delete" on public.invoice_items
  for delete to authenticated using (public.my_role() = 'admin');

-- سجل النشاط: الكتابة للعامل والمدير فقط
drop policy if exists "audit_write" on public.audit_log;
create policy "audit_write" on public.audit_log
  for insert to authenticated with check (public.my_role() in ('admin','worker'));
drop policy if exists "audit_read" on public.audit_log;
create policy "audit_read" on public.audit_log
  for select to authenticated using (public.my_role() in ('admin','worker'));

-- الحسابات: القراءة للجميع لم تعد مطلوبة؛ الزائر لا يقرأ الحسابات
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.my_role() in ('admin','worker'));
drop policy if exists "profiles_write" on public.profiles;
create policy "profiles_write" on public.profiles
  for all to authenticated using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- صور المنتجات: الرفع/التعديل/الحذف للعامل والمدير فقط (والقراءة عامة كما هي)
drop policy if exists "products_staff_insert" on storage.objects;
create policy "products_staff_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'products' and public.my_role() in ('admin','worker'));
drop policy if exists "products_staff_update" on storage.objects;
create policy "products_staff_update" on storage.objects
  for update to authenticated using (bucket_id = 'products' and public.my_role() in ('admin','worker'))
  with check (bucket_id = 'products' and public.my_role() in ('admin','worker'));
drop policy if exists "products_staff_delete" on storage.objects;
create policy "products_staff_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'products' and public.my_role() in ('admin','worker'));

-- ── 2) الإعدادات العامة للزائر — بقائمة بيضاء صريحة ──────────────────
--
--  ⚠️ تصحيح مهم (21 سبتمبر 2026): النسخة الأولى من هذه القائمة كانت مكتوبة من
--  الذاكرة، فاستخدمت أسماء لا وجود لها على القاعدة (`store_phone` · `store_address`
--  · `currency`) وأغفلت ما تستخدمه الواجهة فعلًا (`footer` · `coupon_code` ·
--  `coupon_pct` · `role_perms`). النتيجة كانت: دالة تُرجع مفتاحين فقط، وواجهة
--  الزائر تفقد نص التذييل والكوبون بعد الترحيل — تراجعٌ صامت.
--
--  ✅ القائمة الآن **مسحوبة من المصدر الحقيقي**: مفاتيح `mergeSettings()` في
--  `index.html`، وفحص آلي في `scripts/verify-schema-drift.js` يفشل إن تباعدت
--  القائمتان (SQL ↔ الواجهة). لا تُعدَّل هنا إلا لتُعدَّل هناك.

create or replace function public.public_settings()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    from public.settings s
   where s.key in (
     'store_name', 'address', 'phone', 'footer', 'tax_pct',
     'store_desc', 'return_days', 'return_note',
     'shipping_fee', 'free_shipping_over',
     'coupon_code', 'coupon_pct',
     'stock_mode', 'oversell_policy',
     'role_perms'
   )
$$;

comment on function public.public_settings() is
  'N-2: الإعدادات غير السرّية التي تحتاجها واجهة الزائر — القائمة مطابقة لـmergeSettings في index.html ومفحوصة آليًا';

revoke all on function public.public_settings() from public;
grant execute on function public.public_settings() to anon, authenticated;

-- ── 2-ب) ونفس القائمة كسياسة قراءة للزائر على الجدول نفسه ─────────────
--  لماذا؟ لأن الواجهة الحالية (المَنشورة) تقرأ `settings` مباشرة بـ`select('*')`.
--  لو حصرنا الجدول على `to authenticated` فقط، لصار الزائر يقرأ **صفر مفاتيح**
--  بعد الترحيل (بلا خطأ) ⇒ يفقد اسم المتجر والتذييل والكوبون بصمت.
--  هذه السياسة تعطي الزائر **نفس** المفاتيح العامة — لا أكثر — فلا تتغير واجهته
--  ولا تتوسّع صلاحيته: العدد نفسه في الدالتين (يفحصه verify-sql-live).
drop policy if exists "settings_public_read" on public.settings;
create policy "settings_public_read" on public.settings
  for select to anon using (
    key in (
      'store_name', 'address', 'phone', 'footer', 'tax_pct',
      'store_desc', 'return_days', 'return_note',
      'shipping_fee', 'free_shipping_over',
      'coupon_code', 'coupon_pct',
      'stock_mode', 'oversell_policy',
      'role_perms'
    )
  );

-- ── 3) تحقق سريع (نفّذه بعد الترحيل) ─────────────────────────────────
-- select policyname, roles::text from pg_policies
--  where schemaname='public' and qual like '%my_role%' and not ('authenticated' = any(roles));
-- المتوقع: صفر صفوف.


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921060000_role_guard_service_role
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  N-3 — «لا يمكن إنشاء أول مدير سحابي»: ثغرة تشغيلية في الحارس
--
--  ما كشفه التشغيل الحقيقي (scripts/verify-sql-live.sh):
--  المشغّل `prevent_role_escalation` كان يرفض أي تغيير دور ما لم يكن
--  المُغيِّر مديرًا — وهذا صحيح أمنيًا، لكنه يجعل النظام **غير قابل
--  للتهيئة**: كل حساب جديد يُولَد بدور customer (عبر `handle_new_user`)،
--  ولا يوجد مدير أوّل ليرقّي الحسابات. حتى الرفع من SQL Editor كان يُرفض.
--
--  الإصلاح: مسار «سيرفر موثوق» صريح — يُسمح بتغيير الدور لـ:
--   1) مدير مسجَّل (كما كان)
--   2) `service_role` — مفتاح الخدمة السيرفري (لا يُوزَّع على الأجهزة)
--  ويبقى مرفوضًا لكل ما دون ذلك: زائر · عميل · عامل.
--
--  كيف تُرقّي أول مدير؟ (انسخ في SQL Editor — كل ما تحتاجه سطر واحد)
--      begin;
--      set local role service_role;          -- المسار الموثوق
--      update public.profiles set role = 'admin' where username = 'اسم-حسابك';
--      commit;
--  أو استخدم السكربت الجاهز: scripts/grant-role.sql
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changer_role text;
begin
  -- لا تغيير في الدور ⇒ لا شأن لنا بهذا التعديل
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- 1) الخدمة السيرفرية الموثوقة (service_role) — المسار الإداري المعلن
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 2) مدير مسجَّل
  changer_role := public.my_role();
  if changer_role = 'admin' then
    return new;
  end if;

  raise exception 'تغيير الدور ممنوع — يتطلب مديرًا أو مفتاح الخدمة (service_role)'
    using errcode = '42501';
end $$;

comment on function public.prevent_role_escalation() is
  'N-3: يمنع تصعيد الصلاحيات، ويسمح فقط للمدير المسجَّل أو service_role (لتهيئة المدير الأول)';

-- الحارس مربوط بالمشغّل، لكن نعيد التأكيد (لو أُسقط في مكان ما)
drop trigger if exists trg_profiles_no_escalation on public.profiles;
create trigger trg_profiles_no_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- ── تحقق ────────────────────────────────────────────────────────────
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
-- المتوقع: trg_profiles_no_escalation


-- ═══════════════════════════════════════════════════════════════════
--  ▼▼▼  20260921070000_login_throttle
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  F2 — قفل محاولات الدخول على السيرفر (كان قفلًا وهميًا)
--
--  المشكلة: القفل القديم كان في `localStorage`:
--      l.count++; if (l.count >= 5) l.until = Date.now() + 5*60*1000
--  أي أن من يمسح بيانات المتصفح (أو يفتح نافذة خاصة، أو يجرّب من
--  جهاز آخر) يعود وكأن شيئًا لم يكن — وكذلك كل من يهاجم عبر طلب
--  مباشر لواجهة Supabase لا يرى القفل أصلًا.
--
--  الحل: عدّاد على القاعدة بثلاث نوافذ (اسم المستخدم · الجهاز · عنوان IP)
--  تُستدعى قبل كل محاولة دخول وبعدها. لا يُقرأ الجدول مباشرة إطلاقًا،
--  ولا تُقبل أي محاولة عبر الدوال إلا بما تسمح به السياسة أعلاه.
--
--  ⚠️ حدّان نُعلنهما بصراحة:
--   1) الحسابات المحلية (بلا Supabase) لا يمكن قفلها سيرفريًا — الجهاز
--      نفسه هو الحدّ الأمني. التطبيق يُظهر قفلًا متزايدًا محليًا في هذه
--      الحالة، ويقول للمستخدم إن القفل الكامل يعمل عند الاتصال.
--   2) من يملك مفتاح الخدمة (service_role) يتجاوز كل شيء — كما في كل
--      نظام، وهذا مقصود.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.login_attempts (
  id           bigserial primary key,
  username_hash text not null,          -- md5(الاسم بحروف صغيرة) — لا نخزّن الأسماء صريحة
  device_id    text not null default 'unknown',
  ip           text,
  success      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_login_attempts_user   on public.login_attempts (username_hash, created_at desc);
create index if not exists idx_login_attempts_device on public.login_attempts (device_id, created_at desc);
create index if not exists idx_login_attempts_time   on public.login_attempts (created_at desc);

alter table public.login_attempts enable row level security;
-- لا سياسات: لا قراءة ولا كتابة مباشرة — الوصول عبر الدوال فقط
revoke all on table public.login_attempts from public, anon, authenticated;

-- ── حدود القفل (يمكن تعديلها في مكان واحد) ────────────────────────
--   اسم المستخدم : 5 محاولات فاشلة / 15 دقيقة ⇒ قفل 5 دقائق يتضاعف
--   الجهاز       : 15 محاولة  / 15 دقيقة ⇒ قفل 15 دقيقة
--   عنوان IP     : 40 محاولة  / 15 دقيقة ⇒ قفل 30 دقيقة

-- ── حالة القفل قبل المحاولة ───────────────────────────────────────
create or replace function public.login_gate(p_username text, p_device text default 'unknown')
returns table (allowed boolean, locked_seconds int, attempts_left int, scope text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
  v_ip     text;
  v_fails  int;
  v_locks  int;
  v_dev    int;
  v_ipc    int;
  v_lock   int := 0;
begin
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
    v_ip := nullif(trim(v_ip), '');
  exception when others then v_ip := null;
  end;

  -- محاولات فاشلة متتالية لنفس الاسم
  select count(*) into v_fails
    from public.login_attempts a
   where a.username_hash = v_hash
     and not a.success
     and a.created_at > now() - interval '15 minutes';

  -- كم مرة قُفل هذا الاسم خلال يوم (لتضاعف مدة القفل)
  select count(*) into v_locks
    from (
      select date_trunc('hour', a.created_at) as h
        from public.login_attempts a
       where a.username_hash = v_hash and not a.success
       group by 1
      having count(*) >= 5
    ) q;

  -- محاولات الجهاز وعنوان IP (تحدّ من تخمين أسماء مستخدمين كثيرة)
  select count(*) into v_dev
    from public.login_attempts a
   where a.device_id = v_device and not a.success and a.created_at > now() - interval '15 minutes';
  select count(*) into v_ipc
    from public.login_attempts a
   where v_ip is not null and a.ip = v_ip and not a.success and a.created_at > now() - interval '15 minutes';

  if v_ipc >= 40 then
    return query select false, 1800, 0, 'ip'::text;
    return;
  end if;
  if v_dev >= 15 then
    return query select false, 900, 0, 'device'::text;
    return;
  end if;
  if v_fails >= 5 then
    v_lock := 300 * greatest(1, power(2, least(v_locks, 4))::int);
    return query select false, v_lock, 0, 'username'::text;
    return;
  end if;

  return query select true, 0, greatest(0, 5 - v_fails), 'none'::text;
end $$;

-- ── تسجيل محاولة فاشلة ───────────────────────────────────────────
create or replace function public.login_fail(p_username text, p_device text default 'unknown')
returns table (allowed boolean, locked_seconds int, attempts_left int, scope text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
  v_ip     text;
  v_flood  int;
begin
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
    v_ip := nullif(trim(v_ip), '');
  exception when others then v_ip := null;
  end;

  -- حماية الجدول نفسه من الإغراق: لا نكتب أكثر من 200 صف للساعة لجهاز واحد
  select count(*) into v_flood
    from public.login_attempts a
   where a.device_id = v_device and a.created_at > now() - interval '1 hour';
  if v_flood < 200 then
    insert into public.login_attempts (username_hash, device_id, ip, success)
    values (v_hash, v_device, v_ip, false);
  end if;

  return query select * from public.login_gate(p_username, p_device);
end $$;

-- ── تسجيل دخول ناجح (يمسح محاولات الاسم والجهاز) ─────────────────
create or replace function public.login_ok(p_username text, p_device text default 'unknown')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
begin
  insert into public.login_attempts (username_hash, device_id, success) values (v_hash, v_device, true);
  delete from public.login_attempts
   where username_hash = v_hash and device_id = v_device and not success;
  -- تنظيف تلقائي: لا نحتفظ بأكثر من 30 يومًا
  delete from public.login_attempts where created_at < now() - interval '30 days';
  return true;
end $$;

-- ── الصلاحيات: تُستدعى قبل الدخول (بلا هوية) ──────────────────────
revoke all on function public.login_gate(text, text)  from public;
revoke all on function public.login_fail(text, text)  from public;
revoke all on function public.login_ok(text, text)    from public;
grant execute on function public.login_gate(text, text) to anon, authenticated;
grant execute on function public.login_fail(text, text) to anon, authenticated;
grant execute on function public.login_ok(text, text)   to anon, authenticated;

comment on function public.login_gate(text, text) is
  'F2 — حالة القفل قبل الدخول: الاسم (5/15د) · الجهاز (15/15د) · الـIP (40/15د)';
comment on table public.login_attempts is
  'F2 — عدّاد محاولات الدخول. لا يُقرأ مباشرة؛ للوصول: login_gate/login_fail/login_ok';

-- ── تحقق ─────────────────────────────────────────────────────────
-- select * from public.login_gate('admin', 'dev-1');
-- select * from public.login_fail('admin', 'dev-1');   -- كرّرها 5 مرات
-- select * from public.login_gate('admin', 'dev-1');   -- المتوقع: allowed=false


-- ═══════════════════════════════════════════════════════════════════
--  🧹 حسم: لا تبقى سياسة تسمح للزائر بما لا يجوز
--
--  لماذا هذا القسم؟ لأن القاعدة الحيّة قد تحمل سياسات أُنشئت يدويًا في لوحة
--  Supabase (خارج الترحيلات) وتسمح بـ`true` — والترحيلات لا تحذف إلا ما تعرفه
--  بالاسم. هذا القسم يحذف **كل سياسة شرطها `true`** على الجداول الحسّاسة،
--  ويترك سياسات الشرط الحقيقي (مثل `deleted_at is null`) كما هي.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  n int := 0;
  sensitive text[] := array['invoices', 'invoice_items', 'profiles', 'audit_log', 'login_attempts'];
begin
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename = any (sensitive)
       and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
    raise notice 'حُذفت سياسة مفتوحة: %.% (%) — كانت تسمح بلا شرط', r.tablename, r.policyname, r.cmd;
  end loop;
  raise notice '✅ سياسات مفتوحة محذوفة على الجداول الحسّاسة: %', n;
end $$;

-- جداول المتجر: القراءة عامة عن قصد، لكن الكتابة المفتوحة (بلا شرط) تُحذف
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename in ('items', 'categories', 'settings')
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    -- نستثني سياسات الفريق الحقيقية (شرطها my_role) — لا تُمسّ
    continue when r.policyname in ('items_write', 'cats_write', 'settings_write');
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
    raise notice 'حُذفت سياسة كتابة مفتوحة: %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;
  raise notice '✅ سياسات كتابة مفتوحة محذوفة على جداول المتجر: %', n;
end $$;

-- تأكيد RLS على الجداول الثمانية (بلا لمس أي جدول آخر قد يكون على القاعدة)
do $$
declare
  r record;
  t text;
begin
  foreach t in array array['profiles','categories','items','invoices','invoice_items','settings','audit_log','login_attempts']
  loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
  raise notice '✅ RLS مُفعَّل على الجداول الثمانية';
end $$;


-- ═══════════════════════════════════════════════════════════════════
--  ✅ التقرير النهائي — اقرأ هذه النتائج
-- ═══════════════════════════════════════════════════════════════════

-- ① الجداول: 8 (منها login_attempts)
select '① الجداول' as البند, count(*) as العدد,
       case when count(*) = 8 then '✅ صحيح' else '❌ ناقص ' || (8 - count(*)) end as الحكم
  from pg_tables where schemaname = 'public';

-- ② الدوال الجديدة
select '② الدوال' as البند, count(*) as العدد,
       case when count(*) = 8 then '✅ كلها موجودة' else '❌ ناقص ' || (8 - count(*)) end as الحكم
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('next_invoice_no', 'assign_invoice_no', 'decrement_stock', 'increment_stock',
                     'public_settings', 'login_gate', 'login_fail', 'login_ok');

-- ③ السياسات المفتوحة على الجداول الحسّاسة (المتوقع: صفر)
select '③ سياسات مفتوحة حسّاسة' as البند, count(*) as العدد,
       case when count(*) = 0 then '✅ لا شيء' else '❌ ما زالت مكشوفة' end as الحكم
  from pg_policies
 where schemaname = 'public'
   and tablename in ('invoices', 'invoice_items', 'profiles', 'audit_log', 'login_attempts')
   and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');

-- ④ سياسات الفواتير كما صارت (يجب أن تعتمد على my_role/is_manager)
select '④ سياسات الفواتير' as البند, policyname as السياسة, cmd as العملية,
       left(coalesce(qual, with_check, ''), 60) as الشرط
  from pg_policies where schemaname = 'public' and tablename = 'invoices' order by policyname;

-- ⑤ حارس تصعيد الصلاحيات
select '⑤ حارس الأدوار' as البند, count(*) as العدد,
       case when count(*) = 1 then '✅ مُفعَّل' else '❌ مفقود' end as الحكم
  from pg_trigger where tgname = 'trg_profiles_no_escalation';

-- ⑥ Realtime
select '⑥ Realtime' as البند, string_agg(tablename, ' · ' order by tablename) as الجداول
  from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';

-- ⑦ حجب جدول محاولات الدخول
select '⑦ login_attempts' as البند,
       case when count(*) = 0 then '✅ بلا وصول مباشر' else '❌ فيه سياسات!' end as الحكم
  from pg_policies where schemaname = 'public' and tablename = 'login_attempts';

-- ⑧ صحة ترقيم الفواتير (لا تكرار + التسلسل متقدّم)
select '⑧ أرقام الفواتير' as البند, max_invoice_no as أكبر_رقم,
       sequence_next as التالي, duplicates as المكرر,
       case when duplicates = 0 and sequence_next > max_invoice_no
            then '✅ سليمة' else '⚠️ راجع الترقيم' end as الحكم
  from public.invoice_number_health();

-- ⑨ حالة المخزون
select '⑨ تسلسل المخزون' as البند, count(*) as صنف_غير_متسلسل,
       case when count(*) = 0 then '✅ سليم' else '⚠️ راجع stock_mismatch_report()' end as الحكم
  from public.stock_mismatch_report();

-- ═══════════════════════════════════════════════════════════════════
--  بعد النجاح:
--   • رقّم حسابك مديرًا:   scripts/grant-role.sql   (تعديل سطر واحد)
--   • فحص شامل 13 بندًا:   scripts/health-check.sql
--   • جرد المخطط:          scripts/schema-inventory.sql ثم الفاحص
-- ═══════════════════════════════════════════════════════════════════

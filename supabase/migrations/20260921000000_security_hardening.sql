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

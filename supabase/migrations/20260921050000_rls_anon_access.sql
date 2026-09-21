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

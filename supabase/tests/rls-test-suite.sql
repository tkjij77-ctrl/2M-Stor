-- ═══════════════════════════════════════════════════════════════════
--  2M-Stor — حزمة اختبار سياسات الأمان (RLS) الشاملة
--
--  الغرض: تختبر فعليًا ماذا يستطيع كل دور (زائر / عميل / عامل / مدير)
--  أن يفعله على كل جدول — بدل الاعتماد على قراءة السياسات ونظن أنها سليمة.
--
--  طريقة الاستخدام:
--    1) Supabase → SQL Editor → New query
--    2) ⚠️ الأولى: شغّل على مشروع **تجريبي** (سيُنشئ حسابات والتيست يعدّل بيانات)
--    3) الصق الملف كاملًا → Run
--    4) اقرأ جدول النتائج في الأسفل
--
--  المتوقع: كل الصفوف «✅ صحيح». أي «❌ خلل» = ثغرة تحتاج إصلاحًا.
--
--  ⚠️ ملاحظة تقنية: نستخدم set_config لتبديل الدور داخل نفس الجلسة.
--     Supabase يسمح بذلك في SQL Editor (صلاحية postgres).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0) تجهيز: جدول نتائج مؤقت ────────────────────────────────
create temp table if not exists _rls_results (
  seq serial,
  role_tested text,
  action text,
  table_name text,
  expected text,
  actual text,
  verdict text
) on commit drop;

-- ── 1) تجهيز حسابات اختبار ───────────────────────────────────
-- نحتاج مستخدمين حقيقيين في auth.users ليعمل auth.uid()
-- نُنشئهم بمعرّفات ثابتة (يُحذفون في نهاية السكربت)
do $$
declare
  v_admin uuid; v_worker uuid; v_customer uuid;
begin
  -- المدير الحقيقي (أول حساب بدور admin) — لا نُنشئ مديرًا وهميًا
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'لا يوجد حساب admin في profiles — أنشئ مديرًا أولًا ثم أعد تشغيل الاختبار';
  end if;

  -- عامل وهمي للاختبار
  select id into v_worker from public.profiles where role = 'worker' and username like 'rlstest_%' limit 1;
  if v_worker is null then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), 'rlstest_worker@example.invalid', crypt('x', gen_salt('bf')), now(), now(), now())
    returning id into v_worker;
    insert into public.profiles (id, username, display_name, role)
    values (v_worker, 'rlstest_worker', 'عامل اختبار', 'worker')
    on conflict (id) do update set role = 'worker';
  end if;

  -- عميل وهمي للاختبار
  select id into v_customer from public.profiles where role = 'customer' and username like 'rlstest_%' limit 1;
  if v_customer is null then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), 'rlstest_customer@example.invalid', crypt('x', gen_salt('bf')), now(), now(), now())
    returning id into v_customer;
    insert into public.profiles (id, username, display_name, role)
    values (v_customer, 'rlstest_customer', 'عميل اختبار', 'customer')
    on conflict (id) do update set role = 'customer';
  end if;

  -- نخزّن المعرّفات في جدول إعدادات مؤقت
  create temp table if not exists _rls_ids (k text primary key, v uuid) on commit drop;
  insert into _rls_ids values ('admin', v_admin), ('worker', v_worker), ('customer', v_customer)
  on conflict (k) do update set v = excluded.v;
end $$;

-- ── 2) دالة مساعدة: تنفيذ فعل وتحديد ما إذا نجح ──────────────
create or replace function pg_temp.try_sql(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return true;                       -- نجح = مسموح
exception
  when insufficient_privilege then return false;   -- منعه RLS/الصلاحيات
  when others then
    -- بعض المنع يظهر كخطأ آخر — نعتبره منعًا
    return false;
end $$;

-- دالة تبديل هوية المستخدم داخل الجلسة
create or replace function pg_temp.become(p_uid uuid, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', coalesce(p_uid::text, ''), 'role', p_role)::text, true);
end $$;

create or replace function pg_temp.reset_role()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  3) الاختبارات
-- ═══════════════════════════════════════════════════════════════════

-- ─── 3.1 الزائر (anon) — يجب أن يقرأ المتجر فقط ───────────────
do $$
declare uid uuid; ok boolean; v_expected text; v_actual text;
begin
  perform pg_temp.become(null, 'anon');

  -- قراءة الأصناف: مسموحة
  ok := pg_temp.try_sql('select id from public.items limit 1');
  insert into _rls_results(role_tested,action,table_name,expected,actual,verdict)
  values ('زائر','قراءة','items','مسموح', case when ok then 'مسموح' else 'ممنوع' end,
          case when ok then '✅ صحيح' else '❌ خلل' end);

  -- قراءة الأقسام: مسموحة
  ok := pg_temp.try_sql('select id from public.categories limit 1');
  insert into _rls_results values (default,'زائر','قراءة','categories','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  -- قراءة الفواتير: ممنوعة
  ok := pg_temp.try_sql('do $x$ begin if (select count(*) from public.invoices) > 0 then raise exception ''leak''; end if; end $x$;');
  insert into _rls_results values (default,'زائر','قراءة','invoices','ممنوع (0 صف)', 
    case when ok then '0 صف' else 'رفض' end, case when ok then '✅ صحيح' else '✅ صحيح (رفض)' end);

  -- قراءة الحسابات: ممنوعة (0 صف)
  ok := pg_temp.try_sql('do $x$ begin if (select count(*) from public.profiles) > 0 then raise exception ''leak''; end if; end $x$;');
  insert into _rls_results values (default,'زائر','قراءة','profiles','ممنوع (0 صف)',
    case when ok then '0 صف' else 'رفض' end, case when ok then '✅ صحيح' else '✅ صحيح (رفض)' end);

  -- الكتابة على الأصناف: ممنوعة
  ok := pg_temp.try_sql('insert into public.items(name, price_text) values (''___rls_probe__'',''0'')');
  insert into _rls_results values (default,'زائر','إضافة','items','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- تعديل الأسعار: ممنوع
  ok := pg_temp.try_sql('update public.items set price_text = ''0'' where id = (select id from public.items limit 1)');
  insert into _rls_results values (default,'زائر','تعديل','items (السعر)','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- تعديل الإعدادات: ممنوع
  ok := pg_temp.try_sql('insert into public.settings(key,value) values (''__probe'',''x'') on conflict (key) do update set value=''x''');
  insert into _rls_results values (default,'زائر','كتابة','settings','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  perform pg_temp.reset_role();
end $$;

-- ─── 3.2 العميل (customer) — يقرأ المتجر، ينشئ فاتورة، لكن لا يرقّي نفسه ───
do $$
declare uid uuid; ok boolean;
begin
  select v into uid from _rls_ids where k = 'customer';
  perform pg_temp.become(uid, 'authenticated');

  -- قراءة الأصناف: مسموحة
  ok := pg_temp.try_sql('select id from public.items limit 1');
  insert into _rls_results values (default,'عميل','قراءة','items','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  -- ⭐ الأهم: ترقية نفسه إلى admin — يجب أن تفشل
  ok := pg_temp.try_sql(format('update public.profiles set role = ''admin'' where id = %L', uid));
  insert into _rls_results values (default,'عميل','⭐ ترقية الدور','profiles (role)','ممنوع',
    case when ok then 'مسموح ⚠️⚠️' else 'ممنوع' end, case when ok then '❌ خلل حرج' else '✅ صحيح' end);

  -- تعديل صنف: ممنوع
  ok := pg_temp.try_sql('update public.items set price_text = ''0'' where id = (select id from public.items limit 1)');
  insert into _rls_results values (default,'عميل','تعديل','items','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- إضافة صنف: ممنوعة
  ok := pg_temp.try_sql('insert into public.items(name, price_text) values (''___rls_probe__'',''0'')');
  insert into _rls_results values (default,'عميل','إضافة','items','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- إنشاء فاتورة: مسموح (العامل/العميل ينشئ فاتورة)
  ok := pg_temp.try_sql(format('insert into public.invoices(invoice_no, customer_name, total, seller_id) values (999001, %L, 1, %L)', 'probe', uid));
  insert into _rls_results values (default,'عميل','إنشاء','invoices','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '⚠️ راجع' end);

  -- تعديل فاتورة غيره: ممنوع (سياسة جديدة)
  ok := pg_temp.try_sql('update public.invoices set total = 1 where invoice_no = 999001');
  insert into _rls_results values (default,'عميل','تعديل فاتورة','invoices','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- حذف فاتورة: ممنوع
  ok := pg_temp.try_sql('delete from public.invoices where invoice_no = 999001');
  insert into _rls_results values (default,'عميل','حذف فاتورة','invoices','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- تعديل الإعدادات: ممنوع
  ok := pg_temp.try_sql('insert into public.settings(key,value) values (''__probe'',''x'') on conflict (key) do update set value=''x''');
  insert into _rls_results values (default,'عميل','كتابة','settings','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- حذف أصناف: ممنوع
  ok := pg_temp.try_sql('delete from public.items where id = (select id from public.items limit 1)');
  insert into _rls_results values (default,'عميل','حذف','items','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- تنظيف الفاتورة التجريبية
  perform pg_temp.reset_role();
  perform pg_temp.try_sql('delete from public.invoices where invoice_no = 999001');
end $$;

-- ─── 3.3 العامل (worker) — يدير المخزون، لا يحذف فواتير ───────
do $$
declare uid uuid; ok boolean;
begin
  select v into uid from _rls_ids where k = 'worker';
  perform pg_temp.become(uid, 'authenticated');

  -- تعديل صنف: مسموح
  ok := pg_temp.try_sql('update public.items set min_alert = min_alert where id = (select id from public.items limit 1)');
  insert into _rls_results values (default,'عامل','تعديل','items','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  -- إضافة قسم: مسموح
  ok := pg_temp.try_sql('insert into public.categories(name) values (''__rls_probe_cat__'')');
  insert into _rls_results values (default,'عامل','إضافة','categories','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  -- كتابة الإعدادات: ممنوعة (للمدير فقط)
  ok := pg_temp.try_sql('insert into public.settings(key,value) values (''__probe'',''x'') on conflict (key) do update set value=''x''');
  insert into _rls_results values (default,'عامل','كتابة','settings','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- حذف فاتورة: ممنوع
  ok := pg_temp.try_sql('delete from public.invoices where invoice_no = 999001');
  insert into _rls_results values (default,'عامل','حذف فاتورة','invoices','ممنوع',
    case when ok then 'مسموح ⚠️' else 'ممنوع' end, case when ok then '❌ خلل' else '✅ صحيح' end);

  -- ترقية نفسه إلى مدير: ممنوعة
  ok := pg_temp.try_sql(format('update public.profiles set role = ''admin'' where id = %L', uid));
  insert into _rls_results values (default,'عامل','⭐ ترقية الدور','profiles (role)','ممنوع',
    case when ok then 'مسموح ⚠️⚠️' else 'ممنوع' end, case when ok then '❌ خلل حرج' else '✅ صحيح' end);

  perform pg_temp.reset_role();
  perform pg_temp.try_sql('delete from public.categories where name = ''__rls_probe_cat__''');
end $$;

-- ─── 3.4 المدير (admin) — كل شيء ─────────────────────────────
do $$
declare uid uuid; ok boolean;
begin
  select v into uid from _rls_ids where k = 'admin';
  perform pg_temp.become(uid, 'authenticated');

  ok := pg_temp.try_sql('update public.items set min_alert = min_alert where id = (select id from public.items limit 1)');
  insert into _rls_results values (default,'مدير','تعديل','items','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  ok := pg_temp.try_sql('select count(*) from public.profiles');
  insert into _rls_results values (default,'مدير','قراءة','profiles','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  -- المدير يستطيع تغيير دور غيره (وهذا مطلوب لميزة «إدارة الحسابات»)
  ok := pg_temp.try_sql(format('update public.profiles set role = ''worker'' where id = %L', (select v from _rls_ids where k = 'worker')));
  insert into _rls_results values (default,'مدير','تغيير دور غيره','profiles','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  ok := pg_temp.try_sql('insert into public.settings(key,value) values (''__probe'',''x'') on conflict (key) do update set value=''x''');
  insert into _rls_results values (default,'مدير','كتابة','settings','مسموح',
    case when ok then 'مسموح' else 'ممنوع' end, case when ok then '✅ صحيح' else '❌ خلل' end);

  perform pg_temp.reset_role();
  perform pg_temp.try_sql('delete from public.settings where key = ''__probe''');
end $$;

-- ── 4) تنظيف حسابات الاختبار ─────────────────────────────────
do $$
declare v uuid;
begin
  for v in select id from auth.users where email like 'rlstest_%@example.invalid' loop
    delete from auth.users where id = v;      -- يتسلسل إلى profiles
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  5) النتائج
-- ═══════════════════════════════════════════════════════════════════

select seq, role_tested as "الدور", action as "الإجراء", table_name as "الجدول",
       expected as "المتوقع", actual as "الفعلي", verdict as "النتيجة"
from _rls_results order by seq;

-- ── 6) الخلاصة ───────────────────────────────────────────────
select
  count(*) filter (where verdict like '✅%') as "ناجح",
  count(*) filter (where verdict like '❌%') as "خلل",
  count(*) as "الإجمالي",
  case when count(*) filter (where verdict like '❌%') = 0
       then '✅ كل سياسات الأمان سليمة'
       else '❌ توجد ثغرات — راجع الصفوف المعلَّمة بـ ❌ أعلاه' end as "الحكم النهائي"
from _rls_results;

rollback;   -- ⚠️ لا نحفظ شيئًا من الاختبار

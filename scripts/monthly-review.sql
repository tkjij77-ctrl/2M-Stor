-- ═══════════════════════════════════════════════════════════════════
--  T5.4 — المراجعة الشهرية (1 ساعة): الحسابات · السجل · الأمان · البيانات
--
--  الاستخدام: Supabase → SQL Editor → الصق → Run → راجع كل قسم
--  ⚠️ قراءة فقط — لا يعدّل شيئًا.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) الحسابات وأدوارها (هل هناك دور غريب؟) ─────────────────────
select '① الحسابات' as القسم, username, display_name, role, created_at,
       case when role = 'admin' then 'مدير'
            when role = 'worker' then 'عامل'
            else 'عميل' end as التصنيف
  from public.profiles
 order by role, username;

select '①-ب ملخص الأدوار' as القسم, role, count(*) as العدد
  from public.profiles group by role order by 3 desc;

-- ── 2) محاولات تغيير الدور (هل حاول أحدٌ الصعود؟) ────────────────
select '② محاولات صعود' as القسم, al.created_at, p.username, al.action, al.details
  from public.audit_log al
  left join public.profiles p on p.id = al.user_id
 where al.action ~ 'دور|صلاحي|ترقية'
 order by al.created_at desc
 limit 30;

-- ── 3) آخر 50 حدثًا في السجل ─────────────────────────────────────
select '③ سجل النشاط' as القسم, al.created_at, p.username, al.action,
       left(coalesce(al.details, ''), 60) as التفاصيل
  from public.audit_log al
  left join public.profiles p on p.id = al.user_id
 order by al.created_at desc
 limit 50;

-- ── 4) أكثر من يعمل على النظام (هذا الشهر) ───────────────────────
select '④ الأكثر نشاطًا' as القسم, coalesce(p.username, 'غير معروف') as المستخدم,
       count(*) as عدد_الأحداث
  from public.audit_log al
  left join public.profiles p on p.id = al.user_id
 where al.created_at > now() - interval '30 days'
 group by 2
 order by 3 desc
 limit 10;

-- ── 5) مبيعات الشهر وأكبر الأصناف حركة ───────────────────────────
select '⑤ مبيعات الشهر' as القسم,
       count(distinct i.id) as عدد_الفواتير,
       coalesce(sum(i.total), 0) as الإجمالي,
       coalesce(round(avg(i.total), 1), 0) as متوسط_الفاتورة
  from public.invoices i
 where i.created_at > now() - interval '30 days';

select '⑤-ب أكثر الأصناف بيعًا' as القسم, ii.item_name as الصنف,
       sum(ii.qty) as الكمية, round(sum(ii.qty * ii.price), 2) as القيمة
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
 where i.created_at > now() - interval '30 days'
 group by 2 order by 3 desc limit 15;

-- ── 6) الأمان: هل السياسات سليمة؟ ────────────────────────────────
select '⑥-أ سياسات بلا تقييد دور' as القسم, tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public'
   and qual like '%my_role%'
   and not ('authenticated' = any(roles))
 order by tablename, policyname;   -- المتوقع: صفر صفوف

select '⑥-ب جداول بلا RLS' as القسم, c.relname as الجدول
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;  -- المتوقع: صفر

select '⑥-ج دوال متاحة للزائر أكثر من اللازم' as القسم,
       p.proname,
       array_to_string(p.proacl, ', ') as الصلاحيات
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proacl is not null
   and exists (select 1 from unnest(p.proacl) a where a::text like 'anon=%')
   and p.proname not in ('public_settings',
                         -- F2: دوال القفل **مصمَّمة للزائر** — من يحاول الدخول غير مسجَّل
                         -- بالتعريف، فلو حُرمت لانهار القفل نفسه.
                         'login_gate', 'login_fail', 'login_ok')
 order by 2;   -- المتوقع: لا شيء (الدوال الأربع أعلاه مستثناة عن قصد)

select '⑥-د حسابات قادرة على الدخول' as القسم, rolname, rolcanlogin, rolsuper
  from pg_roles
 where rolcanlogin order by 1;

-- ── 7) نظافة البيانات ────────────────────────────────────────────
select '⑦-أ خلاصة المخزون' as القسم,
       (select count(*) from public.items where deleted_at is null) as أصناف_حية,
       (select count(*) from public.items where deleted_at is not null) as محذوفة,
       (select count(*) from public.categories where deleted_at is null) as أقسام,
       (select count(*) from public.items where deleted_at is null and coalesce(price_num,0) = 0) as بلا_سعر,
       (select count(*) from public.items where deleted_at is null and category_id is null) as بلا_قسم;

select '⑦-ب انحراف المخزون' as القسم, * from public.stock_mismatch_report() limit 30;
select '⑦-ج صحة الترقيم' as القسم, * from public.invoice_number_health();

-- ── 8) حكوكة النسخ الاحتياطي (يبقى تذكيرًا بشريًا) ───────────────
select '⑧ تذكير' as القسم,
       'تأكد من: نسخة أمس في GitHub Actions · تجربة استعادة واحدة هذا الشهر على التجريب · تحديث الحزم' as المهمة,
       current_date as التاريخ;

-- ═══════════════════════════════════════════════════════════════════
--  T3.6 — تنظيف بيانات الاختبار من المتجر الحقيقي
--
--  الغرض: كشف ما تسرّب من تجارب سابقة إلى متجرك الحقيقي:
--  كميات مستحيلة · أصناف مكرّرة · أسماء تجريبية · فواتير وهمية.
--
--  ⚠️ هذا الملف **للقراءة فقط** — لا يعدّل شيئًا. راجع النتائج، ثم
--     نفّذ الإصلاح من قسم «الإصلاح» أسفله (معلّق، لا يعمل حتى تفتحه).
--
--  الاستخدام: Supabase → SQL Editor → New query → الصق → Run
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) كميات مستحيلة (أشهر أثر لبيانات الاختبار) ──────────────────
select 'كمية مستحيلة' as kind, id, name, stock_q, display_qs, updated_at
  from public.items
 where deleted_at is null
   and (display_qs > 1000 or stock_q > 1000 or display_qs < 0 or stock_q < 0)
 order by display_qs desc;

-- ── 2) المعروض أكثر من المخزون (خطأ جرد أو بيانات تجريبية) ────────
select 'معروض > المخزون' as kind, id, name, stock_q, display_qs
  from public.items
 where deleted_at is null and display_qs > stock_q and stock_q >= 0
 order by (display_qs - stock_q) desc
 limit 50;

-- ── 3) أسماء مكرّرة (نفس الصنف مرتين ⇒ جرد مضاعف) ─────────────────
select 'اسم مكرّر' as kind, name, count(*) as copies, min(id) as first_id, max(id) as last_id
  from public.items
 where deleted_at is null
 group by name
having count(*) > 1
 order by copies desc;

-- ── 4) أسماء تبدو تجريبية ────────────────────────────────────────
select 'اسم تجريبي' as kind, id, name, stock_q, display_qs, updated_at
  from public.items
 where deleted_at is null
   and (name ~* '(^|\s)(test|تجريب|اختبار|قسم الاختبار|منتج [أ-ي]|صنف [أ-ي]|sample|dummy)'
        or name ~ '^[[:space:]]*$')
 order by updated_at desc;

-- ── 5) أصناف بلا قسم أو بسعر صفر (لا يمكن بيعها) ──────────────────
select 'صنف بلا قسم' as kind, id, name, price_num
  from public.items where deleted_at is null and category_id is null
union all
select 'سعر صفر', id, name, price_num
  from public.items where deleted_at is null and coalesce(price_num, 0) = 0
 order by 1, 2
 limit 100;

-- ── 6) فواتير تجريبية أو غير منطقية ──────────────────────────────
select 'فاتورة مشبوهة' as kind, id, invoice_no, customer_name, total, status, created_at
  from public.invoices
 where customer_name ~* '(test|تجريب|اختبار|عميل-|نقدي\s*$)'
    or total = 0
    or total < 0
    or created_at > now() + interval '1 day'   -- تاريخ مستقبلي = ساعة جهاز خاطئة
 order by created_at desc
 limit 50;

-- ── 7) أقسام فارغة تمامًا ────────────────────────────────────────
select 'قسم بلا أصناف' as kind, c.id, c.name, c.updated_at
  from public.categories c
 where c.deleted_at is null
   and not exists (select 1 from public.items i where i.category_id = c.id and i.deleted_at is null)
 order by c.id;

-- ── 8) خلاصة سريعة ───────────────────────────────────────────────
select
  (select count(*) from public.items where deleted_at is null)                          as أصناف_حية,
  (select count(*) from public.items where deleted_at is not null)                       as محذوفة,
  (select count(*) from public.items where deleted_at is null and display_qs > 1000)     as كميات_مستحيلة,
  (select count(*) from public.categories where deleted_at is null)                      as أقسام,
  (select count(*) from public.invoices)                                                 as فواتير,
  (select count(*) from public.invoices where created_at > now() - interval '7 days')    as فواتير_أسبوع;

-- ═══════════════════════════════════════════════════════════════════
--  🧹 الإصلاح — افتح ما تحتاجه فقط، بعد التأكد من النتائج أعلاه
--
--  ⚠️ خُذ نسخة احتياطية أولًا (T0.1)، ولا تُنفّذ شيئًا لم تراجعه بعينك.
-- ═══════════════════════════════════════════════════════════════════

-- (أ) تصفير الكميات المستحيلة إلى قيمة معقولة (10) بدل حذف الصنف
--     ⚠️ لا يُستخدم إلا بعد التحقق أن الصنف حقيقي ومحتاجه في المخزن فعلًا
-- begin;
--   update public.items
--      set display_qs = least(display_qs, 10),
--          stock_q    = least(stock_q, 10),
--          updated_at = now()
--    where deleted_at is null and (display_qs > 1000 or stock_q > 1000);
-- commit;

-- (ب) حذف ناعم للأسعار الصفرية والمكرّرة بلا رجعة؟ لا —
--     الأنسب: إخفاؤها من العرض بدل حذفها (يسهل الاسترجاع)
-- begin;
--   update public.items set display_qs = 0, updated_at = now()
--    where deleted_at is null and coalesce(price_num, 0) = 0;
-- commit;

-- (ج) مراجعة الفواتير المشبوهة يدويًا قبل أي حذف:
--     الحذف النهائي للفواتير ممنوع في النظام (audit) — استخدم الحالة بدل الحذف
-- begin;
--   update public.invoices set status = 'ملغاة', updated_at = now()
--    where customer_name ~* '(test|تجريب|اختبار)' and total = 0;
-- commit;

-- (د) حفظ نتيجة هذا الفحص في سجل النشاط (اختياري — للتتبع)
-- insert into public.audit_log (user_id, action, details)
-- values (auth.uid(), 'فحص بيانات الاختبار', 'T3.6 — راجع تقرير clean-test-data.sql');

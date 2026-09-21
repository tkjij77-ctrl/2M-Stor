-- ═══════════════════════════════════════════════════════════════════
--  فحص صحة المتجر — جدول واحد يُقرأ في 10 ثوانٍ
--
--  الاستخدام:
--   • يدويًا: Supabase → SQL Editor → الصق → Run
--   • آليًا:  يشمله scripts/verify-sql-live.sh على قاعدة تجريبية
--  الفكرة: كل سطر يقول «هل هذا الجزء سليم؟» مع الرقم الذي يثبته.
-- ═══════════════════════════════════════════════════════════════════

with
  it as (select * from public.items where deleted_at is null),
  inv as (select * from public.invoices),
  checks as (
    select 1 as ord, 'أصناف حيّة' as البند,
           count(*)::text as القيمة,
           case when count(*) > 0 then '✅' else '⚠️ المتجر بلا أصناف!' end as الحالة
      from it
    union all
    select 2, 'أصناف نفدت (معروض = 0)',
           count(*)::text,
           case when count(*) = 0 then '✅' else '⚠️ راجع التوريد' end
      from it where coalesce(display_qs, 0) = 0
    union all
    select 3, 'أصناف تحت حد التنبيه',
           count(*)::text,
           case when count(*) = 0 then '✅' else '⚠️ اطلب توريد' end
      from it where display_qs > 0 and display_qs <= coalesce(min_alert, 5)
    union all
    select 4, 'كميات مستحيلة (بيانات تجريبية؟)',
           count(*)::text,
           case when count(*) = 0 then '✅' else '❌ نفّذ scripts/clean-test-data.sql' end
      from it where display_qs > 1000 or stock_q > 1000 or display_qs < 0 or stock_q < 0
    union all
    select 5, 'معروض أكبر من المخزون',
           count(*)::text,
           case when count(*) = 0 then '✅' else '⚠️ خلل جرد' end
      from it where display_qs > stock_q and stock_q >= 0
    union all
    select 6, 'فواتير بلا رقم رسمي',
           count(*)::text,
           case when count(*) = 0 then '✅' else '❌ حارس الترقيم يعمل عند أول إدراج' end
      from inv where coalesce(invoice_no, 0) <= 0
    union all
    select 7, 'أرقام فواتير مكرّرة',
           count(*)::text,
           case when count(*) = 0 then '✅' else '❌ خلل ترقيم مركزي' end
      from (select invoice_no from inv group by invoice_no having count(*) > 1) d
    union all
    select 8, 'فواتير بلا بنود',
           count(*)::text,
           case when count(*) = 0 then '✅' else '⚠️ بنود لم تُرفع (راجع الطابور)' end
      from inv i where not exists (select 1 from public.invoice_items x where x.invoice_id = i.id)
    union all
    select 9, 'آخر فاتورة مسجّلة',
           coalesce(to_char(max(created_at), 'YYYY-MM-DD HH24:MI'), 'لا يوجد'),
           case when coalesce(max(created_at), now()) > now() - interval '30 days' then '✅' else '⚠️ لا بيع منذ 30 يومًا' end
      from inv
    union all
    select 10, 'حسابات: مدير / عامل / عميل',
           (select count(*) from public.profiles where role = 'admin')::text || ' / ' ||
           (select count(*) from public.profiles where role = 'worker')::text || ' / ' ||
           (select count(*) from public.profiles where role = 'customer')::text,
           case when (select count(*) from public.profiles where role = 'admin') >= 1 then '✅' else '❌ لا مدير!' end
    union all
    select 11, 'أقسام بلا أصناف',
           count(*)::text,
           case when count(*) = 0 then '✅' else '⚠️ نظّفها أو أضف أصنافًا' end
      from public.categories c
     where c.deleted_at is null
       and not exists (select 1 from public.items i where i.category_id = c.id and i.deleted_at is null)
    union all
    select 12, 'محمول في سلة المهملات',
           (select count(*) from public.items where deleted_at is not null)::text || ' صنف · ' ||
           (select count(*) from public.categories where deleted_at is not null)::text || ' قسم',
           'ℹ️ للاستعادة: trash_list()'
    union all
    select 13, 'ملفات الصور المرفوعة',
           (select count(*) from storage.objects where bucket_id = 'products')::text,
           'ℹ️ دلو products'
  )
select البند, القيمة, الحالة
  from checks
 order by ord;

-- ── اتجاه آخر تعديل (يكشف جهازًا يتزامن رغم عدم وجود نشاط) ─────────
select coalesce(max(updated_at), now()) as آخر_تعديل_صنف,
       round(extract(epoch from now() - max(updated_at)) / 3600.0, 1) as منذ_ساعات
  from public.items;

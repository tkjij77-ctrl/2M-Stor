-- ═══════════════════════════════════════════════════════════════════════════
--  T7.6/أ — تطبيق إسقاطَي القراءة (SEC-1) على قاعدة الإنتاج
--
--  الثغرة المؤكَّدة على قاعدة الإنتاج قبل هذا الترحيل (2026-11-09):
--    `anon` كان يملك SELECT/INSERT/UPDATE/DELETE/TRUNCATE على public.items
--    مع 456 صنفًا حقيقيًا ⇒ أي زائر يقرأ جرد المخزن:
--        GET /rest/v1/items?select=stock_q,display_qs,min_alert
--
--  ما نُفِّذ فعليًا على القاعدة:
--    1) items_public ← للزائر: بيانات المنتج + حالة مخزون مُبهمة، بلا أرقام.
--    2) items_staff  ← للموظف فقط (صفر صفوف لغير الموظف).
--    3) سحب كل صلاحيات الكتابة/الإدارة على الجدول الخام من anon.
--
--  ⚠️ ما لم يُنفَّذ عمدًا (T7.6/ب): سحب SELECT على items من anon، لأن الموقع
--     المنشور حاليًا (GitHub Pages) يقرأ items.select('*') مباشرة — سحبه
--     الآن يُفرغ المتجر على الزبائن فورًا. يُنفَّذ فور نشر الواجهة الجديدة.
--
--  آمن الإعادة بالكامل · لا يمسّ أي صف بيانات.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) إسقاط الزائر: بيانات المنتج + حالة المخزون بدون أرقام ──────────────
create or replace view public.items_public as
select
  i.id,
  i.category_id,
  i.name,
  i.price_text,
  i.price_num,
  i.barcode,
  i.image_url,
  i.description,
  i.old_price,
  i.images,
  i.updated_at,
  -- الحالة وحدها: لا رقم يُقرأ منه حجم الجرد
  case
    when coalesce(i.display_qs, 0) <= 0 then 'out'
    when coalesce(i.display_qs, 0) <= 3 then 'low'
    else 'in'
  end as stock_state,
  -- العدد الحقيقي يُكشف فقط في نطاق «آخر قطعة/قطعتين/٣» — وهو ما تعرضه
  -- الواجهة للعميل أصلًا، ولا يُستنتج منه حجم المخزن.
  case
    when coalesce(i.display_qs, 0) between 1 and 3 then i.display_qs
    else null
  end as low_qty
from public.items i
where i.deleted_at is null;   -- المحذوف ناعمًا لا يظهر للزائر أبدًا

comment on view public.items_public is
  'SEC-1: ما يراه الزائر من الأصناف — بلا stock_q/display_qs/min_alert (حالة مخزون مُبهمة فقط)';

-- ── 2) إسقاط الموظفين: كل الأعمدة، لكن لغير الموظف صفر صفوف ───────────────
-- View بصلاحية المالك (default) ⇒ يتجاوز RLS، ولذلك الفلتر صريح داخل الاستعلام.
create or replace view public.items_staff as
select i.*
from public.items i
where public.is_staff();

comment on view public.items_staff is
  'SEC-1: الأصناف كاملة (بأرقام المخزون) — تُرجع صفر صفوف لمن ليس عاملًا/مديرًا';

-- ── 3) الصلاحيات ───────────────────────────────────────────────────────────
revoke all on public.items_public  from public;
revoke all on public.items_staff   from public;
grant select on public.items_public to anon, authenticated;
grant select on public.items_staff  to authenticated;   -- anon لا يحتاجه إطلاقًا

-- ── 4) تحقق ذاتي داخل الترحيل (يفشل بصوت عالٍ بدل أن يمرّ صامتًا) ──────────
do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'items_public';

  if v_cols is null then
    raise exception 'T7.6/أ: items_public لم تُنشأ';
  end if;
  if v_cols ~* '(^|,)(stock_q|display_qs|min_alert)(,|$)' then
    raise exception 'T7.6/أ: items_public يكشف أعمدة مخزون رقمية → %', v_cols;
  end if;
  if not has_table_privilege('anon', 'public.items_public', 'select') then
    raise exception 'T7.6/أ: anon لا يقرأ items_public — المتجر سينكسر';
  end if;
  if not has_table_privilege('authenticated', 'public.items_staff', 'select') then
    raise exception 'T7.6/أ: الموظف لا يقرأ items_staff';
  end if;
  if has_table_privilege('anon', 'public.items', 'insert')
     or has_table_privilege('anon', 'public.items', 'update')
     or has_table_privilege('anon', 'public.items', 'delete') then
    raise exception 'T7.6/أ: anon ما زال يملك الكتابة على items';
  end if;

  raise notice '✅ T7.6/أ: الإسقاطان جاهزان · anon بلا كتابة · القراءة الخام تُغلق في T7.6/ب بعد النشر';
end $$;

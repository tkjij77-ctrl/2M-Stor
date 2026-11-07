-- ═══════════════════════════════════════════════════════════════════════════
--  20261107090000_items_stock_projection.sql
--  SEC-1 — أرقام المخزون كانت مكشوفة لأي زائر عبر الـAPI
--
--  الثغرة (كشفها تدقيق 7 نوفمبر 2026):
--    سياسة `items_read` هي `using (deleted_at is null or is_staff())` — صحيحة
--    لمنع رؤية المحذوف، لكنها **صفّية لا عمودية**. ومع منح `select` على الجدول
--    كله لـ`anon`، صار أي زائر يستطيع:
--        GET /rest/v1/items?select=stock_q,display_qs,min_alert
--    فيقرأ جرد المخزن كاملًا (وهو ما يخفيه التطبيق عن العميل في الواجهة فقط
--    عبر `availText()`). إخفاء في الواجهة = صفر أمان: البيانات تُحمَّل أصلًا
--    إلى متصفح الزائر.
--
--  الحل — إسقاطان (projections) بدل الجدول الخام:
--    1) items_public  ← لكل زائر/عميل: بيانات المنتج + حالة مخزون **مُبهمة**
--                       ('out' · 'low' · 'in') بدل الأرقام، والعدد الحقيقي
--                       يُكشف فقط عندما يكون ≤ 3 (وهو ما تعرضه الواجهة
--                       أصلًا: «آخر N قطع») — لا تسريب لجرد المتجر.
--    2) items_staff   ← للعامل والمدير فقط: كل الأعمدة (view يفلتر بـis_staff()
--                       فمن ليس موظفًا يحصل على صفر صفوف، لا على خطأ).
--    ثم: سحب `select` على `public.items` من `anon` نهائيًا.
--    (القراءة لغير الموظفين تمر عبر items_public حصرًا.)
--
--  التوافق الخلفي: التطبيق يسقط تلقائيًا إلى `items` إن لم يكن هذا الترحيل
--  منفَّذًا بعد (انظر web/cloud.js — pullAll)، فلا ينكسر المتجر بترتيب النشر.
--
--  آمن الإعادة بالكامل (idempotent) — لا يمسّ أي بيانات ولا أي صف.
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

-- ⛔️ الإغلاق الفعلي: لا قراءة خام للأصناف من الزائر بعد اليوم
revoke select on public.items from anon;

-- ── 4) تحقق ذاتي داخل الترحيل (يفشل بصوت عالٍ بدل أن يمرّ صامتًا) ──────────
do $$
declare
  v_cols text;
  v_anon_select boolean;
begin
  -- أ) الإسقاط العام لا يحتوي أي عمود مخزون رقمي
  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'items_public';

  if v_cols ~* '(^|,)(stock_q|display_qs|min_alert)(,|$)' then
    raise exception 'SEC-1: items_public ما زال يكشف أعمدة مخزون رقمية → %', v_cols;
  end if;

  -- ب) الزائر لا يملك صلاحية select على الجدول الخام
  v_anon_select := has_table_privilege('anon', 'public.items', 'select');
  if v_anon_select then
    raise exception 'SEC-1: anon ما زال يقرأ public.items مباشرة';
  end if;

  -- ج) الزائر يقرأ الإسقاط العام فعلًا (وإلا انكسر المتجر)
  if not has_table_privilege('anon', 'public.items_public', 'select') then
    raise exception 'SEC-1: anon لا يقرأ items_public — المتجر سينكسر';
  end if;

  raise notice '✅ SEC-1: items_public للزائر · items_staff للموظفين · الجدول الخام مغلق أمام anon';
end $$;

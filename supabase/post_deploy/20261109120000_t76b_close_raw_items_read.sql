-- ═══════════════════════════════════════════════════════════════════════════
--  T7.6/ب — الإغلاق النهائي: سحب القراءة الخام للأصناف من الزائر/العميل
--
--  ⛔ لا تُنفَّذ قبل نشر الواجهة الجديدة. هذا القيد ليس تحفّظًا نظريًا:
--     الموقع المنشور حاليًا (GitHub Pages) يقرأ:  items.select('*')
--     فإن سُحبت الصلاحية قبله صار المتجر **فارغًا لكل الزبائن فورًا**.
--     الواجهة الجديدة (web/cloud.js بعد SEC-1) تقرأ items_public/items_staff
--     وتسقط تلقائيًا إلى الجدول الخام إن غابا — فبعد نشرها لا يبقى أي عميل
--     يقرأ الجدول الخام.
--
--  الترتيب الصحيح:
--    1) انشر الواجهة الجديدة (المستودع → GitHub Pages / Cloudflare Pages)
--    2) تحقّق أن المتجر يعرض المنتجات (230 صنفًا) من items_public
--    3) نفّذ هذا الملف
--    4) نفّذ فحص ما بعد التنفيذ في نهاية الملف
--
--  التنفيذ: SQL Editor، أو
--    SUPABASE_DB_PASSWORD='…' bash scripts/apply-live-psql.sh
--  (الملف في post_deploy/ وليس في migrations/ ليستحيل تنفيذه بالخطأ
--   مع `supabase db push` أو مع بناء قاعدة من الصفر.)
-- ═══════════════════════════════════════════════════════════════════════════

-- حارس: لا تعمل إن لم يكن الإسقاطان جاهزين ومقروءين
do $$
begin
  if not has_table_privilege('anon', 'public.items_public', 'select') then
    raise exception 'T7.6/ب: items_public غير جاهزة — نفّذ T7.6/أ أولًا';
  end if;
  if not has_table_privilege('authenticated', 'public.items_staff', 'select') then
    raise exception 'T7.6/ب: items_staff غير جاهزة — نفّذ T7.6/أ أولًا';
  end if;
end $$;

-- ⛔️ الإغلاق: لا قراءة خام ولا كتابة خام لأي دور عام
revoke select, insert, update, delete, truncate, references, trigger on public.items from anon;
revoke insert, update, delete, truncate, references, trigger on public.items from authenticated;

notify pgrst, 'reload schema';

-- تحقق ما بعد التنفيذ
do $$
begin
  if has_table_privilege('anon', 'public.items', 'select') then
    raise exception 'T7.6/ب: anon ما زال يقرأ items';
  end if;
  if has_table_privilege('authenticated', 'public.items', 'select') then
    raise exception 'T7.6/ب: authenticated ما زال يقرأ items';
  end if;
  if not has_table_privilege('anon', 'public.items_public', 'select') then
    raise exception 'T7.6/ب: anon فقد قراءة items_public — المتجر سينكسر';
  end if;
  if not has_table_privilege('authenticated', 'public.items_staff', 'select') then
    raise exception 'T7.6/ب: الموظف فقد items_staff — الكاشير سيتعطّل';
  end if;
  raise notice '✅ T7.6/ب: الجدول الخام مقفل تمامًا · القراءة عبر الإسقاطين · الكتابة عبر upsert_item';
end $$;

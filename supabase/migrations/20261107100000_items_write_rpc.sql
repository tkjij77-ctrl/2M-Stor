-- ═══════════════════════════════════════════════════════════════════════════
--  20261107100000_items_write_rpc.sql
--  SEC-2 — إغلاق المسار الأخير: لا أحد يقرأ/يكتب جدول items مباشرة
--
--  ما تبقّى بعد SEC-1 (ترحيل 20260921070000←20261107090000):
--    سُحبت القراءة من `anon` فقط، وبقي `authenticated` (أي **عميل مسجَّل**)
--    قادرًا على:
--        GET /rest/v1/items?select=stock_q,display_qs   ⇒ جرد المتجر كاملًا
--    والسبب أن مسار كتابة الأصناف كان من المتصفح مباشرةً (insert/update على
--    الجدول)، وأي كتابة تحتاج `select` على الأعمدة ⇒ سحبها كان سيُعطّل الكاشير.
--
--  الحل: نقل الكتابة إلى دالة محصورة على السيرفر، ثم سحب كل صلاحية جدولية:
--    1) upsert_item(p jsonb)   ← إضافة/تعديل صنف (عامل أو مدير فقط، والتحقق
--                                 داخل القاعدة لا في المتصفح)
--    2) archive_all_items()    ← أرشفة كل الأصناف (نفس القيد)
--    ثم: revoke select/insert/update/delete on public.items من anon
--        و authenticated — معًا.
--    القراءة تبقى ممكنة عبر الإسقاطين فقط:
--        items_public (الجميع · بلا أرقام) · items_staff (الموظف · بالأرقام)
--    والحذف/الاستعادة لهما دالتاهما أصلًا: soft_delete_item · restore_item.
--
--  فائدة إضافية: الكتابة صارت **مُتحقَّقة على السيرفر** — الأسماء الفارغة
--  والأسعار غير الصالحة والكميات السالبة تُرفض داخل القاعدة، ولا يعتمد
--  شيء على انضباط المتصفح.
--
--  التوافق الخلفي: التطبيق يحاول الدالة أولًا، وإن لم تكن موجودة (قاعدة لم
--  يُنفَّذ عليها هذا الترحيل) يعود للمسار القديم — فلا يتوقف الكاشير بترتيب
--  النشر. آمن الإعادة بالكامل.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) إضافة/تعديل صنف — دالة واحدة لكل الحالات ────────────────────────────
create or replace function public.upsert_item(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      bigint;
  v_name    text;
  v_price   numeric(12,2);
  v_stock   int;
  v_display int;
  v_min     int;
  v_images  text[];
  v_ts      timestamptz;
begin
  -- الحارس على السيرفر: لا حساب = لا كتابة، وغير الموظف = لا كتابة
  if not public.is_staff() then
    raise exception 'غير مصرّح: تعديل الأصناف للعامل والمدير فقط'
      using errcode = '42501';
  end if;

  v_id := nullif(p->>'id', '')::bigint;

  v_name := nullif(btrim(coalesce(p->>'name', '')), '');
  if v_name is null then
    raise exception 'اسم الصنف مطلوب' using errcode = '22023';
  end if;

  v_price   := coalesce(nullif(p->>'price_num', '')::numeric, 0);
  v_stock   := coalesce(nullif(p->>'stock_q', '')::int, 0);
  v_display := coalesce(nullif(p->>'display_qs', '')::int, 0);
  v_min     := coalesce(nullif(p->>'min_alert', '')::int, 5);

  if v_price < 0 then
    raise exception 'السعر لا يكون سالبًا (%)', v_price using errcode = '22023';
  end if;
  if v_stock < 0 or v_display < 0 or v_min < 0 then
    raise exception 'الكميات لا تكون سالبة (مخزن % · معروض % · تنبيه %)', v_stock, v_display, v_min
      using errcode = '22023';
  end if;

  -- مصفوفة الصور: تُقبل كمصفوفة JSON أو تُترك كما هي عند غياب المفتاح
  if p ? 'images' and jsonb_typeof(p->'images') = 'array' then
    select coalesce(array_agg(value), '{}'::text[]) into v_images
      from jsonb_array_elements_text(p->'images') as value;
  end if;

  if v_id is null then
    insert into public.items (
      category_id, name, price_text, price_num, stock_q, display_qs, min_alert,
      barcode, image_url, description, old_price, images
    ) values (
      nullif(p->>'category_id', '')::bigint,
      v_name,
      coalesce(p->>'price_text', ''),
      v_price, v_stock, v_display, v_min,
      nullif(p->>'barcode', ''),
      nullif(p->>'image_url', ''),
      nullif(p->>'description', ''),
      nullif(p->>'old_price', '')::numeric,
      v_images
    )
    returning id, updated_at into v_id, v_ts;
  else
    update public.items set
      category_id = coalesce(nullif(p->>'category_id', '')::bigint, category_id),
      name        = v_name,
      price_text  = coalesce(p->>'price_text', price_text),
      price_num   = v_price,
      stock_q     = v_stock,
      display_qs  = v_display,
      min_alert   = v_min,
      -- الحقول النصية/الاختيارية: تُمسح فقط إذا أُرسل المفتاح فارغًا (وإلا بقيت)
      barcode     = case when p ? 'barcode'     then nullif(p->>'barcode', '')     else barcode     end,
      image_url   = case when p ? 'image_url'   then nullif(p->>'image_url', '')   else image_url   end,
      description = case when p ? 'description' then nullif(p->>'description', '') else description end,
      old_price   = case when p ? 'old_price'   then nullif(p->>'old_price', '')::numeric else old_price end,
      images      = case when v_images is not null then v_images else images end,
      -- أي تعديل لصنف محلي = إحياء صريح له (كان تعديل صنف مُستعاد يبقى محذوفًا)
      deleted_at  = null,
      deleted_by  = null
    where id = v_id
    returning updated_at into v_ts;

    if v_ts is null then
      raise exception 'الصنف % غير موجود', v_id using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'updated_at', v_ts);
end $$;

comment on function public.upsert_item(jsonb) is
  'SEC-2: المسار الوحيد لإضافة/تعديل صنف — يتحقق من الدور والمدخلات على السيرفر';

-- ── 2) أرشفة كل الأصناف (زر «استبدال بيانات السحابة») ─────────────────────
create or replace function public.archive_all_items()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_staff() then
    raise exception 'غير مصرّح: الأرشفة للعامل والمدير فقط' using errcode = '42501';
  end if;

  update public.items
     set deleted_at = now(), deleted_by = auth.uid()
   where deleted_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.archive_all_items() is
  'SEC-2: أرشفة كل الأصناف (حذف ناعم) — لا مسح نهائي، والاستعادة من سلة المحذوفات';

-- ── 3) الصلاحيات ───────────────────────────────────────────────────────────
revoke all on function public.upsert_item(jsonb)      from public, anon;
revoke all on function public.archive_all_items()     from public, anon;
grant execute on function public.upsert_item(jsonb)   to authenticated;
grant execute on function public.archive_all_items()  to authenticated;

-- ⛔️ الإغلاق النهائي: لا قراءة ولا كتابة مباشرة على الجدول لأي دور عام
revoke select, insert, update, delete on public.items from anon, authenticated;

-- إعادة تحميل مخطط PostgREST حتى ترى الدوال الجديدة فورًا
notify pgrst, 'reload schema';

-- ── 4) تحقق ذاتي — يفشل بصوت عالٍ بدل أن يمرّ صامتًا ──────────────────────
do $$
declare
  v_def text;
begin
  -- أ) لا صلاحية جدولية لأي دور عام
  if has_table_privilege('anon', 'public.items', 'select')
     or has_table_privilege('authenticated', 'public.items', 'select') then
    raise exception 'SEC-2: ما زالت القراءة المباشرة على items متاحة';
  end if;
  if has_table_privilege('authenticated', 'public.items', 'insert')
     or has_table_privilege('authenticated', 'public.items', 'update')
     or has_table_privilege('authenticated', 'public.items', 'delete') then
    raise exception 'SEC-2: ما زالت الكتابة المباشرة على items متاحة';
  end if;

  -- ب) الإسقاطان يبقيان مقروءين (وإلا انكسر المتجر وكاشير الموظف)
  if not has_table_privilege('anon', 'public.items_public', 'select') then
    raise exception 'SEC-2: anon لا يقرأ items_public';
  end if;
  if not has_table_privilege('authenticated', 'public.items_staff', 'select') then
    raise exception 'SEC-2: الموظف لا يقرأ items_staff';
  end if;

  -- ج) الدوال موجودة ومحصورة
  select pg_get_functiondef('public.upsert_item(jsonb)'::regprocedure) into v_def;
  if v_def is null or position('is_staff' in v_def) = 0 then
    raise exception 'SEC-2: upsert_item بلا حارس is_staff';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'archive_all_items') then
    raise exception 'SEC-2: archive_all_items غير موجودة';
  end if;

  raise notice '✅ SEC-2: الكتابة عبر upsert_item/archive_all_items · القراءة عبر الإسقاطين · الجدول مقفل تمامًا';
end $$;

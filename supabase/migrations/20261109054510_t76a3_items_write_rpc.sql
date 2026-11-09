-- ═══════════════════════════════════════════════════════════════════════════
--  T7.6/أ-٣ — تطبيق دالتي الكتابة (SEC-2) على قاعدة الإنتاج
--
--  الحالة قبل: العامل/المدير يكتبون على public.items مباشرة عبر PostgREST
--  وكان الحارس الوحيد هو RLS. الآن: upsert_item / archive_all_items
--  (SECURITY DEFINER) تتحقق من الدور والمدخلات على السيرفر.
--
--  ⚠️ لم نسحب صلاحيات الكتابة من `authenticated` (الواجهة المنشورة تكتب
--  مباشرة) — ذلك في T7.6/ب مع نشر الواجهة الجديدة.
--  آمن الإعادة بالكامل.
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


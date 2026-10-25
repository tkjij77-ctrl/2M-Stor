-- ═══════════════════════════════════════════════════════════════════════════
--  🏪 2M-Stor PRO — ترقية المتجر الإلكتروني (إضافية بالكامل · بلا مسح بيانات)
--
--  ماذا يفعل هذا الملف:
--   1) يضيف أعمدة جديدة فقط (IF NOT EXISTS) للأصناف والأقسام والفواتير
--      ⇒ لا يُعدَّل ولا يُحذف أي صنف أو فاتورة قائمة.
--   2) ينشئ جدول «البنرات» الإعلانية (banners) بسياسات RLS مناسبة.
--   3) ينشئ دالة آمنة للزائر: public.place_store_order() — تستقبل الطلب،
--      تُعيد حساب الأسعار والشحن والكوبون والضريبة من قاعدة البيانات نفسها
--      (لا تثق بأسعار المتصفح)، تخصم المخزون ذرّيًا، وتُرجع رمز تتبّع.
--   4) ينشئ دالة public.get_order_by_token() لتتبّع الطلب برمز سري بدون تسجيل.
--   5) يوسّع قائمة الإعدادات العامة (public_settings) بمفاتيح المتجر الجديدة
--      (فتح/إغلاق، شريط إعلان، شعار، لون الهوية، بيانات التحويل).
--
--  ⚠️ آمن الإعادة: يمكن تنفيذه أكثر من مرة على نفس القاعدة بلا خطأ.
--  ⚠️ لا يحذف شيئًا: كل عبارة هنا إضافية (add column if not exists / create if not exists).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) أعمدة الأصناف: وصف · سعر قبل الخصم · معرض صور ────────────────────
alter table public.items
  add column if not exists description text,
  add column if not exists old_price   numeric(12,2),
  add column if not exists images      text[];

comment on column public.items.description is 'وصف تفصيلي للمنتج يظهر في صفحة المنتج';
comment on column public.items.old_price   is 'السعر قبل الخصم — يُعرض مشطوبًا لحساب نسبة التوفير';
comment on column public.items.images      is 'روابط صور إضافية للمنتج (حتى 8) — الأولى هي الغلاف';

-- ── 2) أعمدة الأقسام: صورة دائرية + أيقونة ──────────────────────────────
alter table public.categories
  add column if not exists image_url text,
  add column if not exists icon      text;

comment on column public.categories.image_url is 'صورة القسم الدائرية في واجهة المتجر';
comment on column public.categories.icon      is 'رمز تعبيري للقسم عند عدم وجود صورة';

-- ── 3) أعمدة الطلبات (الفواتير) الخاصة بالتجارة الإلكترونية ─────────────
alter table public.invoices
  add column if not exists customer_phone   text,
  add column if not exists customer_address text,
  add column if not exists customer_city    text,
  add column if not exists customer_area    text,
  add column if not exists notes            text,
  add column if not exists payment_method   text default 'cash',
  add column if not exists payment_status   text default 'unpaid',
  add column if not exists receipt_url      text,
  add column if not exists order_token      text,
  add column if not exists source           text default 'pos',
  add column if not exists fulfillment      text default 'delivery';

comment on column public.invoices.customer_phone  is 'رقم هاتف العميل (موحَّد 01xxxxxxxxx)';
comment on column public.invoices.order_token     is 'رمز تتبّع سري يُعطى للعميل لمتابعة طلبه بلا تسجيل';
comment on column public.invoices.source          is 'مصدر الطلب: pos | web | telegram | whatsapp';
comment on column public.invoices.payment_method  is 'طريقة الدفع: cod | vodafone | instapay | bank';
comment on column public.invoices.fulfillment     is 'طريقة الاستلام: delivery | pickup';

-- ── 4) الفهارس الجديدة ───────────────────────────────────────────────────
create unique index if not exists idx_invoices_order_token
  on public.invoices (order_token) where order_token is not null;

create index if not exists idx_invoices_status_created
  on public.invoices (status, created_at desc);

create index if not exists idx_invoices_customer_phone
  on public.invoices (customer_phone) where customer_phone is not null;

-- ── 5) جدول البنرات الإعلانية ────────────────────────────────────────────
create table if not exists public.banners (
  id          bigint generated always as identity primary key,
  title       text not null,
  subtitle    text,
  image_url   text,
  emoji       text,
  cta_text    text,
  link_type   text default 'none',
  link_value  text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.banners is 'بنرات سلايدر الصفحة الرئيسية — يُدار من لوحة التحكم';

alter table public.banners enable row level security;

drop policy if exists banners_public_read on public.banners;
create policy banners_public_read on public.banners
  for select to anon, authenticated
  using (deleted_at is null and active = true);

drop policy if exists banners_admin_write on public.banners;
create policy banners_admin_write on public.banners
  for all to authenticated
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

create index if not exists idx_banners_order on public.banners (sort_order, id) where deleted_at is null;

drop trigger if exists trg_banners_touch on public.banners;
create trigger trg_banners_touch
  before update on public.banners
  for each row execute function public.touch_updated_at();

-- ── 6) توسيع قائمة الإعدادات العامة (22 مفتاحًا) ─────────────────────────
--  ⚠️ هذه القائمة يجب أن تطابق حرفيًا مفاتيح mergeSettings() في web/cloud.js
--  ملاحظة: الدالة كانت تُرجع jsonb — نحافظ على نفس نوع الإرجاع
--  (تغييره كان سيفشل بـ«cannot change return type of existing function»)
create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    from public.settings s
   where s.key in (
     'store_name', 'address', 'phone', 'footer', 'tax_pct', 'store_desc',
     'return_days', 'return_note', 'shipping_fee', 'free_shipping_over',
     'coupon_code', 'coupon_pct', 'stock_mode', 'oversell_policy', 'role_perms',
     -- 🏪 مفاتيح المتجر الإلكتروني (2026-10-25)
     'store_open', 'announce_text', 'store_logo', 'brand_color',
     'pay_vodafone', 'pay_instapay', 'pay_bank'
   );
$$;

revoke all on function public.public_settings() from public;
grant execute on function public.public_settings() to anon, authenticated;

drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select to anon
  using (key in (
    'store_name', 'address', 'phone', 'footer', 'tax_pct', 'store_desc',
    'return_days', 'return_note', 'shipping_fee', 'free_shipping_over',
    'coupon_code', 'coupon_pct', 'stock_mode', 'oversell_policy', 'role_perms',
    'store_open', 'announce_text', 'store_logo', 'brand_color',
    'pay_vodafone', 'pay_instapay', 'pay_bank'
  ));

-- ── 7) دالة إتمام الطلب للزائر (Guest Checkout) ──────────────────────────
--  الأمان: SECURITY DEFINER + search_path ثابت + تحقق صارم من كل مدخل.
--  الأسعار والشحن والكوبون والضريبة تُحسب **هنا** من جداول القاعدة،
--  وأي سعر يُرسله المتصفح يُتجاهَل تمامًا.
create or replace function public.place_store_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items       jsonb;
  v_line        jsonb;
  v_item        public.items%rowtype;
  v_qty         int;
  v_price       numeric(12,2);
  v_subtotal    numeric(12,2) := 0;
  v_discount    numeric(12,2) := 0;
  v_tax         numeric(12,2) := 0;
  v_shipping    numeric(12,2) := 0;
  v_total       numeric(12,2) := 0;
  v_ship_fee    numeric(12,2) := 0;
  v_free_over   numeric(12,2) := 0;
  v_tax_pct     numeric(6,2)  := 0;
  v_coupon      text := '';
  v_coupon_pct  numeric(6,2)  := 0;
  v_coupon_in   text := '';
  v_name        text;
  v_phone       text;
  v_city        text;
  v_area        text;
  v_address     text;
  v_notes       text;
  v_payment     text;
  v_fulfill     text;
  v_receipt     text;
  v_source      text;
  v_token       text;
  v_invoice_id  bigint;
  v_invoice_no  int;
  v_lines       jsonb := '[]'::jsonb;
  v_stock_mode  text := 'both';
  v_oversell    text := 'warn';
  v_hour_cnt    int;
  v_is_open     text := '1';
  v_settings    jsonb := '{}'::jsonb;
begin
  -- ── (أ) إعدادات المتجر ──
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) into v_settings
    from public.settings s;
  v_ship_fee  := coalesce(nullif(v_settings->>'shipping_fee', '')::numeric, 0);
  v_free_over := coalesce(nullif(v_settings->>'free_shipping_over', '')::numeric, 0);
  v_tax_pct   := coalesce(nullif(v_settings->>'tax_pct', '')::numeric, 0);
  v_coupon    := upper(btrim(coalesce(v_settings->>'coupon_code', '')));
  v_coupon_pct:= coalesce(nullif(v_settings->>'coupon_pct', '')::numeric, 0);
  v_stock_mode:= coalesce(v_settings->>'stock_mode', 'both');
  v_oversell  := coalesce(v_settings->>'oversell_policy', 'warn');
  v_is_open   := coalesce(v_settings->>'store_open', '1');

  if v_is_open = '0' then
    raise exception 'المتجر مغلق مؤقتًا ولا يستقبل طلبات جديدة الآن' using errcode = '22023';
  end if;

  -- ── (ب) تحقق من بيانات العميل ──
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'بيانات الطلب غير صالحة' using errcode = '22023';
  end if;

  v_name := btrim(coalesce(payload->>'name', ''));
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'اكتب اسمك بشكل صحيح (حرفان على الأقل)' using errcode = '22023';
  end if;

  v_phone := regexp_replace(coalesce(payload->>'phone', ''), '[^0-9]', '', 'g');
  if left(v_phone, 2) = '20' and length(v_phone) = 12 then v_phone := '0' || substr(v_phone, 3); end if;
  if left(v_phone, 1) = '1' and length(v_phone) = 10 then v_phone := '0' || v_phone; end if;
  if v_phone !~ '^01[0-9]{9}$' then
    raise exception 'رقم الهاتف غير صحيح — اكتبه بالصيغة 01xxxxxxxxx' using errcode = '22023';
  end if;

  -- حماية من الإغراق: 8 طلبات كحد أقصى لنفس الرقم في الساعة
  select count(*) into v_hour_cnt
    from public.invoices i
   where i.customer_phone = v_phone
     and i.created_at > now() - interval '1 hour';
  if v_hour_cnt >= 8 then
    raise exception 'محاولات طلب كثيرة من هذا الرقم — انتظر قليلًا ثم أعد المحاولة' using errcode = '22023';
  end if;

  v_fulfill := case when coalesce(payload->>'fulfillment', 'delivery') = 'pickup' then 'pickup' else 'delivery' end;
  v_payment := case
                 when coalesce(payload->>'payment', 'cod') in ('cod','vodafone','instapay','bank')
                   then coalesce(payload->>'payment', 'cod')
                 else 'cod'
               end;
  v_city     := left(nullif(btrim(coalesce(payload->>'city', '')), ''), 80);
  v_area     := left(nullif(btrim(coalesce(payload->>'area', '')), ''), 80);
  v_address  := left(nullif(btrim(coalesce(payload->>'address', '')), ''), 400);
  v_notes    := left(nullif(btrim(coalesce(payload->>'notes', '')), ''), 500);
  v_receipt  := left(nullif(btrim(coalesce(payload->>'receipt', '')), ''), 500);
  v_source   := case when coalesce(payload->>'source', 'web') in ('web','telegram','whatsapp','pos')
                     then coalesce(payload->>'source', 'web') else 'web' end;

  if v_fulfill = 'delivery' and (v_address is null or length(v_address) < 6) then
    raise exception 'اكتب العنوان بالتفصيل للتوصيل' using errcode = '22023';
  end if;
  if v_payment <> 'cod' and v_receipt is null then
    raise exception 'ارفع صورة إيصال التحويل أو اختر الدفع عند الاستلام' using errcode = '22023';
  end if;

  -- ── (ج) إعادة حساب الأسعار من القاعدة (لا ثقة بالمتصفح) ──
  v_items := payload->'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'السلة فارغة' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 60 then
    raise exception 'عدد الأصناف في الطلب كبير جدًا' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(v_items) loop
    begin
      v_qty := (v_line->>'qty')::int;
    exception when others then
      raise exception 'كمية غير صالحة في الطلب' using errcode = '22023';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 200 then
      raise exception 'كمية غير صالحة في الطلب' using errcode = '22023';
    end if;

    -- قفل الصف: يمنع بيع نفس القطعة لعميلين في نفس اللحظة
    select * into v_item
      from public.items
     where id = (v_line->>'id')::bigint
       and deleted_at is null
       for update;

    if not found then
      raise exception 'أحد المنتجات لم يعد متوفرًا في المتجر' using errcode = '22023';
    end if;

    v_price := coalesce(v_item.price_num, 0);
    if v_price <= 0 then
      raise exception 'منتج «%» بلا سعر صالح — تواصل مع المتجر', v_item.name using errcode = '22023';
    end if;

    if v_item.display_qs < v_qty and v_oversell = 'block' then
      raise exception 'المتاح من «%» % قطعة فقط', v_item.name, v_item.display_qs using errcode = '22023';
    end if;

    -- خصم المخزون ذرّيًا (لا يقل عن صفر)
    if v_stock_mode <> 'off' then
      update public.items i
         set display_qs = greatest(0, i.display_qs - v_qty),
             stock_q    = case when v_stock_mode = 'both' then greatest(0, i.stock_q - v_qty) else i.stock_q end,
             updated_at = now()
       where i.id = v_item.id;
    end if;

    v_subtotal := v_subtotal + (v_price * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id,
      'name', v_item.name,
      'category', (select c.name from public.categories c where c.id = v_item.category_id),
      'qty', v_qty,
      'price', v_price
    );
  end loop;

  -- ── (د) الكوبون والشحن والضريبة ──
  v_coupon_in := upper(btrim(coalesce(payload->>'coupon', '')));
  if v_coupon <> '' and v_coupon_pct > 0 and v_coupon_in = v_coupon then
    v_discount := round(v_subtotal * v_coupon_pct / 100.0, 2);
  end if;
  v_discount := least(v_discount, v_subtotal);

  if v_fulfill = 'pickup' then
    v_shipping := 0;
  elsif v_free_over > 0 and v_subtotal >= v_free_over then
    v_shipping := 0;
  else
    v_shipping := v_ship_fee;
  end if;

  v_tax   := round((v_subtotal - v_discount) * v_tax_pct / 100.0, 2);
  v_total := v_subtotal - v_discount + v_tax + v_shipping;

  -- ── (هـ) رمز التتبّع ──
  -- gen_random_uuid() مدمجة في PostgreSQL 13+ (لا تحتاج امتدادًا خارجيًا)
  v_token := replace(gen_random_uuid()::text, '-', '');
  if v_token is null or length(v_token) < 12 then
    v_token := substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  end if;

  -- ── (و) إنشاء الطلب ──
  --  invoice_no يُسنده المشغّل assign_invoice_no تلقائيًا (تسلسل مركزي).
  insert into public.invoices (
    customer_name, customer_phone, customer_address, customer_city, customer_area,
    seller_id, subtotal, discount, tax, total, status,
    payment_method, payment_status, receipt_url, notes,
    order_token, source, fulfillment, stock_applied
  ) values (
    left(v_name, 80), v_phone, v_address, v_city, v_area,
    auth.uid(), v_subtotal, v_discount, v_tax, v_total, 'قيد المعالجة',
    v_payment, case when v_payment = 'cod' then 'unpaid' else 'review' end, v_receipt, v_notes,
    v_token, v_source, v_fulfill, v_stock_mode
  ) returning id, invoice_no into v_invoice_id, v_invoice_no;

  insert into public.invoice_items (invoice_id, item_name, category_name, qty, price)
  select v_invoice_id,
         (l->>'name'),
         (l->>'category'),
         (l->>'qty')::int,
         (l->>'price')::numeric
    from jsonb_array_elements(v_lines) l;

  insert into public.audit_log (user_id, action, details)
  values (auth.uid(), 'طلب أونلاين جديد',
          '#' || v_invoice_no || ' · ' || left(v_name, 40) || ' · ' || v_total || ' ج.م · ' || v_source);

  return jsonb_build_object(
    'ok', true,
    'order_no', v_invoice_no,
    'order_id', v_invoice_id,
    'token', v_token,
    'status', 'قيد المعالجة',
    'subtotal', v_subtotal,
    'discount', v_discount,
    'tax', v_tax,
    'shipping', v_shipping,
    'total', v_total,
    'fulfillment', v_fulfill,
    'payment', v_payment,
    'created_at', now(),
    'items', v_lines
  );
end $$;

comment on function public.place_store_order(jsonb) is
  'إتمام طلب زائر بأمان — يحسب الأسعار والشحن والكوبون على السيرفر ويخصم المخزون ويُرجع رمز تتبّع';

revoke all on function public.place_store_order(jsonb) from public;
grant execute on function public.place_store_order(jsonb) to anon, authenticated;

-- ── 8) تتبّع الطلب برمز سري (بلا تسجيل دخول) ─────────────────────────────
create or replace function public.get_order_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_lines jsonb;
begin
  if p_token is null or length(btrim(p_token)) < 8 then
    raise exception 'رمز تتبّع غير صالح' using errcode = '22023';
  end if;

  select * into v_inv
    from public.invoices i
   where i.order_token = btrim(p_token)
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد طلب بهذا الرمز');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', ii.item_name,
           'qty', ii.qty,
           'price', ii.price,
           'category', ii.category_name
         ) order by ii.id), '[]'::jsonb)
    into v_lines
    from public.invoice_items ii
   where ii.invoice_id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'order_no', v_inv.invoice_no,
    'status', coalesce(v_inv.status, 'قيد المعالجة'),
    'created_at', v_inv.created_at,
    'updated_at', v_inv.updated_at,
    'customer', left(coalesce(v_inv.customer_name, ''), 60),
    -- الرقم مُخفَّى جزئيًا: صاحب الرمز يعرف رقمه، والغريب لا يستفيد منه
    'phone_masked', case when length(coalesce(v_inv.customer_phone, '')) >= 11
                         then substr(v_inv.customer_phone, 1, 4) || '****' || right(v_inv.customer_phone, 3)
                         else '' end,
    'city', v_inv.customer_city,
    'area', v_inv.customer_area,
    'address', v_inv.customer_address,
    'fulfillment', coalesce(v_inv.fulfillment, 'delivery'),
    'payment', coalesce(v_inv.payment_method, 'cod'),
    'payment_status', coalesce(v_inv.payment_status, 'unpaid'),
    'subtotal', v_inv.subtotal,
    'discount', v_inv.discount,
    'tax', v_inv.tax,
    'total', v_inv.total,
    'items', v_lines
  );
end $$;

comment on function public.get_order_by_token(text) is
  'تتبّع طلب الزائر برمز سري — يُخفي رقم الهاتف جزئيًا ولا يكشف أي طلب آخر';

revoke all on function public.get_order_by_token(text) from public;
grant execute on function public.get_order_by_token(text) to anon, authenticated;

-- ── 9) فحص ذاتي: تأكيد أن كل ما سبق موجود فعلًا ─────────────────────────
do $$
declare
  v_missing text[] := '{}';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='items' and column_name='old_price') then
    v_missing := array_append(v_missing, 'items.old_price');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='items' and column_name='images') then
    v_missing := array_append(v_missing, 'items.images');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='invoices' and column_name='order_token') then
    v_missing := array_append(v_missing, 'invoices.order_token');
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='banners') then
    v_missing := array_append(v_missing, 'banners');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='place_store_order') then
    v_missing := array_append(v_missing, 'place_store_order()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ترقية المتجر ناقصة: %', array_to_string(v_missing, ' · ');
  end if;
  raise notice '✅ ترقية المتجر الإلكتروني اكتملت: أعمدة + بنرات + دالتا الطلب والتتبّع';
end $$;

-- ── 10) قيم ابتدائية لمفاتيح المتجر الجديدة (لا تمسّ أي مفتاح قائم) ───────
insert into public.settings (key, value) values
  ('store_open',    '1'),
  ('announce_text', ''),
  ('store_logo',    ''),
  ('brand_color',   ''),
  ('pay_vodafone',  ''),
  ('pay_instapay',  ''),
  ('pay_bank',      '')
on conflict (key) do nothing;

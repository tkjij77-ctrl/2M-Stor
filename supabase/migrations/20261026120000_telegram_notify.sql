-- ═══════════════════════════════════════════════════════════════════════════
--  ✈️  إشعارات تيليجرام الفورية — كل شيء داخل قاعدة البيانات
--
--  الفكرة: بدل الاعتماد على Supabase Database Webhooks (لوحة يدوية)،
--  صار الإرسال نفسه داخل القاعدة عبر امتداد pg_net:
--     • طلب جديد        ⇒ رسالة فورية لكل مدير مربوط بالبوت + أزرار حالة
--     • تغيّر حالة الطلب ⇒ رسالة للمدير + رسالة للعميل (إن ربط طلبه بالبوت)
--
--  ما تضيفه هذه الهجرة:
--    1) جدول telegram_config (صف واحد) — التوكن والأسرار، محجوب تمامًا عن anon
--    2) جدول telegram_admins — محادثات المدراء المصرّح لهم
--    3) tg_esc / tg_money / tg_api — أدوات مساعدة للإرسال
--    4) tg_order_keyboard / tg_invoice_message — بناء نص الرسالة وأزرارها
--    5) admin_set_order_status() — تغيير الحالة من تيليجرام مع ضبط المخزون
--    6) tg_invoice_alert() + مشغّل على invoices
--    7) tg_test() — رسالة تجربة للتأكد أن كل شيء موصول
--
--  ⚠️ توكن البوت لا يُحفظ في هذا الملف (ولا في git إطلاقًا).
--     يُضبط مرة واحدة:
--       update public.telegram_config set bot_token = '<TOKEN>' where id = 1;
--     أو عبر: supabase secrets / لوحة Supabase ← SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) امتداد الشبكة ─────────────────────────────────────────────────────────
create extension if not exists pg_net with schema extensions;

-- ── 0.ب) إصلاح عاجل: قيد حالات الطلب كان يرفض «مؤكد» ───────────────────────
--  القاعدة القديمة كانت تسمح بـ 5 حالات فقط؛ ولأن شاشة الإدارة صارت تستخدم
--  «مؤكد» (بين الجديد والشحن) كان أي تحديث لها يفشل بـ 23514.
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('قيد المعالجة', 'مؤكد', 'في الطريق', 'تم التوصيل', 'ملغي', 'تم رفض الطلب'));


-- ── 1) إعدادات البوت (صف واحد فقط — لا قراءة لأي زائر) ─────────────────────
create table if not exists public.telegram_config (
  id              smallint primary key default 1 check (id = 1),
  bot_token       text,
  bot_username    text default 'Stor2M_bot',
  webhook_secret  text,
  admin_claim_code text,
  store_url       text default 'https://tkjij77-ctrl.github.io/2M-Stor/',
  notify_admin    boolean not null default true,
  notify_customer boolean not null default true,
  notify_pos      boolean not null default false,
  auto_claim_until timestamptz,          -- نافذة ربط تلقائي لأول محادثة (تُغلق بعد أول ربط)
  updated_at      timestamptz not null default now()
);

alter table public.telegram_config enable row level security;
revoke all on table public.telegram_config from anon, authenticated;

insert into public.telegram_config (id, admin_claim_code, webhook_secret)
values (1,
        upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
        md5(random()::text || clock_timestamp()::text))
on conflict (id) do nothing;

-- ── 2) المدراء المصرّح لهم داخل تيليجرام ────────────────────────────────────
create table if not exists public.telegram_admins (
  chat_id  bigint primary key,
  title    text,
  username text,
  added_at timestamptz not null default now()
);

alter table public.telegram_admins enable row level security;
revoke all on table public.telegram_admins from anon, authenticated;

-- ── 2.ب) سجل الوارد: كل رسالة/ضغطة تصل البوت (خدمة فقط) ────────────────────
--  بلا هذا السجل يصبح تشخيص «البوت مش بيرد» تخمينًا؛ به نعرف هل وصل الطلب
--  إلى الدالة أصلًا، ومن أي محادثة، وماذا أرسل صاحبها.
create table if not exists public.telegram_inbox (
  id        bigint generated always as identity primary key,
  chat_id   bigint,
  username  text,
  title     text,
  text      text,
  kind      text,
  at        timestamptz not null default now()
);
alter table public.telegram_inbox enable row level security;
revoke all on table public.telegram_inbox from anon, authenticated;
create index if not exists telegram_inbox_at_idx on public.telegram_inbox (at desc);

-- ── 3) أدوات مساعدة ─────────────────────────────────────────────────────────
create or replace function public.tg_esc(p text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

create or replace function public.tg_money(p numeric)
returns text
language sql
immutable
as $$
  select rtrim(rtrim(to_char(coalesce(p, 0), 'FM999999990.00'), '0'), '.');
$$;

-- إرسال أي طلب إلى Telegram Bot API (يُعيد معرّف الطلب في طابور pg_net)
create or replace function public.tg_api(p_method text, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_token text;
  v_req   bigint;
begin
  select bot_token into v_token from public.telegram_config where id = 1;
  if v_token is null or length(btrim(v_token)) < 20 then
    return null;  -- البوت غير مهيّأ بعد — لا نفعل شيئًا
  end if;

  select net.http_post(
           url                  := 'https://api.telegram.org/bot' || btrim(v_token) || '/' || p_method,
           body                 := coalesce(p_payload, '{}'::jsonb),
           timeout_milliseconds := 10000
         )
    into v_req;
  return v_req;
end $$;

revoke all on function public.tg_api(text, jsonb) from public;

-- ── 4) أزرار الحالة + نصوص الرسائل ──────────────────────────────────────────
create or replace function public.tg_order_keyboard(p_id bigint, p_status text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_next text;
  v_rows jsonb := '[]'::jsonb;
begin
  v_next := case p_status
              when 'قيد المعالجة' then 'مؤكد'
              when 'مؤكد'         then 'في الطريق'
              when 'في الطريق'    then 'تم التوصيل'
              else null
            end;

  if v_next is not null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(jsonb_build_object(
      'text', case v_next when 'مؤكد' then '✅ تأكيد الطلب'
                          when 'في الطريق' then '🚚 خرج للتوصيل'
                          else '📦 تم التسليم' end,
      'callback_data', 'st:' || p_id || ':' || v_next)));
  end if;

  if coalesce(p_status, '') not in ('ملغي', 'تم التوصيل', 'تم رفض الطلب') then
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(jsonb_build_object(
      'text', '🚫 إلغاء الطلب',
      'callback_data', 'st:' || p_id || ':ملغي')));
  end if;

  return jsonb_build_object('inline_keyboard', v_rows);
end $$;

-- يبني نص رسالة الطلب (للمدير) + أزرارها
create or replace function public.tg_invoice_message(
  p_invoice_id  bigint,
  p_kind        text default 'new',      -- 'new' | 'status'
  p_prev_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv   public.invoices%rowtype;
  v_cfg   public.telegram_config%rowtype;
  v_items text;
  v_addr  text;
  v_ship  numeric(12,2);
  v_link  text;
  v_text  text;
  v_kb    jsonb;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'الطلب غير موجود');
  end if;
  select * into v_cfg from public.telegram_config where id = 1;

  select coalesce(string_agg(
           '  • ' || public.tg_esc(ii.item_name) || ' × ' || ii.qty ||
           ' = ' || public.tg_money(ii.price * ii.qty) || ' ج', E'\n' order by ii.id), '—')
    into v_items
    from public.invoice_items ii
   where ii.invoice_id = v_inv.id;

  v_ship := coalesce(v_inv.total, 0) - coalesce(v_inv.subtotal, 0)
            + coalesce(v_inv.discount, 0) - coalesce(v_inv.tax, 0);

  v_addr := nullif(concat_ws(' · ',
              nullif(btrim(coalesce(v_inv.customer_city, '')), ''),
              nullif(btrim(coalesce(v_inv.customer_area, '')), ''),
              nullif(btrim(coalesce(v_inv.customer_address, '')), '')), '');

  v_link := case
              when coalesce(v_cfg.store_url, '') <> '' and coalesce(v_inv.order_token, '') <> ''
              then rtrim(v_cfg.store_url, '/') || '/?order=' || v_inv.order_token
            end;

  if p_kind = 'status' then
    v_text :=
      '🔔 <b>تحديث الطلب #' || coalesce(v_inv.invoice_no::text, '') || '</b>' || E'\n' ||
      '📌 ' || public.tg_esc(coalesce(p_prev_status, '—')) || ' ← <b>' ||
                public.tg_esc(coalesce(v_inv.status, '')) || '</b>' || E'\n' ||
      '👤 ' || public.tg_esc(coalesce(v_inv.customer_name, '')) ||
      ' · ' || public.tg_esc(coalesce(v_inv.customer_phone, '')) || E'\n' ||
      '🛍️ ' || (select count(*) from public.invoice_items ii where ii.invoice_id = v_inv.id) || ' صنف' ||
      ' · 💰 <b>' || public.tg_money(v_inv.total) || ' ج.م</b>' ||
      case when v_link is not null then E'\n🔗 ' || v_link else '' end;
    v_kb := public.tg_order_keyboard(v_inv.id, v_inv.status);
  else
    v_text :=
      '🛒 <b>طلب جديد #' || coalesce(v_inv.invoice_no::text, '') || '</b>' || E'\n' ||
      '━━━━━━━━━━━━━━━' || E'\n' ||
      '👤 <b>' || public.tg_esc(coalesce(v_inv.customer_name, '—')) || '</b>' || E'\n' ||
      '📞 ' || public.tg_esc(coalesce(v_inv.customer_phone, '—')) || E'\n' ||
      case when coalesce(v_inv.fulfillment, 'delivery') = 'pickup'
           then '🏬 استلام من المتجر' || E'\n'
           else '📍 ' || public.tg_esc(coalesce(v_addr, '—')) || E'\n' end ||
      '━━━━━━━━━━━━━━━' || E'\n' ||
      v_items || E'\n' ||
      '━━━━━━━━━━━━━━━' || E'\n' ||
      '🧮 المجموع: ' || public.tg_money(v_inv.subtotal) || ' ج' || E'\n' ||
      case when coalesce(v_inv.discount, 0) > 0
           then '🏷️ الخصم: −' || public.tg_money(v_inv.discount) || ' ج' || E'\n' else '' end ||
      case when coalesce(v_inv.tax, 0) > 0
           then '🧾 الضريبة: ' || public.tg_money(v_inv.tax) || ' ج' || E'\n' else '' end ||
      '🚚 الشحن: ' || case when v_ship > 0 then public.tg_money(v_ship) || ' ج' else 'مجاني' end || E'\n' ||
      '💰 <b>الإجمالي: ' || public.tg_money(v_inv.total) || ' ج.م</b>' || E'\n' ||
      '━━━━━━━━━━━━━━━' || E'\n' ||
      '💳 ' || case coalesce(v_inv.payment_method, 'cod')
                    when 'cod' then '💵 عند الاستلام'
                    when 'cash' then '💵 نقدي'
                    when 'vodafone' then '📱 فودافون كاش'
                    when 'instapay' then '⚡ إنستاباي'
                    when 'bank' then '🏦 تحويل بنكي'
                    else coalesce(v_inv.payment_method, '—') end ||
      case when coalesce(v_inv.payment_status, '') = 'review' then ' (بانتظار مراجعة الإيصال)' else '' end || E'\n' ||
      '📌 ' || public.tg_esc(coalesce(v_inv.status, '')) || ' · ' ||
      public.tg_esc(coalesce(v_inv.source, 'web')) ||
      case when coalesce(v_inv.notes, '') <> '' then E'\n📝 ' || public.tg_esc(v_inv.notes) else '' end ||
      case when coalesce(v_inv.receipt_url, '') <> '' then E'\n🧾 إيصال: ' || public.tg_esc(v_inv.receipt_url) else '' end ||
      case when v_link is not null then E'\n🔗 ' || v_link else '' end;
    v_kb := public.tg_order_keyboard(v_inv.id, v_inv.status);
  end if;

  return jsonb_build_object(
    'ok', true,
    'invoice_id', v_inv.id,
    'invoice_no', v_inv.invoice_no,
    'status', v_inv.status,
    'text', v_text,
    'keyboard', v_kb,
    'link', v_link
  );
end $$;

revoke all on function public.tg_invoice_message(bigint, text, text) from public;

-- ── 5) تغيير حالة الطلب مع ضبط المخزون (يُستدعى من البوت) ───────────────────
create or replace function public.admin_set_order_status(
  p_id     bigint,
  p_status text,
  p_note   text default 'telegram'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv      public.invoices%rowtype;
  v_mode     text := 'both';
  v_held     constant text[] := array['قيد المعالجة', 'مؤكد', 'في الطريق', 'تم التوصيل'];
  v_was_held boolean;
  v_now_held boolean;
  v_line     record;
  v_item_id  bigint;
  v_moved    int := 0;
begin
  if p_status not in ('قيد المعالجة', 'مؤكد', 'في الطريق', 'تم التوصيل', 'ملغي', 'تم رفض الطلب') then
    return jsonb_build_object('ok', false, 'error', 'حالة غير معروفة: ' || coalesce(p_status, ''));
  end if;

  select * into v_inv from public.invoices where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'الطلب غير موجود');
  end if;
  if v_inv.status = p_status then
    return jsonb_build_object('ok', true, 'same', true, 'status', v_inv.status);
  end if;

  select coalesce(max(value), 'both') into v_mode from public.settings where key = 'stock_mode';

  v_was_held := coalesce(v_inv.status, '') = any(v_held);
  v_now_held := p_status = any(v_held);

  -- إلغاء/رفض ⇒ إرجاع الكميات | إعادة تنشيط ⇒ خصمها مرة أخرى
  if v_was_held and not v_now_held and v_inv.stock_applied is not null then
    for v_line in select item_name, qty from public.invoice_items where invoice_id = v_inv.id loop
      select i.id into v_item_id
        from public.items i
       where i.name = v_line.item_name and i.deleted_at is null
       order by i.id limit 1;
      if v_item_id is not null and coalesce(v_line.qty, 0) > 0 then
        update public.items i
           set display_qs = i.display_qs + v_line.qty,
               stock_q    = case when v_mode = 'both' then i.stock_q + v_line.qty else i.stock_q end,
               updated_at = now()
         where i.id = v_item_id;
        v_moved := v_moved + 1;
      end if;
      v_item_id := null;
    end loop;
    v_inv.stock_applied := null;
    v_inv.stock_reverted_at := now();
  elsif not v_was_held and v_now_held and v_inv.stock_applied is null and v_mode <> 'off' then
    for v_line in select item_name, qty from public.invoice_items where invoice_id = v_inv.id loop
      select i.id into v_item_id
        from public.items i
       where i.name = v_line.item_name and i.deleted_at is null
       order by i.id limit 1;
      if v_item_id is not null and coalesce(v_line.qty, 0) > 0 then
        update public.items i
           set display_qs = greatest(0, i.display_qs - v_line.qty),
               stock_q    = case when v_mode = 'both' then greatest(0, i.stock_q - v_line.qty) else i.stock_q end,
               updated_at = now()
         where i.id = v_item_id;
        v_moved := v_moved + 1;
      end if;
      v_item_id := null;
    end loop;
    v_inv.stock_applied := v_mode;
  end if;

  update public.invoices
     set status           = p_status,
         updated_at       = now(),
         stock_applied    = v_inv.stock_applied,
         stock_reverted_at= v_inv.stock_reverted_at
   where id = v_inv.id;

  insert into public.audit_log (user_id, action, details)
  values (null, 'تحديث حالة طلب (تيليجرام)',
          '#' || coalesce(v_inv.invoice_no::text, '?') || ' · ' ||
          coalesce(v_inv.status, '—') || ' → ' || p_status ||
          case when v_moved > 0 then ' · ' || v_moved || ' صنف تعدّل مخزونه' else '' end ||
          ' · ' || coalesce(p_note, ''));

  return jsonb_build_object(
    'ok', true,
    'invoice_no', v_inv.invoice_no,
    'from', v_inv.status,
    'status', p_status,
    'stock_moved', v_moved
  );
end $$;

revoke all on function public.admin_set_order_status(bigint, text, text) from public;
grant execute on function public.admin_set_order_status(bigint, text, text) to service_role;

-- ── 6) المشغّل: طلب جديد / تغيّر حالة ───────────────────────────────────────
create or replace function public.tg_invoice_alert()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_cfg   public.telegram_config%rowtype;
  v_msg   jsonb;
  v_chat  bigint;
  v_prev  text;
begin
  -- ⚠️ الإشعار «تحسين» لا «شرط»: أي عطب في تيليجرام لا يُفشل إنشاء الطلب إطلاقًا
  begin
    select * into v_cfg from public.telegram_config where id = 1;
    if not found or coalesce(btrim(v_cfg.bot_token), '') = '' then
      return new;
    end if;

    if tg_op = 'INSERT' then
      if not v_cfg.notify_admin then return new; end if;
      if coalesce(new.source, '') = 'pos' and not v_cfg.notify_pos then return new; end if;

      v_msg := public.tg_invoice_message(new.id, 'new', null);
      if coalesce((v_msg->>'ok')::boolean, false) then
        for v_chat in select chat_id from public.telegram_admins loop
          perform public.tg_api('sendMessage', jsonb_build_object(
            'chat_id', v_chat,
            'parse_mode', 'HTML',
            'text', v_msg->>'text',
            'reply_markup', v_msg->'keyboard',
            'disable_web_page_preview', true
          ));
        end loop;
      end if;
      return new;
    end if;

    if tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then return new; end if;
      if coalesce(new.source, '') = 'pos' and not v_cfg.notify_pos then return new; end if;

      v_prev := old.status;

      if v_cfg.notify_admin then
        v_msg := public.tg_invoice_message(new.id, 'status', v_prev);
        if coalesce((v_msg->>'ok')::boolean, false) then
          for v_chat in select chat_id from public.telegram_admins loop
            perform public.tg_api('sendMessage', jsonb_build_object(
              'chat_id', v_chat,
              'parse_mode', 'HTML',
              'text', v_msg->>'text',
              'reply_markup', v_msg->'keyboard',
              'disable_web_page_preview', true
            ));
          end loop;
        end if;
      end if;

      if v_cfg.notify_customer and coalesce(new.order_token, '') <> '' then
        for v_chat in select chat_id from public.order_chat_links where order_token = new.order_token loop
          perform public.tg_api('sendMessage', jsonb_build_object(
            'chat_id', v_chat,
            'parse_mode', 'HTML',
            'text',
              '🔔 <b>تحديث طلبك #' || coalesce(new.invoice_no::text, '') || '</b>' || E'\n' ||
              'الحالة الآن: <b>' || public.tg_esc(coalesce(new.status, '')) || '</b>' || E'\n' ||
              'الإجمالي: ' || public.tg_money(new.total) || ' ج.م' || E'\n\n' ||
              'شكرًا لتسوّقك معنا 🛍️'
          ));
        end loop;
      end if;
      return new;
    end if;
  exception when others then
    raise warning 'telegram alert skipped: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_invoices_telegram on public.invoices;
create trigger trg_invoices_telegram
  after insert or update of status on public.invoices
  for each row execute function public.tg_invoice_alert();

-- ── 7) رسالة تجربة (للتأكد أن البوت موصول) ─────────────────────────────────
create or replace function public.tg_test(p_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_chat   bigint;
  v_count  int := 0;
  v_req    bigint;
  v_body   text;
begin
  if coalesce(length(btrim((select bot_token from public.telegram_config where id = 1))), 0) < 20 then
    return jsonb_build_object('ok', false, 'error', 'التوكن غير مضبوط في telegram_config');
  end if;
  select count(*) into v_count from public.telegram_admins;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد مدير مربوط بعد — أرسل /start admin_<CODE> للبوت');
  end if;
  for v_chat in select chat_id from public.telegram_admins loop
    v_req := public.tg_api('sendMessage', jsonb_build_object(
      'chat_id', v_chat,
      'parse_mode', 'HTML',
      'text', coalesce(p_text, '✅ <b>تجربة ناجحة</b>' || E'\n' || 'البوت موصول بمتجر آل السيد وسيصلك هنا كل طلب جديد فورًا.')
    ));
  end loop;
  return jsonb_build_object('ok', true, 'admins', v_count, 'first_request_id', v_req);
end $$;

revoke all on function public.tg_test(text) from public;
grant execute on function public.tg_test(text) to service_role;

-- ── 8) فحص ذاتي ─────────────────────────────────────────────────────────────
do $$
declare
  v_missing text[] := '{}';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    v_missing := array_append(v_missing, 'pg_net');
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'telegram_config') then
    v_missing := array_append(v_missing, 'telegram_config');
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'telegram_admins') then
    v_missing := array_append(v_missing, 'telegram_admins');
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'telegram_inbox') then
    v_missing := array_append(v_missing, 'telegram_inbox');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'telegram_config' and column_name = 'auto_claim_until') then
    v_missing := array_append(v_missing, 'telegram_config.auto_claim_until');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_invoices_telegram') then
    v_missing := array_append(v_missing, 'trg_invoices_telegram');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'admin_set_order_status') then
    v_missing := array_append(v_missing, 'admin_set_order_status()');
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'ترحيل ناقص: %', array_to_string(v_missing, ', ');
  end if;
  raise notice '✅ ترحيل تيليجرام مكتمل';
end $$;

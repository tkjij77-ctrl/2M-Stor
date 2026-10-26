// ═══════════════════════════════════════════════════════════════════════════
//  ✈️  telegram-order-bot — مستقبِل تحديثات البوت (Webhook)
//
//  التقسيم بعد تحديث 2026-10-26:
//    • إشعارات الطلبات (جديد / تغيّر حالة) صارت **داخل قاعدة البيانات** عبر
//      pg_net + المشغّل trg_invoices_telegram — لا تحتاج هذه الدالة إطلاقًا.
//    • هذه الدالة تتولّى فقط ما يأتي **من** تيليجرام:
//         /start admin_<CODE>   ⇒ ربط محادثة المدير (مرة واحدة) — CODE من telegram_config
//         /start o_<TOKEN>      ⇒ ربط محادثة العميل بطلبه (تحديثات الحالة تصله)
//         /id                   ⇒ يعرض معرّف المحادثة (للتشخيص)
//         /orders               ⇒ آخر 5 طلبات (للمدير فقط)
//         أزرار ✅ تأكيد / 🚚 خرج للتوصيل / 📦 تم التسليم / 🚫 إلغاء
//                               ⇒ تنادي admin_set_order_status() التي تضبط المخزون
//
//  لماذا بلا مكتبات؟ نسخة 2026-10-26 اتصلت بـ PostgREST مباشرةً عبر fetch،
//  لأن استيراد supabase-js من CDN كان يُفشل تشغيل الدالة (BOOT_ERROR).
//  صفر اعتماديات = تشغيل أسرع وأثبت.
//
//  الأمان: كل طلب يحمل ترويسة X-Telegram-Bot-Api-Secret-Token مطابقة لـ webhook_secret.
//  لا يوجد أي توكن داخل الملف — كله من جدول telegram_config المحجوب (RLS بلا سياسات).
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

let cfgCache = null;

function headers(extra) {
  return Object.assign(
    {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json"
    },
    extra || {}
  );
}

async function rest(path, init) {
  const opts = Object.assign({}, init || {});
  opts.headers = headers(opts.headers);
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, opts);
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: res.ok, status: res.status, data: data };
}

async function cfg() {
  if (cfgCache) return cfgCache;
  const { data } = await rest("telegram_config?id=eq.1&select=bot_token,bot_username,webhook_secret,admin_claim_code,store_url");
  cfgCache = (data && data[0]) || { bot_token: null, webhook_secret: null, admin_claim_code: null, store_url: null };
  return cfgCache;
}

async function tg(method, body) {
  const c = await cfg();
  if (!c.bot_token) return { ok: false, description: "no token" };
  const res = await fetch("https://api.telegram.org/bot" + c.bot_token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({ ok: false }));
}

const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const money = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-EG");

async function isAdmin(chatId) {
  const { data } = await rest("telegram_admins?chat_id=eq." + chatId + "&select=chat_id&limit=1");
  return !!(data && data.length);
}

async function adminCount() {
  const { data } = await rest("telegram_admins?select=chat_id");
  return (data && data.length) || 0;
}

const json = (body, status) =>
  new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, service: "telegram-order-bot" });

  const c = await cfg();

  // ── تحقّق من الترويسة السرّية التي يرسلها تيليجرام ──
  if (c.webhook_secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (got !== c.webhook_secret) return json({ ok: false, error: "unauthorized" }, 401);
  }

  let update = null;
  try { update = await req.json(); } catch { return json({ ok: true, note: "empty" }); }

  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) {
    console.error("update error", e);
  }
  return json({ ok: true });
});

// ── أزرار الحالة ────────────────────────────────────────────────────────────
async function onCallback(cq) {
  const data = cq.data || "";
  const chatId = (cq.message && cq.message.chat && cq.message.chat.id) || (cq.from && cq.from.id);
  const msgId = cq.message && cq.message.message_id;

  if (!data.startsWith("st:")) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return;
  }

  if (!(await isAdmin(chatId))) {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "⛔ هذه الأزرار للمتجر فقط",
      show_alert: true
    });
    return;
  }

  const parts = data.split(":");
  const id = Number(parts[1]);
  const status = parts[2];
  const allowed = ["مؤكد", "في الطريق", "تم التوصيل", "ملغي"];
  if (!isFinite(id) || allowed.indexOf(status) === -1) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "حالة غير صحيحة", show_alert: true });
    return;
  }

  const r = await rest("rpc/admin_set_order_status", {
    method: "POST",
    body: JSON.stringify({ p_id: id, p_status: status, p_note: "chat:" + chatId })
  });
  const res = r.data || {};

  if (!r.ok || !res.ok) {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "❌ " + (res.error || "تعذّر التحديث"),
      show_alert: true
    });
    return;
  }

  const label = {
    "قيد المعالجة": "🆕 جديد",
    "مؤكد": "✅ مؤكد",
    "في الطريق": "🚚 في الطريق",
    "تم التوصيل": "📦 تم التوصيل",
    "ملغي": "🚫 ملغي",
    "تم رفض الطلب": "❌ مرفوض"
  };
  const extra = res.stock_moved ? " · أُرجع " + res.stock_moved + " صنف للمخزون" : "";

  await tg("answerCallbackQuery", {
    callback_query_id: cq.id,
    text: "✅ الطلب #" + res.invoice_no + ": " + (label[status] || status) + extra
  });

  // نُحدّث الرسالة نفسها حتى لا يبقى زر «تأكيد» على طلب مؤكد
  if (msgId) {
    const caption = (cq.message && cq.message.text) || "";
    const stripped = caption.split("\n🔘")[0];
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: "HTML",
      text: stripped + "\n\n🔘 الحالة الآن: <b>" + (label[status] || status) + "</b>",
      reply_markup: { inline_keyboard: [] }
    }).catch(() => {});
  }
}

// ── الرسائل النصية ──────────────────────────────────────────────────────────
async function onMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = String(msg.text || "").trim();
  const c = await cfg();
  let storeUrl = String(c.store_url || "").trim();
  while (storeUrl.endsWith("/")) storeUrl = storeUrl.slice(0, -1);

  // /start admin_<CODE> ⇒ ربط المدير
  if (text.startsWith("/start admin_")) {
    const code = text.slice("/start admin_".length).trim().toUpperCase();
    if (!c.admin_claim_code || code !== String(c.admin_claim_code).toUpperCase()) {
      await tg("sendMessage", { chat_id: chatId, text: "❌ كود غير صحيح. اطلب الكود الحالي من صاحب المتجر." });
      return;
    }
    const from = msg.from || {};
    const up = await rest("telegram_admins?on_conflict=chat_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        chat_id: chatId,
        title: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
        username: from.username || null,
        added_at: new Date().toISOString()
      }])
    });
    const n = await adminCount();
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: up.ok
        ? "✅ <b>تم ربط هذه المحادثة كمدير المتجر.</b>\n" +
          (n > 1 ? "(عدد المدراء الآن: " + n + ")\n" : "") +
          "سيصلك هنا كل طلب جديد فورًا، مع أزرار لتغيير حالته دون فتح الموقع."
        : "❌ تعذّر الربط: " + esc(typeof up.data === "string" ? up.data : JSON.stringify(up.data))
    });
    return;
  }

  // /start o_<TOKEN> ⇒ ربط العميل بطلبه
  if (text.startsWith("/start o_")) {
    const token = text.slice("/start o_".length).trim();
    const { data } = await rest("invoices?order_token=eq." + encodeURIComponent(token) + "&select=invoice_no,status,total&limit=1");
    const inv = data && data[0];
    if (!inv) {
      await tg("sendMessage", { chat_id: chatId, text: "لم أجد طلبًا بهذا الرابط — تأكد من نسخه كاملًا." });
      return;
    }
    await rest("order_chat_links?on_conflict=order_token", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ order_token: token, chat_id: chatId, linked_at: new Date().toISOString() }])
    });
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: "✅ تم ربط طلبك <b>#" + inv.invoice_no + "</b> بهذه المحادثة.\nهيرسلك هنا أي تحديث على حالة الطلب، ويمكنك متابعته من الموقع."
    });
    return;
  }

  if (text === "/id" || text.startsWith("/id ")) {
    await tg("sendMessage", { chat_id: chatId, text: "معرّف محادثتك: " + chatId });
    return;
  }

  if (text === "/orders" || text.startsWith("/orders ")) {
    if (!(await isAdmin(chatId))) {
      await tg("sendMessage", { chat_id: chatId, text: "⛔ هذا الأمر للمتجر فقط." });
      return;
    }
    const { data } = await rest("invoices?select=invoice_no,status,total,created_at&order=created_at.desc&limit=5");
    const lines = (data || []).map((r) => "#" + r.invoice_no + " · " + esc(r.status) + " · " + money(r.total) + " ج");
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: lines.length ? "<b>آخر 5 طلبات</b>\n" + lines.join("\n") : "لا توجد طلبات بعد."
    });
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    const btn = [];
    if (storeUrl) btn.push([{ text: "🛍️ افتح المتجر", web_app: { url: storeUrl } }]);
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "أهلًا بك في متجر <b>آل السيد</b> 👋\n\n" +
        "• للشراء: افتح المتجر من الزر بالأسفل.\n" +
        "• لمتابعة طلب: استخدم رابط «تتبّع الطلب» الذي يظهر لك بعد الشراء.\n" +
        "• للمتجر: /orders لآخر الطلبات · /id لمعرفة رقم المحادثة.",
      reply_markup: btn.length ? { inline_keyboard: btn } : undefined
    });
    return;
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: "استخدم /help للبدء، أو رابط «تتبّع طلبك» من صفحة الطلب لربط المحادثة بطلبك."
  });
}

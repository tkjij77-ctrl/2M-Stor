// ✈️ telegram-order-bot — تستقبل ما يأتي من تيليجرام فقط
// (إشعارات الطلبات تُرسَل من قاعدة البيانات: pg_net + trg_invoices_telegram)
// أوامر: /start admin_<CODE> · /start o_<TOKEN> · /id · /orders · /help
// أزرار: ✅ تأكيد · 🚚 خرج للتوصيل · 📦 تم التسليم · 🚫 إلغاء
// أمان: ترويسة X-Telegram-Bot-Api-Secret-Token + التوكن من telegram_config فقط
// بلا مكتبات خارجية (fetch مباشر لـ PostgREST) — CDN كان يمنع التشغيل
// كل وارد يُسجَّل في telegram_inbox (service فقط) لتشخيص أي عطل
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
let cfgCache = null;

const hdr = (x) => Object.assign({ apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "content-type": "application/json" }, x || {});

async function rest(path, init) {
  const o = Object.assign({}, init || {});
  o.headers = hdr(o.headers);
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, o);
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}

async function cfg() {
  if (cfgCache) return cfgCache;
  const { data } = await rest("telegram_config?id=eq.1&select=bot_token,webhook_secret,admin_claim_code,store_url");
  cfgCache = (data && data[0]) || { bot_token: null, webhook_secret: null, admin_claim_code: null, store_url: null };
  return cfgCache;
}

async function tg(method, body) {
  const c = await cfg();
  if (!c.bot_token) return { ok: false };
  const r = await fetch("https://api.telegram.org/bot" + c.bot_token + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return await r.json().catch(() => ({ ok: false }));
}

const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const money = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-EG");
const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "content-type": "application/json" } });

async function logInbox(chatId, from, text, kind) {
  try {
    await rest("telegram_inbox", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ chat_id: chatId, username: (from && from.username) || null,
        title: [from && from.first_name, from && from.last_name].filter(Boolean).join(" ") || null,
        text: String(text || "").slice(0, 300), kind: kind }])
    });
  } catch { /* التسجيل لا يعطل الرد */ }
}

const isAdmin = async (chatId) => {
  const { data } = await rest("telegram_admins?chat_id=eq." + chatId + "&select=chat_id&limit=1");
  return !!(data && data.length);
};
const adminCount = async () => {
  const { data } = await rest("telegram_admins?select=chat_id");
  return (data && data.length) || 0;
};
async function autoClaimOpen() {
  const { data } = await rest("telegram_config?id=eq.1&select=auto_claim_until");
  const u = data && data[0] && data[0].auto_claim_until;
  return !!u && new Date(u).getTime() > Date.now();
}
const addAdmin = (chatId, from) => rest("telegram_admins?on_conflict=chat_id", {
  method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{ chat_id: chatId,
    title: [from && from.first_name, from && from.last_name].filter(Boolean).join(" ") || null,
    username: (from && from.username) || null, added_at: new Date().toISOString() }])
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, service: "telegram-order-bot" });
  const c = await cfg();
  if (c.webhook_secret && (req.headers.get("x-telegram-bot-api-secret-token") || "") !== c.webhook_secret)
    return json({ ok: false, error: "unauthorized" }, 401);
  let up = null;
  try { up = await req.json(); } catch { return json({ ok: true, note: "empty" }); }
  try {
    if (up.callback_query) {
      const cq = up.callback_query;
      const chat = (cq.message && cq.message.chat && cq.message.chat.id) || (cq.from && cq.from.id);
      await logInbox(chat, cq.from, cq.data, "button");
      await onCallback(cq);
    } else if (up.message) {
      await logInbox(up.message.chat && up.message.chat.id, up.message.from, up.message.text, "message");
      await onMessage(up.message);
    }
  } catch (e) { console.error("update error", e); }
  return json({ ok: true });
});

async function onCallback(cq) {
  const data = cq.data || "";
  const chatId = (cq.message && cq.message.chat && cq.message.chat.id) || (cq.from && cq.from.id);
  const msgId = cq.message && cq.message.message_id;
  if (!data.startsWith("st:")) { await tg("answerCallbackQuery", { callback_query_id: cq.id }); return; }
  if (!(await isAdmin(chatId))) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "⛔ هذه الأزرار للمتجر فقط", show_alert: true });
    return;
  }
  const p = data.split(":");
  const id = Number(p[1]);
  const status = p[2];
  if (!isFinite(id) || ["مؤكد", "في الطريق", "تم التوصيل", "ملغي"].indexOf(status) === -1) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "حالة غير صحيحة", show_alert: true });
    return;
  }
  const r = await rest("rpc/admin_set_order_status", {
    method: "POST", body: JSON.stringify({ p_id: id, p_status: status, p_note: "chat:" + chatId })
  });
  const res = r.data || {};
  if (!r.ok || !res.ok) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "❌ " + (res.error || "تعذّر التحديث"), show_alert: true });
    return;
  }
  const label = { "قيد المعالجة": "🆕 جديد", "مؤكد": "✅ مؤكد", "في الطريق": "🚚 في الطريق",
    "تم التوصيل": "📦 تم التوصيل", "ملغي": "🚫 ملغي", "تم رفض الطلب": "❌ مرفوض" };
  const extra = res.stock_moved ? " · أُرجع " + res.stock_moved + " صنف للمخزون" : "";
  await tg("answerCallbackQuery", { callback_query_id: cq.id,
    text: "✅ الطلب #" + res.invoice_no + ": " + (label[status] || status) + extra });
  if (msgId) {
    const stripped = ((cq.message && cq.message.text) || "").split("\n🔘")[0];
    await tg("editMessageText", { chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      text: stripped + "\n\n🔘 الحالة الآن: <b>" + (label[status] || status) + "</b>",
      reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
}

async function onMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = String(msg.text || "").trim();
  const c = await cfg();
  let storeUrl = String(c.store_url || "").trim();
  while (storeUrl.endsWith("/")) storeUrl = storeUrl.slice(0, -1);

  if (text.startsWith("/start admin_")) {
    const code = text.slice("/start admin_".length).trim().toUpperCase();
    if (!c.admin_claim_code || code !== String(c.admin_claim_code).toUpperCase()) {
      await tg("sendMessage", { chat_id: chatId, text: "❌ كود غير صحيح. اطلب الكود الحالي من صاحب المتجر." });
      return;
    }
    const up = await addAdmin(chatId, msg.from);
    const n = await adminCount();
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML",
      text: up.ok
        ? "✅ <b>تم ربط هذه المحادثة كمدير المتجر.</b>\n" + (n > 1 ? "(عدد المدراء الآن: " + n + ")\n" : "") +
          "سيصلك هنا كل طلب جديد فورًا، مع أزرار لتغيير حالته دون فتح الموقع."
        : "❌ تعذّر الربط: " + esc(typeof up.data === "string" ? up.data : JSON.stringify(up.data)) });
    return;
  }

  if (text.startsWith("/start o_")) {
    const token = text.slice("/start o_".length).trim();
    const { data } = await rest("invoices?order_token=eq." + encodeURIComponent(token) + "&select=invoice_no&limit=1");
    const inv = data && data[0];
    if (!inv) { await tg("sendMessage", { chat_id: chatId, text: "لم أجد طلبًا بهذا الرابط — تأكد من نسخه كاملًا." }); return; }
    await rest("order_chat_links?on_conflict=order_token", { method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ order_token: token, chat_id: chatId, linked_at: new Date().toISOString() }]) });
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML",
      text: "✅ تم ربط طلبك <b>#" + inv.invoice_no + "</b> بهذه المحادثة.\nهيرسلك هنا أي تحديث على حالة الطلب." });
    return;
  }

  if (text === "/id" || text.startsWith("/id ")) {
    await tg("sendMessage", { chat_id: chatId, text: "معرّف محادثتك: " + chatId });
    return;
  }

  if (text === "/orders" || text.startsWith("/orders ")) {
    if (!(await isAdmin(chatId))) { await tg("sendMessage", { chat_id: chatId, text: "⛔ هذا الأمر للمتجر فقط." }); return; }
    const { data } = await rest("invoices?select=invoice_no,status,total,created_at&order=created_at.desc&limit=5");
    const lines = (data || []).map((r) => "#" + r.invoice_no + " · " + esc(r.status) + " · " + money(r.total) + " ج");
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML",
      text: lines.length ? "<b>آخر 5 طلبات</b>\n" + lines.join("\n") : "لا توجد طلبات بعد." });
    return;
  }

  // ربط تلقائي: ما دام لا يوجد مدراء والنافذة مفتوحة ⇒ أول Start يصبح مديرًا
  if (text.startsWith("/start") && ((msg.chat && msg.chat.type) || "private") === "private") {
    if ((await adminCount()) === 0 && (await autoClaimOpen())) {
      await addAdmin(chatId, msg.from);
      await rest("telegram_config?id=eq.1", { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ auto_claim_until: null, updated_at: new Date().toISOString() }) });
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML",
        text: "✅ <b>تم ربط هذه المحادثة كمدير المتجر تلقائيًا.</b>\n\n" +
              "من الآن سيصلك هنا كل طلب جديد فور وصوله، مع أزرار:\n" +
              "✅ تأكيد · 🚚 خرج للتوصيل · 📦 تم التسليم · 🚫 إلغاء\n\n" +
              "أرسل /orders لآخر 5 طلبات." });
      return;
    }
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    const btn = [];
    if (storeUrl) btn.push([{ text: "🛍️ افتح المتجر", web_app: { url: storeUrl } }]);
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML",
      text: "أهلًا بك في متجر <b>آل السيد</b> 👋\n\n" +
            "• للشراء: افتح المتجر من الزر بالأسفل.\n" +
            "• لمتابعة طلب: استخدم رابط «تتبّع الطلب» الذي يظهر لك بعد الشراء.\n" +
            "• للمتجر: /orders لآخر الطلبات · /id لمعرفة رقم المحادثة.",
      reply_markup: btn.length ? { inline_keyboard: btn } : undefined });
    return;
  }

  await tg("sendMessage", { chat_id: chatId,
    text: "استخدم /help للبدء، أو رابط «تتبّع طلبك» من صفحة الطلب لربط المحادثة بطلبك." });
}

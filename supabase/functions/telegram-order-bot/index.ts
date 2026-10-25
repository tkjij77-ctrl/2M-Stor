// ═══════════════════════════════════════════════════════════════════════════
//  ✈️  telegram-order-bot — دالة Edge لإشعارات الطلبات الفورية على تيليجرام
//
//  ماذا تفعل:
//   1) تُستدعى من قاعدة البيانات (Webhook) عند إنشاء/تغيير حالة أي طلب.
//   2) ترسل للمدير رسالة فورية فيها كل تفاصيل الطلب + أزرار جاهزة:
//        ✅ تأكيد   ·   🚚 خرج للتوصيل   ·   📦 تم التسليم   ·   🚫 إلغاء
//      والضغط على الزر يُحدِّث حالة الطلب في Supabase فورًا (بلا فتح الموقع).
//   3) ترسل للعميل (إن ربط حسابه بالبوت) تحديث حالة طلبه تلقائيًا.
//   4) تدعم تتبّع العميل: /start o_<token> ⇒ تُربط محادثته بالطلب.
//
//  متطلبات النشر (مرة واحدة):
//    1) أنشئ بوتًا من @BotFather وخذ التوكن.
//    2) supabase secrets set TELEGRAM_BOT_TOKEN=...  TELEGRAM_ADMIN_CHAT_ID=...
//       (اختياري) TELEGRAM_WEBHOOK_SECRET=...  لتأمين نقطة الـ webhook
//    3) supabase functions deploy telegram-order-bot --no-verify-jwt
//    4) اضبط الـ webhook:
//       curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT>.supabase.co/functions/v1/telegram-order-bot"
//    5) في Supabase → Database → Webhooks: أنشئ Webhook على جدول invoices
//       للأحداث INSERT و UPDATE يرسل POST إلى:
//       https://<PROJECT>.supabase.co/functions/v1/telegram-order-bot
//
//  ⚠️ لا يحتوي هذا الملف على أي توكن — كله من أسرار Supabase (Secrets).
// ═══════════════════════════════════════════════════════════════════════════

// Deno runtime (Supabase Edge Functions)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const ADMIN_CHAT = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const STATUS_LABEL: Record<string, string> = {
  "قيد المعالجة": "🆕 جديد",
  "مؤكد": "✅ مؤكد",
  "في الطريق": "🚚 في الطريق",
  "تم التوصيل": "📦 تم التوصيل",
  "ملغي": "🚫 ملغي",
  "تم رفض الطلب": "❌ مرفوض"
};
const PAY_LABEL: Record<string, string> = {
  cod: "💵 عند الاستلام", cash: "💵 نقدي",
  vodafone: "📱 فودافون كاش", instapay: "⚡ إنستاباي", bank: "🏦 تحويل بنكي"
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function tg(method: string, body: Record<string, unknown>) {
  if (!BOT_TOKEN) return { ok: false, description: "TELEGRAM_BOT_TOKEN غير مضبوط" };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json();
}

const money = (n: number | string) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-EG");

function orderKeyboard(invoiceId: number, status: string) {
  const next: Record<string, { t: string; s: string }> = {
    "قيد المعالجة": { t: "✅ تأكيد الطلب", s: "مؤكد" },
    "مؤكد": { t: "🚚 خرج للتوصيل", s: "في الطريق" },
    "في الطريق": { t: "📦 تم التسليم", s: "تم التوصيل" }
  };
  const rows: { text: string; callback_data: string }[][] = [];
  const n = next[status];
  if (n) rows.push([{ text: n.t, callback_data: `st:${invoiceId}:${n.s}` }]);
  if (status !== "ملغي" && status !== "تم التوصيل") {
    rows.push([{ text: "🚫 إلغاء", callback_data: `st:${invoiceId}:ملغي` }]);
  }
  return { inline_keyboard: rows };
}

/** نص إشعار المدير بطلب جديد أو محدَّث */
function adminOrderText(inv: Record<string, any>, items: Record<string, any>[]) {
  const lines = (items || [])
    .map((i) => `  • ${i.item_name} × ${i.qty} = ${money(Number(i.price) * Number(i.qty))} ج`)
    .join("\n");
  const src = { web: "🌐 الموقع", telegram: "✈️ تيليجرام", pos: "🧾 الكاشير", whatsapp: "💬 واتساب" }[inv.source as string] || "🌐 الموقع";
  return [
    `🛒 <b>طلب جديد #${inv.invoice_no}</b>`,
    "",
    `👤 <b>${inv.customer_name}</b>`,
    inv.customer_phone ? `📞 <code>${inv.customer_phone}</code>` : "",
    inv.fulfillment === "pickup"
      ? "🏬 استلام من المحل"
      : `🚚 ${[inv.customer_city, inv.customer_area].filter(Boolean).join(" · ")}\n📍 ${inv.customer_address || ""}`,
    inv.notes ? `📝 ${inv.notes}` : "",
    "",
    lines,
    "",
    `🧮 المجموع: ${money(inv.subtotal)} ج`,
    Number(inv.discount) > 0 ? `🏷️ الخصم: ${money(inv.discount)} ج` : "",
    Number(inv.tax) > 0 ? `🧾 الضريبة: ${money(inv.tax)} ج` : "",
    `🚚 الشحن: ${Number(inv.total) - Number(inv.subtotal) + Number(inv.discount) - Number(inv.tax) > 0 ? money(Number(inv.total) - Number(inv.subtotal) + Number(inv.discount) - Number(inv.tax)) + " ج" : "مجاني"}`,
    `💰 <b>الإجمالي: ${money(inv.total)} ج.م</b>`,
    "",
    `💳 ${PAY_LABEL[inv.payment_method] || inv.payment_method || "—"}`,
    `📌 الحالة: ${STATUS_LABEL[inv.status] || inv.status}`,
    `🔗 المصدر: ${src}`
  ].filter(Boolean).join("\n");
}

/** إشعار العميل بتغيّر حالة طلبه */
async function notifyCustomer(inv: Record<string, any>) {
  if (!inv.order_token) return;
  const { data: link } = await db
    .from("order_chat_links")
    .select("chat_id")
    .eq("order_token", inv.order_token)
    .maybeSingle();
  if (!link || !link.chat_id) return;
  await tg("sendMessage", {
    chat_id: link.chat_id,
    parse_mode: "HTML",
    text: [
      `🔔 <b>تحديث طلبك #${inv.invoice_no}</b>`,
      "",
      `الحالة الآن: <b>${STATUS_LABEL[inv.status] || inv.status}</b>`,
      `الإجمالي: ${money(inv.total)} ج.م`,
      "",
      "شكرًا لتسوّقك معنا 🛍️"
    ].join("\n")
  });
}

Deno.serve(async (req) => {
  // ── (أ) Webhook من قاعدة البيانات: طلب جديد أو تغيّر حالة ──
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    let body: any = null;
    try { body = await req.json(); } catch { /* قد يكون تحديثًا من تيليجرام */ }

    // شكل رسائل تيليجرام: { update_id, message | callback_query }
    if (body && (body.message || body.callback_query)) return await handleTelegramUpdate(body);

    // شكل Webhook قاعدة البيانات: { type: 'INSERT'|'UPDATE', record: {...}, old_record: {...} }
    if (body && body.record && (body.type === "INSERT" || body.type === "UPDATE")) {
      if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
      }
      const inv = body.record;
      const prev = body.old_record || null;
      const isNew = body.type === "INSERT";
      const statusChanged = prev && prev.status !== inv.status;

      if (!isNew && !statusChanged) {
        return new Response(JSON.stringify({ ok: true, skipped: "no status change" }), { status: 200 });
      }

      const { data: items } = await db.from("invoice_items").select("*").eq("invoice_id", inv.id);

      // للمدير: كل طلب جديد + كل تغيّر حالة
      if (ADMIN_CHAT) {
        await tg("sendMessage", {
          chat_id: ADMIN_CHAT,
          parse_mode: "HTML",
          text: adminOrderText(inv, items || []),
          reply_markup: orderKeyboard(inv.id, inv.status)
        });
      }
      // للعميل: عند تغيّر الحالة فقط (لا عند إنشاء الطلب — هو يعرفه)
      if (!isNew) await notifyCustomer(inv);

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, note: "nothing to do" }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true, service: "telegram-order-bot" }), { status: 200 });
});

// ── (ب) رسائل وأزرار تيليجرام ──
async function handleTelegramUpdate(update: any) {
  // زر حالة طلب من لوحة المدير داخل تيليجرام
  if (update.callback_query) {
    const cq = update.callback_query;
    const data: string = cq.data || "";
    if (data.startsWith("st:")) {
      const [, idStr, status] = data.split(":");
      const id = Number(idStr);
      const allowed = ["مؤكد", "في الطريق", "تم التوصيل", "ملغي"];
      if (!allowed.includes(status)) {
        await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "حالة غير صحيحة", show_alert: true });
        return new Response("ok");
      }
      const { error } = await db
        .from("invoices")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: error ? "❌ تعذّر التحديث" : `✅ صار الطلب: ${STATUS_LABEL[status] || status}`
      });
      return new Response("ok");
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("ok");
  }

  const msg = update.message;
  if (!msg || !msg.chat) return new Response("ok");
  const chatId = msg.chat.id;
  const text: string = msg.text || "";

  // /start o_<token> ⇒ ربط محادثة العميل بطلبه
  const m = /^\/start\s+o_([A-Za-z0-9]+)/.exec(text);
  if (m) {
    const token = m[1];
    const { data: inv } = await db
      .from("invoices")
      .select("invoice_no,status,total,order_token")
      .eq("order_token", token)
      .maybeSingle();
    if (!inv) {
      await tg("sendMessage", { chat_id: chatId, text: "لم أجد طلبًا بهذا الرابط — تأكد من نسخه كاملًا." });
      return new Response("ok");
    }
    await db.from("order_chat_links").upsert({
      order_token: token,
      chat_id: chatId,
      linked_at: new Date().toISOString()
    }, { onConflict: "order_token" });
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `✅ تم ربط طلبك <b>#${inv.invoice_no}</b> بهذه المحادثة.\nهيرسلك هنا أي تحديث على حالة الطلب، ويمكنك متابعته من زر «تتبّع طلبك» في الموقع.`
    });
    return new Response("ok");
  }

  if (/^\/start/.test(text) || /^\/help/.test(text)) {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: "أهلًا بك 👋\nللاطلاع على منتجاتنا، افتح المتجر من زر القائمة.\nلمتابعة طلب: استخدم رابط «تتبّع الطلب» الذي وصلك بعد الشراء."
    });
    return new Response("ok");
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: "استخدم زر «تتبّع طلبك» في صفحة الطلب للربط، أو تواصل مع المتجر مباشرة."
  });
  return new Response("ok");
}

#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  🏪 فحص واجهة المتجر الاحترافي بمتصفح حقيقي (Playwright)
//
//  التشغيل:
//    python3 -m http.server 8080 --bind 0.0.0.0     # في نافذة أخرى
//    node scripts/smoke-ui.mjs [BASE_URL]
//
//  يفحص: تحميل التطبيق بلا أخطاء · واجهة المتجر · لوحة التحكم · شاشة الطلبات ·
//        صفحة إتمام الطلب · إرسال طلب كامل · صفحة التتبّع.
//  يفشل (exit 1) عند أي خطأ JavaScript أو عند غياب عنصر أساسي.
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";

const BASE = (process.argv[2] || process.env.SMOKE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR || null;
const fails = [];
const ok = (label, cond, extra = "") => {
  console.log((cond ? "  ✅ " : "  ❌ ") + label + (extra ? "  → " + extra : ""));
  if (!cond) fails.push(label);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-EG" });
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/404|Failed to load resource/.test(t)) return; // جداول لم تُرقَّ بعد — مسار احتياطي مقصود
  jsErrors.push(t.slice(0, 200));
});
const shot = async (name) => { if (SHOT_DIR) await page.screenshot({ path: SHOT_DIR + "/" + name + ".png" }); };

console.log("═══════════════════════════════════════════════════════════════");
console.log("  فحص واجهة المتجر — " + BASE);
console.log("═══════════════════════════════════════════════════════════════");

// ── 1) واجهة المتجر ──
await page.goto(BASE + "/index.html?preview=store", { waitUntil: "load" });
await page.waitForTimeout(2800);
const home = await page.evaluate(() => ({
  wrap: !!document.querySelector(".pro-home-wrap"),
  banner: !!document.querySelector(".pro-banner-slide"),
  cats: document.querySelectorAll(".pro-cat-item").length,
  trust: document.querySelectorAll(".pro-trust-card").length,
  install: !!document.getElementById("proInstallCard"),
  items: (typeof db !== "undefined" ? db : []).reduce((a, c) => a + c.items.length, 0)
}));
console.log("\n🏪 واجهة المتجر");
ok("الصفحة الرئيسية واجهة متجر (pro-home-wrap)", home.wrap);
ok("سلايدر البنرات ظاهر", home.banner);
ok("دوائر الأقسام", home.cats >= 1, home.cats + " قسم");
ok("شرائط الثقة (شحن/دفع/إرجاع/دعم)", home.trust === 4);
ok("بطاقة تثبيت التطبيق", home.install);
ok("المنتجات محمّلة من السحابة", home.items > 0, home.items + " منتج");
await shot("store");

// ── 2) لوحة التحكم ──
await page.goto(BASE + "/index.html?preview=admin", { waitUntil: "load" });
await page.waitForTimeout(2800);
const admin = await page.evaluate(() => ({
  open: !!document.querySelector("#proAdmin.open"),
  links: document.querySelectorAll(".pro-admin-link").length,
  kpi: document.querySelectorAll(".pro-kpi-card").length
}));
console.log("\n🖥️ لوحة التحكم");
ok("اللوحة تُفتح", admin.open);
ok("شريط جانبي بكل الشاشات", admin.links >= 7, admin.links + " رابط");
ok("بطاقات المؤشرات", admin.kpi === 4);
await shot("admin");

for (const v of ["orders", "products", "categories", "banners", "customers", "settings"]) {
  const r = await page.evaluate((view) => {
    proAdminGo(view);
    return document.getElementById("proAdminContent").innerHTML.length;
  }, v);
  ok("شاشة «" + v + "» ترسم", r > 300, r + " حرف");
  await shot("admin-" + v);
}

// ── 3) تفاصيل طلب تجريبي ──
const detail = await page.evaluate(() => {
  proAdminGo("orders");
  proCreateDemoOrder();
  const o = proAllOrders()[0];
  proOrderOpen(o.key);
  return {
    len: document.getElementById("proAdminContent").innerHTML.length,
    hasTrack: !!document.querySelector(".pro-track-steps"),
    hasCall: document.getElementById("proAdminContent").innerHTML.indexOf("tel:") !== -1
  };
});
console.log("\n📄 تفاصيل الطلب");
ok("الشاشة ترسم", detail.len > 800);
ok("مسار حالة الطلب", detail.hasTrack);
ok("زر اتصال بالعميل", detail.hasCall);
await shot("admin-order-detail");

// ── 4) إتمام الطلب كزائر ──
await page.goto(BASE + "/index.html?preview=shop", { waitUntil: "load" });
await page.waitForTimeout(2800);
const cart = await page.evaluate(() => {
  let n = 0;
  for (let ci = 0; ci < db.length && n < 2; ci++)
    for (let ii = 0; ii < db[ci].items.length && n < 2; ii++)
      if (getQs(db[ci].items[ii]) > 0) { addToCart(ci, ii); n++; }
  openCart();
  return { count: cartCount(), freeship: !!document.querySelector(".pro-freeship"), cta: !!document.querySelector(".pro-checkout-cta") };
});
console.log("\n💳 إتمام الطلب");
ok("الإضافة للسلة", cart.count === 2);
ok("شريط الشحن المجاني في السلة", cart.freeship);
ok("زر «إتمام الطلب أونلاين»", cart.cta);
await shot("cart");

await page.evaluate(() => { proOpenCheckout(); });
await page.waitForTimeout(600);
const co = await page.evaluate(() => ({
  steps: document.querySelectorAll(".pro-step-box").length,
  total: (document.getElementById("proCheckoutStickyTotal") || {}).textContent || ""
}));
ok("صفحة الدفع من 3 خطوات + ملخص", co.steps === 4, co.steps + " صندوق · إجمالي " + co.total);
await shot("checkout");

const done = await page.evaluate(async () => {
  proCheckoutSet("name", "محمد عبد الله");
  proCheckoutSet("phone", "01098765432");
  proCheckoutSet("address", "شارع الجمهورية — برج النيل، الدور 4");
  proRenderCheckout();
  await proSubmitOrder();
  await new Promise((r) => setTimeout(r, 1200));
  const last = invoices[invoices.length - 1] || {};
  return { text: document.getElementById("proCheckout").innerText.slice(0, 60), no: last.no, token: last.token };
});
ok("إتمام الطلب وحفظه", !!done.no && !!done.token, "طلب #" + done.no);
await shot("order-done");

// ── 5) تتبّع الطلب بالرمز ──
const track = await page.evaluate(async (token) => {
  proTrackByToken(token);
  await new Promise((r) => setTimeout(r, 1200));
  return document.getElementById("proCheckout").innerText.replace(/\n+/g, " | ").slice(0, 90);
}, done.token);
ok("صفحة تتبّع الطلب تعمل بالرمز", /تتبّع|طلب رقم|جاري البحث/.test(track), track);
await shot("tracking");

console.log("\n🧪 أخطاء JavaScript: " + (jsErrors.length ? jsErrors.slice(0, 5).join(" | ") : "لا شيء ✅"));
if (jsErrors.length) fails.push("أخطاء JavaScript");

await browser.close();
console.log("═".repeat(63));
console.log(fails.length ? "❌ فشل " + fails.length + " فحصًا: " + fails.join(" · ") : "✅ كل الفحوص ناجحة");
process.exit(fails.length ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════
//  🔒 SEC-1 — فحص سلوك الواجهة: ماذا يقرأ الزائر فعلًا؟ (متصفح حقيقي)
//
//  لماذا فحص متصفح لا قراءة كود؟ لأن الثغرة كانت «إخفاءً في العرض»: الأرقام
//  تُحمَّل إلى المتصفح ثم تُخفى. فالحكم الوحيد الصادق هو: **أي طلب شبكة**
//  يُرسله المتصفح، وما يظهر على الشاشة.
//
//  ما يفعله:
//   1) يعترض الشبكة (page.route) ويُحاكي PostgREST بدل لمس قاعدة الإنتاج.
//   2) يؤكد أن الزائر يطلب `items_public` و**لا يطلب** `items` إطلاقًا.
//   3) يؤكد أن الشاشة تقول «متوفر / آخر 2 قطع / غير متوفر» ولا تُظهر رقمًا
//      واحدًا من أرقام الجرد (40 قطعة مثلًا).
//   4) يحاكي قاعدة قديمة (items_public غير موجودة) ويتأكد من السقوط الآمن
//      إلى `items` — أي أن النشر قبل الترحيل لا يُعطّل المتجر.
//
//  التشغيل:  python3 -m http.server 8123  ثم  node scripts/verify-stock-projection-ui.js
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';
let pass = 0, fail = 0;
const ok = (m, c, d) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${m}${d ? '  → ' + d : ''}`); };

const now = '2026-11-07T10:00:00Z';
const CATS = [{ id: 1, name: 'كهربائيات', updated_at: now, deleted_at: null, image_url: null, icon: '⚡', sort_order: 0 }];
// إسقاط الزائر: بلا stock_q/display_qs — حالة فقط
const ITEMS_PUBLIC = [
  { id: 11, category_id: 1, name: 'لمبة ليد متوفرة', price_text: '50', price_num: 50, stock_state: 'in', low_qty: null, image_url: null, description: null, old_price: null, images: [], updated_at: now },
  { id: 12, category_id: 1, name: 'مفتاح قارب النفاد', price_text: '30', price_num: 30, stock_state: 'low', low_qty: 2, image_url: null, description: null, old_price: null, images: [], updated_at: now },
  { id: 13, category_id: 1, name: 'سلك نافد', price_text: '20', price_num: 20, stock_state: 'out', low_qty: null, image_url: null, description: null, old_price: null, images: [], updated_at: now },
];
// الصف الخام (قاعدة قديمة): يحمل الأرقام — يُستخدم لفحص السقوط فقط
const ITEMS_RAW = [
  { id: 11, category_id: 1, name: 'لمبة ليد متوفرة', price_text: '50', price_num: 50, stock_q: 400, display_qs: 40, min_alert: 5, image_url: null, updated_at: now, deleted_at: null },
];
const SETTINGS = [
  { key: 'store_name', value: 'متجر الاختبار' }, { key: 'tax_pct', value: '0' },
  { key: 'shipping_fee', value: '0' }, { key: 'store_open', value: '1' },
];

async function mock(page, { failPublic }) {
  const seen = [];
  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname.replace('/rest/v1/', '');
    const table = path.split('?')[0];
    seen.push(table);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const send = (rows, status = 200) => route.fulfill({ status, headers: cors, body: JSON.stringify(rows) });
    if (table === 'items_public') {
      // محاكاة قاعدة لم يُنفَّذ عليها الترحيل: PostgREST يردّ 404 للجدول غير الموجود
      if (failPublic) return send({ code: 'PGRST205', message: "Could not find the table 'public.items_public'" }, 404);
      return send(ITEMS_PUBLIC);
    }
    if (table === 'items_staff') return send([]);
    if (table === 'items') return send(ITEMS_RAW);
    if (table === 'categories') return send(CATS);
    if (table === 'settings') return send(SETTINGS);
    if (table === 'invoices') return send([]);
    if (table === 'banners') return send([]);
    return send([]);
  });
  return seen;
}

const shot = async (p, name) => { await p.screenshot({ path: `/home/user/shots/${name}.png`, fullPage: false }); };

(async () => {
  const browser = await chromium.launch();
  // نمنع الـService Worker: طلباته لا تمرّ على page.route ⇒ تُفقد مصداقية الفحص
  const ctx = await browser.newContext({ viewport: { width: 480, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));

  console.log('\n【1】 الزائر على التطبيق الرئيسي — أي طلب شبكة يرسل؟');
  const seenA = await mock(page, { failPublic: false });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  // ملاحظة: db مُعلنة بـ`let` في نطاق عام ⇒ ليست خاصية على window، تُقرأ بالاسم
  await page.waitForFunction(() => { try { return Array.isArray(db); } catch { return false; } }, { timeout: 20000 });
  await page.waitForFunction(() => { try { return db.length > 0; } catch { return false; } }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  ok('الزائر طلب items_public', seenA.includes('items_public'), seenA.join(' · '));
  ok('الزائر لم يطلب جدول items الخام إطلاقًا', !seenA.includes('items'), seenA.join(' · '));
  ok('لا أخطاء JavaScript في الصفحة', errs.length === 0, errs.join(' | '));

  console.log('\n【2】 ماذا يظهر على الشاشة؟ (لا رقم من الجرد)');
  // الزائر يبدأ على صفحة الترحيب — ننتقل إلى المتجر ونجرد نص الشبكة نفسها
  await page.evaluate(() => setView('shop'));
  await page.waitForTimeout(900);
  const grid = await page.evaluate(() => {
    const el = document.querySelector('.shop-grid');
    return el ? el.innerText : '';
  });
  if (process.env.DUMP) console.log('----- نص شبكة المتجر -----\n' + grid + '\n--------------------------');
  ok('شبكة المتجر ظهرت وفيها أصناف', grid.length > 0, grid.slice(0, 60));
  ok('الصنف المتوفر يظهر «متوفر ✅»', /لمبة ليد متوفرة[\s\S]{0,40}?متوفر/.test(grid));
  ok('قارب النفاد يقول «آخر 2 قطع» (وهو إعلان مقصود ≤3)', /آخر 2 قطع/.test(grid));
  const outCard = (grid.match(/سلك نافد[\s\S]{0,60}/) || [''])[0];
  ok('النافد يُوسَم «غير متوفر» ولا يُدّعى توفره', /غير متوفر/.test(outCard) && !/متوفر ✅/.test(outCard), JSON.stringify(outCard));
  ok('لا يظهر رقم الجرد (40) ولا الإجمالي (400) في الشاشة', !/\b40\b/.test(grid) && !/\b400\b/.test(grid));
  ok('لا يظهر عدّاد «متاح: N» لغير الموظف', !/متاح:\s*\d+/.test(grid));
  await shot(page, 'main-app-guest');
  console.log('     📸 /home/user/shots/main-app-guest.png');

  console.log('\n【3】 محاولة تجاوز من المتصفح (الزائر يقرأ الجدول الخام)');
  const rawProbe = await page.evaluate(async () => {
    // نفس ما كان يفعله أي زائر: طلب مباشر لأرقام المخزون
    const r = await fetch('https://uzzxhbotbshsgpdnbrmd.supabase.co/rest/v1/items?select=stock_q,display_qs&limit=5');
    return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 120) };
  });
  console.log(`     محاكاة الشبكة ردّت ${rawProbe.status} — الحكم الحقيقي من verify-sql-live.sh (القسم 10)`);
  ok('طلب أرقام المخزون من الواجهة لم يُنتج بيانات داخل التطبيق',
    await page.evaluate(() => !JSON.stringify(db).includes('stock_q')));

  console.log('\n【4】 توافق خلفي — قاعدة لم يُنفَّذ عليها الترحيل بعد');
  const page2 = await ctx.newPage();
  const seenB = await mock(page2, { failPublic: true });
  await page2.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => { try { return Array.isArray(db); } catch { return false; } }, { timeout: 20000 });
  await page2.waitForTimeout(2500);
  ok('حاول items_public أولًا', seenB.includes('items_public'), seenB.join(' · '));
  ok('ثم سقط إلى items ولم يتعطل المتجر', seenB.includes('items'), seenB.join(' · '));
  await page2.evaluate(() => setView('shop'));
  await page2.waitForTimeout(900);
  const grid2 = await page2.evaluate(() => document.querySelector('.shop-grid')?.innerText || '');
  ok('المتجر ما زال يعرض منتجاته بعد السقوط', /لمبة ليد متوفرة/.test(grid2), grid2.slice(0, 60));
  await shot(page2, 'main-app-legacy-fallback');
  console.log('     📸 /home/user/shots/main-app-legacy-fallback.png');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  النتيجة:  ✅ ${pass} ناجح   ❌ ${fail} فاشل`);
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('💥', e); process.exit(1); });

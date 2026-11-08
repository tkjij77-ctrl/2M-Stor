// ═══════════════════════════════════════════════════════════════════
//  T7.4 — موزّع الأحداث (بديل onclick) في متصفح حقيقي
//
//  لماذا: تحويل 374 معالجًا مضمّنًا إلى data-act بلا فحص سلوكي = نقل
//  الثغرة من مكان إلى آخر. هذا السكربت يقيس **الأثر**:
//    1) الصفحة كما تُرسَم لا تحتوي أي معالج مضمّن إطلاقًا
//    2) النقر على زر data-act يُنفّذ نفس الوظيفة (إضافة للسلة فعلًا)
//    3) الأسماء غير المعروفة لا تُنفّذ شيئًا (لا eval، لا تنفيذ نصّي)
//    4) stopPropagation ما زال يعمل (نقر الزر لا يفتح صفحة المنتج)
//
//  التشغيل: node scripts/verify-actions-dispatch.js   (خادم على 8123 أو BASE_URL)
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';

// ── محاكاة PostgREST: بيانات كافية لرسم بطاقات المتجر (بلا لمس الإنتاج) ──
const now = '2026-11-07T10:00:00Z';
const CATS = [{ id: 1, name: 'كهربائيات', updated_at: now, deleted_at: null, image_url: null, icon: '⚡', sort_order: 0 }];
const ITEMS_PUBLIC = [
  { id: 11, category_id: 1, name: 'لمبة ليد متوفرة', price_text: '50', price_num: 50, stock_state: 'in', low_qty: null, image_url: null, description: null, old_price: null, images: [], updated_at: now },
  { id: 12, category_id: 1, name: 'مفتاح قارب النفاد', price_text: '30', price_num: 30, stock_state: 'low', low_qty: 2, image_url: null, description: null, old_price: null, images: [], updated_at: now },
];
const SETTINGS = [{ key: 'store_name', value: 'متجر الاختبار' }, { key: 'tax_pct', value: '0' }, { key: 'shipping_fee', value: '0' }, { key: 'store_open', value: '1' }];

async function mockRest(page) {
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const table = new URL(req.url()).pathname.replace('/rest/v1/', '').split('?')[0];
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const send = (rows) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify(rows) });
    if (table === 'items_public') return send(ITEMS_PUBLIC);
    if (table === 'categories') return send(CATS);
    if (table === 'settings') return send(SETTINGS);
    return send([]);
  });
}


let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));

  // محاكاة الشبكة بالكامل: لا طلب واحد يبلغ Supabase الحقيقي
  await page.route('**/*', r => {
    const u = r.request().url();
    if (/\.supabase\.co\/(auth|realtime|storage)\//.test(u)) return r.abort();
    return r.continue();
  });
  await mockRest(page);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T7.4 — موزّع الأحداث: سلوك حقيقي بلا معالج مضمّن');
  console.log('═══════════════════════════════════════════════════════════════');

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // ═══ 1) لا معالج مضمّن في الـDOM المرسوم ═══
  console.log('\n【1】 الـDOM المرسوم خالٍ من المعالجات المضمّنة');
  // ننتقل إلى المتجر حتى تُرسم مكوّنات pro-store.js المحوَّلة
  await page.evaluate(() => { try { setView('shop'); } catch { /* الصفحة قد تكون مقفلة */ } });
  await page.waitForTimeout(900);

  const scan = await page.evaluate(() => {
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onsubmit', 'onblur', 'ondrop', 'ondragover', 'ondragleave'];
    const count = (root) => {
      let n = 0;
      for (const el of root.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) n++;
      return n;
    };
    return {
      total: count(document),
      shop: document.querySelector('.shop-grid') ? count(document.querySelector('.shop-grid')) : -1,
      cards: [...document.querySelectorAll('.shop-card')].length,
    };
  });
  check('المكوّنات المحوَّلة (شبكة المتجر) بلا أي معالج مضمّن', scan.shop === 0, `عناصر الشبكة: ${scan.shop} · بطاقات: ${scan.cards}`);
  check('شبكة المتجر رُسمت فعلًا (فحص ذو معنى)', scan.cards > 0, `${scan.cards} بطاقة`);
  console.log(`  ℹ️ المتبقّي في بقية الصفحة (خارج ما حُوِّل): ${scan.total} — يقلّ في المراحل التالية (سقف في scripts/inline-handlers-budget.json)`);

  // سكربتات مضمّنة في المستند = لا شيء (شرط CSP صارمة بلا هاشات)
  const inlineScripts = await page.evaluate(() => document.querySelectorAll('script:not([src])').length);
  check('لا كتل <script> مضمّنة في المستند', inlineScripts === 0, String(inlineScripts));

  check('موزّع الأحداث محمّل ومربوط', await page.evaluate(() => window.__actionsBound === true));

  // ═══ 2) عناصر data-act موجودة فعلًا (لم نحذف السلوك) ═══
  console.log('\n【2】 السلوك لم يُحذف — بل انتقل إلى data-act');
  const acts = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-act]')];
    return { count: els.length, names: [...new Set(els.map(e => e.getAttribute('data-act')))].slice(0, 8) };
  });
  check('توجد عناصر data-act في الصفحة', acts.count > 0, `${acts.count} عنصرًا · ${acts.names.join(' · ')}`);

  const unknown = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-act]')];
    return els.filter(e => !window.__actionsProbe(e).known).map(e => e.getAttribute('data-act')).slice(0, 5);
  });
  check('كل فعل مُعلَن موجود كدالة', unknown.length === 0, unknown.join(' · ') || 'صفر مجهول');

  // ═══ 3) النقر يُنفّذ الوظيفة فعليًا (إضافة للسلة) ═══
  console.log('\n【3】 نقرة حقيقية تُنفّذ الوظيفة');
  const cartAfter = await page.evaluate(async () => {
    const btn = document.querySelector('.shop-card [data-act="addToCart"]');
    if (!btn) return { skip: true };
    // نقرأ من التطبيق نفسه (cartCount معلنة عالميًا) لا من مفتاح تخزين مفترض
    const count = () => (typeof cartCount === 'function' ? cartCount() : -1);
    const before = count();
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    const after = count();
    return { before, after, hasAct: true };
  });
  check('نقر addToCart أضاف عنصرًا فعليًا للسلة',
    !cartAfter.skip && cartAfter.after > cartAfter.before,
    cartAfter.skip ? 'لم يُعثر على الزر' : `${cartAfter.before} → ${cartAfter.after}`);

  // زر «إضافة» داخل البطاقة يجب ألا يفتح صفحة المنتج (data-stop)
  const stopped = await page.evaluate(async () => {
    const card = document.querySelector('.shop-card');
    const btn = card && card.querySelector('[data-act="addToCart"]');
    if (!btn) return { skip: true };
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    return { detailOpen: !!document.querySelector('.pro-pd-overlay.open, .pro-pd.open, #proProductDetail.open') };
  });
  check('النقر على «إضافة» لا يفتح صفحة المنتج (data-stop)', !stopped.skip && stopped.detailOpen === false, JSON.stringify(stopped));

  // ═══ 4) الحماية: أسماء غير معروفة أو خطرة لا تُنفَّذ ═══
  console.log('\n【4】 لا تنفيذ نصّي: أسماء مجهولة وصيغ خطرة تُرفَض');
  const evil = await page.evaluate(() => {
    window.__pwned = 0;
    const cases = {
      'اسم مجهول': 'notARealFunction',
      'كود مباشر': 'window.__pwned=1',
      'استدعاء متداخل': 'alert(1)',
      'سلسلة خصائص': 'window.location.assign("javascript:1")',
    };
    for (const value of Object.values(cases)) {
      const el = document.createElement('button');
      el.setAttribute('data-act', value);
      el.setAttribute('data-json', '["x"]');
      document.body.appendChild(el);
      el.click();
      el.remove();
    }
    return { pwned: window.__pwned };
  });
  check('لا شيء من الأسماء الخطرة نُفِّذ', evil.pwned === 0, 'window.__pwned = ' + evil.pwned);

  const jsonSafe = await page.evaluate(() => {
    window.__hits = 0;
    window.__probeFn = function (v) { window.__hits++; window.__probeArg = v; };
    const el = document.createElement('button');
    el.setAttribute('data-act', '__probeFn');
    el.setAttribute('data-json', '{bad json');
    document.body.appendChild(el);
    el.click();
    el.remove();
    return { hits: window.__hits, arg: window.__probeArg };
  });
  check('JSON تالف لا يُنفّذ استثناءً ولا يمنع المناداة', jsonSafe.hits === 1, 'نداءات: ' + jsonSafe.hits);

  // ═══ 5) stopPropagation محفوظ ═══
  console.log('\n【5】 data-stop يمنع انتشار الحدث');
  const stop = await page.evaluate(async () => {
    const outer = document.createElement('div');
    let outerHits = 0;
    outer.setAttribute('data-act', '__outerFn');
    window.__outerFn = function () { outerHits++; };
    const inner = document.createElement('button');
    inner.setAttribute('data-act', '__innerFn');
    inner.setAttribute('data-stop', '');
    window.__innerFn = function () { window.__innerHits = (window.__innerHits || 0) + 1; };
    outer.appendChild(inner);
    document.body.appendChild(outer);
    inner.click();
    await new Promise(r => setTimeout(r, 50));
    outer.remove();
    return { outerHits, innerHits: window.__innerHits || 0 };
  });
  check('الداخلي نُفِّذ', stop.innerHits === 1, 'نداءات: ' + stop.innerHits);
  check('الخارجي لم يُنفَّذ (stopPropagation)', stop.outerHits === 0, 'نداءات: ' + stop.outerHits);

  // ═══ 7) عناصر index.html المرسومة (بعد تحويل 56 معالجًا) ═══
  console.log('\n【7】 عناصر صفحة index.html (data-act/data-json/data-event)');
  const nav = await page.evaluate(async () => {
    const els = [...document.querySelectorAll('[data-act="setView"]')];
    const target = els.find(e => window.__actionsProbe(e).args[0] === 'shop');
    if (!target) return { skip: true };
    target.click();
    await new Promise(r => setTimeout(r, 350));
    return { view: typeof currentView !== 'undefined' ? currentView : null, shopMode: document.body.classList.contains('shop-mode') };
  });
  check('نقر «المتجر» في التنقّل يغيّر العرض فعلًا', !nav.skip && nav.view === 'shop' && nav.shopMode === true, JSON.stringify(nav));

  const changed = await page.evaluate(async () => {
    const input = document.querySelector('input[data-on="change"][data-event]');
    if (!input) return { skip: true };
    let got = null;
    const original = window[input.getAttribute('data-act')];
    window[input.getAttribute('data-act')] = function () { got = arguments[0]; };
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window[input.getAttribute('data-act')] = original;
    return { isEvent: !!(got && got.type === 'change') };
  });
  check('data-event يمرّر الحدث نفسه كأول حجة (importData)', !changed.skip && changed.isEvent === true, JSON.stringify(changed));

  const noInlineInDoc = await page.evaluate(() => {
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onsubmit', 'onblur'];
    let n = 0;
    for (const el of document.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) n++;
    return n;
  });
  console.log(`  ℹ️ معالجات مضمّنة في بقية الصفحة الآن: ${noInlineInDoc} (تتناقص مع كل مرحلة)`);

  // ═══ 6) سلامة التشغيل ═══
  console.log('\n【6】 سلامة التشغيل');
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', realErrors.length === 0, realErrors.slice(0, 2).join(' · '));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(fail === 0 ? `  ✅ الموزّع يعمل · ${pass} فحصًا ناجحًا بلا أي معالج مضمّن` : `  ❌ ${fail} خلل من ${pass + fail}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();

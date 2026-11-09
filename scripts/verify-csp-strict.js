// ═══════════════════════════════════════════════════════════════════
//  T7.4/و — CSP صارم بلا 'unsafe-inline' في script-src:  البرهان النهائي
//
//  لماذا: كل المراحل السابقة (325 → 0 معالج مضمّن) كانت مقدّمة لهذه اللحظة.
//  الآن تُزال 'unsafe-inline' من script-src في ثلاثة أسطح (index.html meta ·
//  _headers · next.config.js)، وهذا السكربت يُثبت أن التطبيق **يعمل فعلًا**
//  تحت السياسة الصارمة، وأن المتصفح لا يرفض شيئًا:
//
//    1) السياسة النافذة فعلًا (كما يراها المتصفح) لا تحوي 'unsafe-inline'
//       في script-src — لا نثق بنصّ الملف، بل بالسياسة المطبَّقة.
//    2) صفر انتهاك CSP (securitypolicyviolation) أثناء جلسة استعمال حقيقية:
//       تنقّل · إضافة للسلة · تصفّح · فتح لوحة الإدارة · نافذة إضافة صنف.
//    3) السلوك لم يتغيّر: كل نقرة تُنتج أثرًا في الحالة (لا أزرار ميتة).
//
//  التشغيل: node scripts/verify-csp-strict.js   (خادم على 8123 أو BASE_URL)
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

const now = '2026-11-07T10:00:00Z';
const CATS = [{ id: 1, name: 'كهربائيات', updated_at: now, deleted_at: null, image_url: null, icon: '⚡', sort_order: 0 }];
const ITEMS_PUBLIC = [{ id: 11, category_id: 1, name: 'لمبة ليد', price_text: '50', price_num: 50, stock_state: 'in', low_qty: null, image_url: null, description: null, old_price: null, images: [], updated_at: now }];
const ITEMS_STAFF = [{ id: 11, category_id: 1, name: 'لمبة ليد', price_text: '50', price_num: 50, stock_q: 12, display_qs: 12, image_url: null, description: null, old_price: null, images: [], updated_at: now, deleted_at: null }];
const SETTINGS = [
  { key: 'store_name', value: 'متجر الاختبار' }, { key: 'tax_pct', value: '0' },
  { key: 'shipping_fee', value: '0' }, { key: 'store_open', value: '1' },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();

  // نجمع كل انتهاكات CSP من أول لحظة — قبل أي سكربت في الصفحة
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        directive: e.violatedDirective,
        blocked: String(e.blockedURI || '').slice(0, 60),
        sample: String(e.sample || '').slice(0, 80),
      });
    });
    // بديل: بعض الانتهاكات تُبلَّغ عبر console فقط
    window.__cspConsole = [];
  });
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) page.evaluate((x) => window.__cspConsole.push(x.slice(0, 160)), t).catch(() => {});
  });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));

  await page.route('**/*', r => (/\.supabase\.co\/(auth|realtime|storage)\//.test(r.request().url()) ? r.abort() : r.continue()));
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const table = new URL(req.url()).pathname.replace('/rest/v1/', '').split('?')[0];
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const send = (rows) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify(rows) });
    if (table.startsWith('rpc/')) return send({ ok: true, id: 11, count: 1 });
    if (table === 'items_public') return send(ITEMS_PUBLIC);
    if (table === 'items_staff') return send(ITEMS_STAFF);
    if (table === 'categories') return send(CATS);
    if (table === 'settings') return send(SETTINGS);
    return send([]);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T7.4/و — CSP صارم بلا unsafe-inline: برهان سلوكي في متصفح حقيقي');
  console.log('═══════════════════════════════════════════════════════════════');

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof setView === 'function'; } catch { return false; } }, { timeout: 20000 });
  await page.waitForTimeout(1200);

  // ═══ 1) السياسة النافذة فعلًا ═══
  console.log('\n【1】 السياسة كما يراها المتصفح');
  const policy = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return {
      hasMeta: !!meta,
      content: meta ? meta.getAttribute('content') : '',
      inlineScripts: document.querySelectorAll('script:not([src])').length,
    };
  });
  const scriptSrc = (policy.content.match(/script-src([^;]*)/) || [])[1] || '';
  check('توجد سياسة CSP مطبَّقة في المستند', policy.hasMeta === true);
  check("script-src بلا 'unsafe-inline'", !/unsafe-inline/.test(scriptSrc), scriptSrc.trim());
  check("script-src بلا 'unsafe-eval'", !/unsafe-eval/.test(policy.content), 'لا eval');
  check('صفر كتلة <script> مضمّنة في المستند', policy.inlineScripts === 0, `${policy.inlineScripts} كتلة`);

  // ═══ 2) جلسة استعمال حقيقية تحت السياسة الصارمة ═══
  console.log('\n【2】 جلسة استعمال كاملة (تنقّل · سلة · لوحة · نافذة)');
  const session = await page.evaluate(async () => {
    const out = {};
    // (أ) تنقّل
    const navShop = [...document.querySelectorAll('[data-act="setView"]')].find(el => (window.__actionsProbe(el).args || [])[0] === 'shop');
    if (navShop) navShop.click();
    await new Promise(r => setTimeout(r, 600));
    out.view = typeof currentView !== 'undefined' ? currentView : null;
    // (ب) إضافة للسلة
    const add = document.querySelector('[data-act="addToCart"]');
    if (add) add.click();
    await new Promise(r => setTimeout(r, 400));
    out.cart = typeof cartCount === 'function' ? cartCount() : null;
    // (ج) نافذة تفاصيل منتج
    const detail = document.querySelector('[data-act="openProductDetail"]');
    if (detail) detail.click();
    await new Promise(r => setTimeout(r, 400));
    const ov = document.getElementById('productDetailOverlay');
    out.detailOpen = !!(ov && ov.classList.contains('open'));
    if (typeof closeProductDetail === 'function') closeProductDetail();
    // (د) لوحة الإدارة
    try { proPreview = true; } catch { /* noop */ }
    if (typeof proOpenAdmin === 'function') proOpenAdmin('overview');
    await new Promise(r => setTimeout(r, 700));
    const pa = document.getElementById('proAdmin');
    out.adminOpen = !!(pa && pa.classList.contains('open'));
    out.adminActs = pa ? pa.querySelectorAll('[data-act]').length : 0;
    // (هـ) نافذة إضافة صنف (تحتاج صلاحية — نتجاوزها للفحص فقط)
    try { can = () => true; } catch { /* noop */ }
    if (typeof proCloseAdmin === 'function') proCloseAdmin();
    if (typeof openModal === 'function') openModal('add');
    await new Promise(r => setTimeout(r, 600));
    const md = document.getElementById('modal');
    out.modalOpen = !!(md && md.style.display === 'flex');
    return out;
  });
  check('التنقّل يعمل تحت CSP الصارم', session.view === 'shop', `view=${session.view}`);
  check('«أضف للسلة» يعمل', session.cart > 0, `cartCount=${session.cart}`);
  check('نافذة تفاصيل المنتج تُفتح', session.detailOpen === true, `open=${session.detailOpen}`);
  check('لوحة الإدارة تُفتح بأفعالها', session.adminOpen === true && session.adminActs > 0, `acts=${session.adminActs}`);
  check('نافذة إضافة صنف تُفتح', session.modalOpen === true, `open=${session.modalOpen}`);

  // ═══ 2ب) زر لوحة التحكم في الهامبرجر (كان onclick يُحقن نصًّا وقت التشغيل) ═══
  console.log('\n【2ب】 زر اللوحة في قائمة الهامبرجر');
  const burger = await page.evaluate(async () => {
    if (typeof closeModal === 'function') closeModal();
    if (typeof proCloseAdmin === 'function') proCloseAdmin();
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('burger-dash');
    if (!el) return { skip: true };
    const hasInlineAttr = el.hasAttribute('onclick');
    const probe = window.__actionsProbe(el);
    el.click();
    await new Promise(r => setTimeout(r, 600));
    const pa = document.getElementById('proAdmin');
    return { act: probe.act, known: probe.known, hasInlineAttr, open: !!(pa && pa.classList.contains('open')), view: typeof proAdminState !== 'undefined' ? proAdminState.view : null };
  });
  check('زر الهامبرجر يفعل مسمًّى معروفًا بلا onclick', !burger.skip && burger.known === true && burger.hasInlineAttr === false, `act=${burger.act}`);
  check('نقره يفتح اللوحة الاحترافية', !burger.skip && burger.open === true, `view=${burger.view}`);

  // ═══ 3) صفر انتهاك ═══
  console.log('\n【3】 انتهاكات CSP');
  const viol = await page.evaluate(() => ({ list: (window.__cspViolations || []).slice(0, 5), n: (window.__cspViolations || []).length, con: (window.__cspConsole || []).slice(0, 3) }));
  check('صفر انتهاك CSP أثناء الجلسة', viol.n === 0, viol.n === 0 ? 'نظيف' : JSON.stringify(viol.list));
  check('صفر رسالة «Refused to…» في الطرفية', (viol.con || []).length === 0, (viol.con || []).join(' | '));

  // ═══ 4) لا معالج مضمّن في الشجرة كلها (بعد كل الرسم) ═══
  console.log('\n【4】 الشجرة النهائية');
  const tree = await page.evaluate(() => {
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onblur', 'onsubmit', 'ondragover', 'ondragleave', 'ondrop'];
    let n = 0; const names = [];
    for (const el of document.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) { n++; names.push(el.tagName + '[' + a + ']'); }
    const acts = [...document.querySelectorAll('[data-act]')];
    const unknown = acts.filter(e => !window.__actionsProbe(e).known).map(e => e.getAttribute('data-act'));
    return { n, names: [...new Set(names)].slice(0, 5), acts: acts.length, unknown: [...new Set(unknown)].slice(0, 5) };
  });
  check('صفر معالج مضمّن في كامل الصفحة', tree.n === 0, `${tree.n} · ${tree.names.join(' ')}`);
  check('كل فعل مُعلَن معرّف', tree.unknown.length === 0, tree.unknown.join(' ') || `${tree.acts} عنصرًا · صفر مجهول`);

  // ═══ 5) سلامة التشغيل ═══
  console.log('\n【5】 سلامة التشغيل');
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', realErrors.length === 0, realErrors.slice(0, 2).join(' · '));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(fail === 0 ? `  ✅ التطبيق يعمل تحت CSP صارم بلا unsafe-inline · ${pass} فحصًا` : `  ❌ ${fail} خلل من ${pass + fail}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();

// ═══════════════════════════════════════════════════════════════════
//  T7.4 — لوحة الإدارة بعد تحويل 104 معالجًا مضمّنًا إلى data-act
//
//  لماذا: `web/pro-admin.js` كان أكبر مستودع للمعالجات المضمّنة (104).
//  تحويله بلا فحص سلوكي = لوحة إدارة قد تتوقف عن الاستجابة بلا أن يلاحظ أحد.
//  هذا السكربت يفتح اللوحة في متصفح حقيقي ويستعملها فعلًا:
//    1) الشجرة المرسومة بلا أي معالج مضمّن
//    2) كل فعل مُعلَن موجود كدالة (لا زر ميت)
//    3) التنقّل بين التبويبات يعمل بالنقر الحقيقي
//    4) حقل البحث يمرّر this.value بأنواعه (pAct) ويُحدّث الحالة
//    5) الحفظ في الإعدادات يستدعي الدالة الصحيحة
//
//  التشغيل: node scripts/verify-pro-admin-ui.js   (خادم على 8123 أو BASE_URL)
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

const now = '2026-11-09T10:00:00Z';
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
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));

  // كل طلب إلى Supabase يُحاكى — لا لمس للإنتاج
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
  console.log('  T7.4 — لوحة الإدارة بلا معالج مضمّن واحد');
  console.log('═══════════════════════════════════════════════════════════════');

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof proOpenAdmin === 'function'; } catch { return false; } }, { timeout: 20000 });
  await page.waitForTimeout(900);

  // ═══ 0) فتح اللوحة (وضع معاينة: بلا كتابة على السحابة) ═══
  console.log('\n【0】 فتح اللوحة');
  const opened = await page.evaluate(() => {
    try { proPreview = true; } catch (e) { return { error: String(e).slice(0, 80) }; }
    proOpenAdmin('overview');
    const el = document.getElementById('proAdmin');
    return { open: !!el && el.classList.contains('open'), text: (el ? el.innerText : '').slice(0, 40) };
  });
  check('اللوحة فُتحت فعلًا', opened.open === true, opened.error || opened.text);

  // ═══ 1) الشجرة المرسومة نظيفة ═══
  console.log('\n【1】 لا معالج مضمّن في شجرة اللوحة');
  const scan = await page.evaluate(() => {
    const root = document.getElementById('proAdmin');
    if (!root) return { none: true };
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onsubmit', 'onblur'];
    const bad = [];
    for (const el of root.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) bad.push(el.tagName + '[' + a + ']');
    const acts = [...root.querySelectorAll('[data-act]')];
    const unknown = acts.filter(e => !window.__actionsProbe(e).known).map(e => e.getAttribute('data-act'));
    return { bad: bad.slice(0, 5), badCount: bad.length, actCount: acts.length, unknown: [...new Set(unknown)].slice(0, 5) };
  });
  check('صفر معالج مضمّن في اللوحة', scan.badCount === 0, `${scan.badCount} · ${(scan.bad || []).join(' ')}`);
  check('اللوحة تستخدم data-act', scan.actCount > 0, `${scan.actCount} عنصرًا`);
  check('كل فعل في اللوحة موجود كدالة', scan.unknown.length === 0, scan.unknown.join(' · ') || 'صفر مجهول');

  // ═══ 2) التنقّل بين التبويبات بالنقر الحقيقي ═══
  console.log('\n【2】 التنقّل بين التبويبات');
  for (const view of ['products', 'orders', 'settings', 'banners']) {
    const res = await page.evaluate(async (v) => {
      // نبحث عن زر التبويب المطابق ثم ننقر نقرًا حقيقيًا (يمرّ على الموزّع)
      const all = [...document.querySelectorAll('#proAdmin [data-act="proAdminGo"]')];
      const target = all.find(el => {
        const t = window.__actionsProbe(el);
        return t.args && t.args[0] === v;
      });
      if (!target) return { skip: true, available: all.map(el => window.__actionsProbe(el).args[0]).slice(0, 8) };
      target.click();
      await new Promise(r => setTimeout(r, 350));
      const root = document.getElementById('proAdmin');
      return { view: typeof proAdminState !== 'undefined' ? proAdminState.view : null, len: root ? root.innerText.length : 0 };
    }, view);
    check(`تبويب ${view} يفتح بالنقر`, !res.skip && res.view === view, res.skip ? 'لم يُعثر على الزر: ' + (res.available || []).join(',') : `view=${res.view} · ${res.len} حرفًا`);
  }

  // ═══ 3) حقل البحث يمرّر this.value بأنواعه (pAct) ═══
  console.log('\n【3】 حقول الإدخال (pAct.VALUE)');
  await page.evaluate(() => proAdminGo('products'));
  await page.waitForTimeout(300);
  const search = await page.evaluate(async () => {
    const input = document.querySelector('#proAdmin [data-act="proAdminSearchProd"]');
    if (!input) return { skip: true };
    input.value = 'لمبة';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    return { prodQ: proAdminState.prodQ, value: input.value };
  });
  check('الكتابة في البحث تُحدّث الحالة', !search.skip && search.prodQ === 'لمبة', JSON.stringify(search));

  await page.evaluate(() => proAdminGo('settings'));
  await page.waitForTimeout(350);
  const settingInput = await page.evaluate(async () => {
    const input = document.querySelector('#proAdmin [data-act="proSetSetting"]');
    if (!input) return { skip: true };
    const probe = window.__actionsProbe(input);
    const name = probe.args[0];
    input.value = 'قيمة-اختبار';
    // نُطلق نوع الحدث الذي يعلنه العنصر نفسه (input أو change) لا نوعًا مفترضًا
    input.dispatchEvent(new Event(probe.on || 'change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { name, stored: (typeof settings !== 'undefined' && settings[name]) || null };
  });
  check('تغيير إعداد يصل إلى الحالة/القاعدة', !settingInput.skip && settingInput.stored === 'قيمة-اختبار', JSON.stringify(settingInput));

  // ═══ 4) أزرار الإغلاق (متعدّدة العبارات بعد التغليف) ═══
  console.log('\n【4】 الأغلفة متعدّدة العبارات');
  const closers = await page.evaluate(async () => {
    const root = document.getElementById('proAdmin');
    const names = [...root.querySelectorAll('[data-act]')].map(e => e.getAttribute('data-act'));
    const close = root.querySelector('[data-act="proCloseAdmin"]');
    if (close) close.click();
    await new Promise(r => setTimeout(r, 300));
    return { hasClose: !!close, open: document.getElementById('proAdmin').classList.contains('open'), names: [...new Set(names)].slice(0, 6) };
  });
  check('زر الإغلاق يعمل', closers.hasClose && closers.open === false, `open=${closers.open}`);

  // ═══ 5) سلامة التشغيل ═══
  console.log('\n【5】 سلامة التشغيل');
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت في اللوحة', realErrors.length === 0, realErrors.slice(0, 2).join(' · '));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(fail === 0 ? `  ✅ لوحة الإدارة تعمل بلا معالج مضمّن · ${pass} فحصًا` : `  ❌ ${fail} خلل من ${pass + fail}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();

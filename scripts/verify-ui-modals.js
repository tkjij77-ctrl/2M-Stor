// ═══════════════════════════════════════════════════════════════════
//  T7.4/هـ — web/ui.js بعد تحويل 46 معالجًا مضمّنًا إلى data-act
//
//  لماذا فحص منفصل: معالجات ui.js لم تكن نداءات بسيطة، بل عبارات متعدّدة
//  وأحداث سحب/إفلات وشروطًا على القيمة والمفتاح:
//     onclick="event.stopPropagation();clearImage()"
//     ondragover="event.preventDefault(); this.style…"
//     onkeydown="if(event.key==='Enter'){event.preventDefault();loadImageFromUrl(this.value)}"
//     onblur="if(this.value.trim()) loadImageFromUrl(this.value.trim())"
//  تحويلها الخاطئ = نافذة إضافة/تعديل صنف تتعطّل بهدوء (قلب التطبيق).
//  هذا السكربت يفتح النافذة فعلًا ويستعمل كل واحدة منها في متصفح حقيقي.
//
//  التشغيل: node scripts/verify-ui-modals.js   (خادم على 8123 أو BASE_URL)
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
  console.log('  T7.4/هـ — نوافذ ui.js تعمل بلا معالج مضمّن');
  console.log('═══════════════════════════════════════════════════════════════');

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof openModal === 'function'; } catch { return false; } }, { timeout: 20000 });
  await page.waitForTimeout(900);

  // ═══ 0) نافذة «إضافة صنف» تُرسم نظيفة ═══
  console.log('\n【0】 نافذة إضافة صنف');
  const opened = await page.evaluate(() => {
    try { can = () => true; } catch { /* noop */ }  // نتجاوز الصلاحية للوصول للنافذة
    openModal('add');
    const body = document.getElementById('modalBody');
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onblur', 'ondragover', 'ondragleave', 'ondrop'];
    let inline = 0;
    for (const el of body.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) inline++;
    const acts = [...body.querySelectorAll('[data-act]')];
    const unknown = acts.filter(e => !window.__actionsProbe(e).known).map(e => e.getAttribute('data-act'));
    const m = document.getElementById('modal');
    return { open: !!(m && m.style.display === 'flex'), inline, acts: acts.length, unknown: [...new Set(unknown)] };
  });
  check('النافذة فُتحت', opened.open === true);
  check('صفر معالج مضمّن داخل النافذة', opened.inline === 0, `${opened.inline} · ${opened.acts} عنصر data-act`);
  check('كل فعل في النافذة معرّف', opened.unknown.length === 0, opened.unknown.join(' ') || 'صفر مجهول');

  // ═══ 1) أزرار فتح منتقي الملفات (كانت document.getElementById(x).click()) ═══
  console.log('\n【1】 منتقي الملفات والكاميرا');
  const picker = await page.evaluate(async () => {
    const spy = { scan: 0, image: 0 };
    const s = document.getElementById('scanInput');
    const m = document.getElementById('modal-image');
    if (s) s.click = () => spy.scan++;
    if (m) m.click = () => spy.image++;
    const btnScan = [...document.querySelectorAll('[data-act="openFilePicker"]')].find(e => window.__actionsProbe(e).args[0] === 'scanInput');
    const btnImg = [...document.querySelectorAll('[data-act="openFilePicker"]')].find(e => window.__actionsProbe(e).args[0] === 'modal-image');
    if (btnScan) btnScan.click();
    if (btnImg) btnImg.click();
    await new Promise(r => setTimeout(r, 200));
    return { spy, hasScan: !!btnScan, hasImg: !!btnImg };
  });
  check('زر 📷 يفتح منتقي الملفات الصحيح', picker.hasScan && picker.spy.scan === 1, JSON.stringify(picker.spy));
  check('زر/منطقة اختيار الصورة تفتح input الصورة', picker.hasImg && picker.spy.image >= 1, JSON.stringify(picker.spy));

  // ═══ 2) السحب والإفلات: ondragover/ondragleave/ondrop ═══
  console.log('\n【2】 السحب والإفلات (كانت 3 سمات مضمّنة)');
  const drag = await page.evaluate(async () => {
    const zone = document.getElementById('img-drop');
    if (!zone) return { skip: true };
    let dropped = 0;
    const orig = window.handleDrop;
    window.handleDrop = function () { dropped++; return orig && orig.apply(this, arguments); };
    const probe = window.__actionsProbe(zone);
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    zone.dispatchEvent(over);
    await new Promise(r => setTimeout(r, 120));
    const highlighted = zone.style.borderColor || '';
    const prevented = over.defaultPrevented;
    const leave = new Event('dragleave', { bubbles: true });
    zone.dispatchEvent(leave);
    await new Promise(r => setTimeout(r, 120));
    const reset = zone.style.borderColor || '';
    zone.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 120));
    window.handleDrop = orig;
    const one = document.querySelectorAll('#img-drop[data-act]').length;
    return { highlighted, prevented, reset, dropped, act: probe.act, on: probe.on, one };
  });
  check('ondragover يُلوّن + يمنع السلوك الافتراضي', !drag.skip && drag.highlighted === 'var(--primary)' && drag.prevented === true, JSON.stringify(drag));
  check('ondragleave يُرجع اللون', !drag.skip && drag.reset === 'var(--border)', drag.reset);
  check('ondrop يصل إلى handleDrop', !drag.skip && drag.dropped === 1, `نداءات: ${drag.dropped}`);
  check('عنصر الإسقاط يحمل فعلًا واحدًا لأربعة أحداث', !drag.skip && drag.act === 'imgDropZone' && /drop/.test(drag.on || '') && drag.one === 1, `act=${drag.act} on=${drag.on}`);

  // ═══ 3) رابط الصورة: onblur بشرط غير فارغ + Enter ═══
  console.log('\n【3】 حقل رابط الصورة (blur بشرط + Enter)');
  const urlField = await page.evaluate(async () => {
    const input = document.getElementById('modal-image-url');
    if (!input) return { skip: true };
    const calls = [];
    window.loadImageFromUrl = function (v) { calls.push(v); };
    input.value = '   ';
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const emptyCalls = calls.length;
    input.value = 'https://example.com/a.jpg';
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const filledCalls = calls.length;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 120));
    return { skip: false, emptyCalls, filledCalls, afterEnter: calls.length, prevented: ev.defaultPrevented, last: calls[calls.length - 1], hasNonEmpty: input.hasAttribute('data-nonempty') };
  });
  check('blur على قيمة فارغة لا يستدعي loadImageFromUrl', !urlField.skip && urlField.emptyCalls === 0, `نداءات: ${urlField.emptyCalls}`);
  check('blur على قيمة صالحة يستدعيها بالقيمة', !urlField.skip && urlField.filledCalls === 1 && urlField.last === 'https://example.com/a.jpg', JSON.stringify(urlField.last));
  check('Enter يستدعيها ويمنع السلوك الافتراضي', !urlField.skip && urlField.afterEnter === 2 && urlField.prevented === true, JSON.stringify({ n: urlField.afterEnter, prevented: urlField.prevented }));

  // ═══ 4) oninput="this.dataset.manual='1'" ═══
  console.log('\n【4】 السعر الرقمي اليدوي (markManual)');
  const manual = await page.evaluate(async () => {
    const pn = document.getElementById('modal-pn');
    if (!pn) return { skip: true };
    pn.value = '77';
    pn.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { manual: pn.dataset.manual, price: document.getElementById('modal-price') && document.getElementById('modal-price').value };
  });
  check('الكتابة في السعر الرقمي تُعلّمه كيدوي', !manual.skip && manual.manual === '1', JSON.stringify(manual));

  // ═══ 5) الأزرار المفردة: syncNumericPrice + closeModal ═══
  console.log('\n【5】 الأزرار المفردة');
  const singles = await page.evaluate(async () => {
    const pnEl = document.getElementById('modal-pn');
    if (pnEl) delete pnEl.dataset.manual;      // أثر الفحص السابق يمنع التحديث
    const price = document.getElementById('modal-price');
    let synced = 0;
    const orig = window.syncNumericPrice;
    window.syncNumericPrice = function () { synced++; return orig && orig.apply(this, arguments); };
    if (price) { price.value = '120'; price.dispatchEvent(new Event('input', { bubbles: true })); }
    await new Promise(r => setTimeout(r, 150));
    const pn = document.getElementById('modal-pn');
    const pnVal = pn ? pn.value : null;
    window.syncNumericPrice = orig;
    const closeBtn = document.querySelector('#modalBody [data-act="closeModal"]');
    if (closeBtn) closeBtn.click();
    await new Promise(r => setTimeout(r, 250));
    const mm = document.getElementById('modal');
    return { synced, pnVal, closed: !!(mm && mm.style.display === 'none') };
  });
  check('كتابة السعر تُحدّث السعر الرقمي', singles.synced >= 1 && singles.pnVal === '120', JSON.stringify(singles));
  check('زر «إلغاء» يُغلق النافذة', singles.closed === true, `closed=${singles.closed}`);

  // ═══ 6) نافذة المزامنة/السلة (أغلفة متعدّدة العبارات) ═══
  console.log('\n【6】 أغلفة المزامنة والسلة (متعدّدة العبارات)');
  const syncRes = await page.evaluate(async () => {
    const out = {};
    out.hasFlush = typeof flushOutboxNow === 'function';
    out.hasRetry = typeof retryFailedOpsSync === 'function';
    out.hasClear = typeof clearFailedOpsSync === 'function';
    out.hasSettings = typeof closeModalOpenSettings === 'function';
    try { openSyncStatus(); } catch (e) { out.err = String(e).slice(0, 80); }
    await new Promise(r => setTimeout(r, 300));
    const body = document.getElementById('modalBody');
    const mm = document.getElementById('modal');
    out.open = !!(mm && mm.style.display === 'flex');
    const attrs = ['onclick', 'oninput', 'onchange', 'onkeydown'];
    let inline = 0;
    for (const el of body.querySelectorAll('*')) for (const a of attrs) if (el.hasAttribute(a)) inline++;
    out.inline = inline;
    out.acts = [...new Set([...body.querySelectorAll('[data-act]')].map(e => e.getAttribute('data-act')))].slice(0, 8);
    return out;
  });
  check('أغلفة الأحداث المتعدّدة موجودة', syncRes.hasFlush && syncRes.hasRetry && syncRes.hasClear && syncRes.hasSettings, JSON.stringify(syncRes));
  check('نافذة المزامنة تُرسم بلا معالج مضمّن', syncRes.open === true && syncRes.inline === 0, `open=${syncRes.open} inline=${syncRes.inline} · ${(syncRes.acts || []).join(',')}`);

  // ═══ 8) حقول الدخول: Enter يعمل (فعل واحد بحدثين لا سمتين متكرّرتين) ═══
  console.log('\n【8】 حقل الدخول — Enter');
  const login = await page.evaluate(async () => {
    const r = {};
    if (typeof closeModal === 'function') closeModal();
    if (typeof showLogin === 'function') showLogin();
    await new Promise(r2 => setTimeout(r2, 400));
    const pass = document.getElementById('cl-pass');
    if (!pass) return { skip: true };
    const probe = window.__actionsProbe(pass);
    let called = 0;
    const orig = window.cloudDoLogin;
    window.cloudDoLogin = function () { called++; };
    pass.value = 'secret123';
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r2 => setTimeout(r2, 120));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    pass.dispatchEvent(ev);
    await new Promise(r2 => setTimeout(r2, 150));
    window.cloudDoLogin = orig;
    const attrs = [...pass.attributes].filter(a => a.name === 'data-act').length;
    r.act = probe.act; r.on = probe.on; r.called = called; r.prevented = ev.defaultPrevented; r.dup = attrs;
    return r;
  });
  check('Enter في كلمة المرور يستدعي cloudDoLogin', !login.skip && login.called === 1, JSON.stringify(login));
  check('حقل الدخول فعل واحد (لا data-act مكرّر)', !login.skip && login.act === 'cloudLoginField' && login.dup === 1, `act=${login.act} dup=${login.dup} on=${login.on}`);

  // ═══ 7) سلامة التشغيل ═══
  console.log('\n【7】 سلامة التشغيل');
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', realErrors.length === 0, realErrors.slice(0, 2).join(' · '));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(fail === 0 ? `  ✅ نوافذ ui.js سليمة بلا معالج مضمّن · ${pass} فحصًا` : `  ❌ ${fail} خلل من ${pass + fail}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();

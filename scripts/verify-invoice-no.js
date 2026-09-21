// ═══════════════════════════════════════════════════════════════════
//  T3.1 — ترقيم الفواتير على السيرفر (اختبار متصفح حقيقي)
//
//  الثغرة D1: الرقم كان محليًا في كل جهاز (al_sayed_invno) ⇒ جهازان
//  يُنتجان «فاتورة #7» — إما تصادم يُفشل الرفع أو رقمان مكرّران على ورق
//  عميلين. الحل: تسلسل مركزي + دالة next_invoice_no + trigger يمنع الفشل.
//
//  ما نتحقق منه:
//   1) مع اتصال: الرقم يأتي من دالة السيرفر (تُستدعى فعلًا)
//   2) بلا اتصال: رقم مؤقت واضح، والبيع لا يفشل
//   3) البيع المتتالي بلا اتصال لا يُكرّر الرقم على نفس الجهاز
//   4) الرقم يظهر للعميل في السجل مُصيَّرًا (#0042)
//   5) تصادم جهازين: السيرفر يُسند رقمًا بديلًا عند الرفع فيُثبَّت محليًا
//
//  كل طلبات السحابة محاكاة محليًا — لا يُلمس أي بيانات حقيقية.
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const SEED = [{
  name: 'قسم الاختبار', lid: 'Lc1', cid: 1, items: [
    { n: 'منتج أ', p: '60', pn: 60, q: 100, qs: 100, min: 2, b: '', img: '', lid: 'La', cid: 101 }
  ]
}];

const OFFICIAL = 42;            // الرقم الذي «يُعيده السيرفر» (صغير لنفحص التصيير 0042)
const SERVER_RENUMBER = 5000;   // الرقم البديل إن كان الرقم المحلي محجوزًا

let rpcCalls = 0;               // كم مرة استُدعيت دالة الترقيم فعلًا
let insertCalls = 0;            // كم مرة حاول التطبيق إدراج فاتورة
let rpcDown = false;            // تعطيل دالة الترقيم = وضع «بلا اتصال»
let collidingNo = -1;           // الرقم الذي سنعتبره محجوزًا على جهاز آخر

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  page.on('dialog', d => d.accept());

  // ── محاكي السحابة: نُجيب على ما يحتاجه التطبيق فعلًا ──
  await page.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (!url.includes('supabase.co')) return route.continue();

    // قلب T3.1 — دالة الرقم الرسمي
    if (url.includes('/rest/v1/rpc/next_invoice_no')) {
      if (rpcDown) return route.abort();
      rpcCalls++;
      return json(OFFICIAL);
    }

    // إدراج فاتورة: الرقم «المحجوز» يُستبدل برقم السيرفر، وغيره يبقى كما هو
    if (url.includes('/rest/v1/invoices') && method === 'POST') {
      insertCalls++;
      const sent = (req.postDataJSON() || {}).invoice_no;
      const assigned = sent === collidingNo ? SERVER_RENUMBER : sent;
      const row = { id: 100 + insertCalls, invoice_no: assigned };
      const wantsSingle = String(req.headers()['accept'] || '').includes('pgrst.object');
      return json(wantsSingle ? row : [row], 201);
    }

    // فحص «هل الفاتورة موجودة؟» قبل الإدراج (منع التكرار)
    if (url.includes('/rest/v1/invoices') && method === 'GET') return json(null);
    if (url.includes('/rest/v1/invoice_items')) return json([], 201);

    // بقية القراءات (أصناف · أقسام · إعدادات): نحجبها ليحتفظ التطبيق
    // ببياناته المحلية — نفس أسلوب بقية الاختبارات (لا نلمس بيانات المحل)
    return route.abort();
  });

  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_session_user', 'admin');
    localStorage.setItem('al_sayed_cloud', JSON.stringify({
      url: 'https://test-shop.supabase.co', key: 'test-anon-key', on: true,
    }));
  }, SEED);

  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    setUser({ u: 'admin', role: 'admin', name: 'مدير النظام' });
    settings.stockMode = 'off';
    saveSettings();
    initCloudClient();
  });

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  // يبيع قطعة ويُعيد أحدث فاتورة
  const sell = (qty) => page.evaluate(async (q) => {
    invoiceCart = [];
    addToCart(0, 0);
    invoiceCart[0].qty = q;
    createInvoiceFromCart();
    await confirmSaveInvoice();
    const inv = invoices[invoices.length - 1];
    return { no: inv.no, noTemp: !!inv.noTemp, count: invoices.length };
  }, qty);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T3.1 — رقم الفاتورة الرسمي من السيرفر (متصفح حقيقي)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ═══ 1) مع اتصال ═══
  console.log('\n【1】 مع اتصال — الرقم من دالة السيرفر');
  const online = await sell(1);
  check('دالة next_invoice_no استُدعيت فعلًا', rpcCalls === 1, `${rpcCalls} استدعاء`);
  check('الفاتورة أخذت الرقم الرسمي لا المحلي', online.no === OFFICIAL, `#${online.no}`);
  check('لم تُوسم كرقم مؤقت', online.noTemp === false);

  // ═══ 2) بلا اتصال ═══
  console.log('\n【2】 بلا اتصال — رقم مؤقت بدل فشل البيع');
  rpcDown = true;
  const off1 = await sell(2);
  const off2 = await sell(1);
  check('البيع نجح رغم تعذّر الوصول للسيرفر', off1.count === 2 && off2.count === 3);
  check('وُسم برقم مؤقت (noTemp)', off1.noTemp === true, `#${off1.no}`);
  check('الرقم المحلي يتبع الرقم الرسمي (42 ← 43)', off1.no === OFFICIAL + 1, `#${off1.no}`);
  check('فاتورة تالية: رقم مختلف (لا تكرار على نفس الجهاز)', off2.no !== off1.no, `#${off1.no} ثم #${off2.no}`);

  // ═══ 3) ما يراه المستخدم ═══
  console.log('\n【3】 ما يراه المستخدم');
  const history = await page.evaluate(() => {
    showInvoiceHistory();
    const txt = document.getElementById('modalBody').innerText;
    closeModal();
    return txt;
  });
  check('سجل الفواتير يعرض الرقم الرسمي مُصيَّرًا #0042', history.includes('0042'));
  check('الفاتورة المؤقتة تظهر برقمها', new RegExp('#0*' + off2.no).test(history), `#${off2.no}`);

  // ═══ 4) تصادم جهازين ═══
  console.log('\n【4】 تصادم بين جهازين — السيرفر يصحّح الرقم عند الرفع');
  collidingNo = off1.no;                     // نعتبر رقم الفاتورة المؤقتة محجوزًا على جهاز آخر
  const after = await page.evaluate(async () => {
    const qBefore = (typeof outbox !== 'undefined' && outbox.length) || 0;
    await flushOutbox();
    const qAfter = (typeof outbox !== 'undefined' && outbox.length) || 0;
    return {
      inv: invoices.map(i => ({ no: i.no, temp: !!i.noTemp })),
      qBefore, qAfter,
    };
  });
  console.log(`  ℹ️ الطابور قبل/بعد الرفع: ${after.qBefore} / ${after.qAfter} · محاولات إدراج: ${insertCalls}`);
  check('كل الفواتير رُفعت (الطابور فُرِّغ)', after.qAfter === 0, `${after.qBefore} → ${after.qAfter}`);
  check('الفاتورة المحجوزة أخذت رقم السيرفر', after.inv.some(i => i.no === SERVER_RENUMBER),
        `#${SERVER_RENUMBER} · الحالة: ${JSON.stringify(after.inv)}`);
  check('الرقم الذي لم يتصادم بقي كما هو', after.inv.some(i => i.no === off2.no), `#${off2.no}`);
  check('لا فاتورة موسومة كرقم مؤقت بعد الرفع', after.inv.every(i => i.temp === false),
        JSON.stringify(after.inv));

  // ═══ 5) سلامة ═══
  console.log('\n【5】 سلامة');
  const real = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', real.length === 0, real.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ نجحت كل فحوص ترقيم الفواتير' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

// ═══════════════════════════════════════════════════════════════════
//  T3.3 — اختبار خصم المخزون واسترجاعه في متصفح حقيقي
//  يتحقق من: خصم البيع · استرجاع الإلغاء · استرجاع الحذف · منع البيع بلا رصيد
//            · سلوك الأوضاع الثلاثة (both / display / off)
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const SEED = [{
  name: "قسم الاختبار", lid: "Lc1", cid: 1, items: [
    { n: "منتج أ", p: "60", pn: 60, q: 10, qs: 10, min: 2, b: "", img: "", lid: "La", cid: 101 },
    { n: "منتج ب", p: "50", pn: 50, q: 5,  qs: 5,  min: 2, b: "", img: "", lid: "Lb", cid: 102 }
  ]
}];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  page.on('dialog', d => d.accept());                       // نعتمد تأكيدات الحوار
  await page.route('**/*', r => r.request().url().includes('supabase.co') ? r.abort() : r.continue());

  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_session_user', 'admin');
  }, SEED);

  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  // ☁️ T-A4 (2026-09-22): التطبيق لم يعد يقرأ قاعدة بيانات محلية مضمَّنة/محفوظة —
  // السحابة هي المصدر الوحيد. لذلك نُهيّئ البيانات للاختبار بحقنها في `db` الحيّة.
  await page.evaluate((seed) => {
    db = JSON.parse(JSON.stringify(seed));
    try { if (typeof ensureLids === 'function') ensureLids(); } catch { /* تجاهل */ }
    try { if (typeof renderAll === 'function') renderAll(); } catch { /* تجاهل */ }
  }, SEED);
  await page.waitForTimeout(600);

  await page.evaluate(() => setUser({ u: 'admin', role: 'admin', name: 'مدير النظام' }));

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T3.3 — خصم المخزون الفعلي (متصفح حقيقي)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── التهيئة: نضع الإعدادات الافتراضية المعروفة ──
  await page.evaluate(async () => { settings.stockMode = 'both'; settings.oversell = 'warn'; saveSettings(); });

  // ═══ 1) البيع يخصم المخزن والمعروض معًا ═══
  let r = await page.evaluate(async () => {
    invoiceCart = [];
    addToCart(0, 0);                       // منتج أ
    invoiceCart[0].qty = 3;
    const before = { q: getQ(db[0].items[0]), qs: getQs(db[0].items[0]) };
    createInvoiceFromCart();
    await confirmSaveInvoice();
    const it = db[0].items[0];
    return { before, after: { q: getQ(it), qs: getQs(it) }, invNo: invoices[0].no,
             stockApplied: invoices[0].stockApplied, lines: invoices[0].items.length,
             lineLid: invoices[0].items[0].lid || null };
  });
  check('بيع 3 قطع يخصم المخزن (10 → 7)', r.before.q === 10 && r.after.q === 7, `${r.before.q} → ${r.after.q}`);
  check('وبخصم المعروض أيضًا (10 → 7)', r.before.qs === 10 && r.after.qs === 7, `${r.before.qs} → ${r.after.qs}`);
  check('سطر الفاتورة يحفظ معرّف الصنف (للاسترجاع الدقيق)', r.lineLid === 'La', `lid=${r.lineLid}`);
  check('الفاتورة مُعلَّمة بأن المخزون مخصوم', r.stockApplied === 'both', `stockApplied=${r.stockApplied}`);

  // ═══ 2) الإلغاء يُرجّع الكميات ═══
  r = await page.evaluate(async () => {
    const inv = invoices[0];
    updateOrderStatus(0, 'ملغي');
    const it = db[0].items[0];
    return { status: inv.status, q: getQ(it), qs: getQs(it), stockApplied: inv.stockApplied };
  });
  check('إلغاء الطلب يُرجّع المخزن (7 → 10)', r.q === 10, `q=${r.q}`);
  check('ويُرجّع المعروض (7 → 10)', r.qs === 10, `qs=${r.qs}`);

  // ═══ 3) إعادة التنشيط تخصم مرة أخرى (بلا خصم مزدوج) ═══
  r = await page.evaluate(async () => {
    updateOrderStatus(0, 'قيد المعالجة');
    const it = db[0].items[0];
    const afterReactivate = { q: getQ(it), qs: getQs(it) };
    // محاولة تغيير لنفس الحالة — لا يجب أن تخصم مرة أخرى
    updateOrderStatus(0, 'قيد المعالجة');
    return { afterReactivate, afterNoop: { q: getQ(it), qs: getQs(it) } };
  });
  check('إعادة التنشيط تخصم مرة واحدة فقط', r.afterReactivate.q === 7 && r.afterNoop.q === 7,
    `q=${r.afterReactivate.q} ثم ${r.afterNoop.q}`);
  check('لا خصم مزدوج عند تكرار نفس الحالة', r.afterNoop.qs === 7, `qs=${r.afterNoop.qs}`);

  // ═══ 4) تم التوصيل ثم الحذف → استرجاع + تراجع ═══
  r = await page.evaluate(async () => {
    updateOrderStatus(0, 'تم التوصيل');
    const it = db[0].items[0];
    const delivered = { q: getQ(it) };
    deleteInvoice(0);
    const afterDelete = { q: getQ(it), invoices: invoices.length };
    return { delivered, afterDelete };
  });
  check('حذف فاتورة مُسلَّمة يُرجّع الكميات (7 → 10)', r.afterDelete.q === 10, `q=${r.afterDelete.q}`);

  r = await page.evaluate(async () => {
    lastUndo();                            // التراجع عن الحذف
    const it = db[0].items[0];
    return { q: getQ(it), invoices: invoices.length, status: invoices[0] && invoices[0].status };
  });
  check('التراجع عن الحذف يعيد خصم الكميات', r.q === 7 && r.invoices === 1, `q=${r.q} · فواتير ${r.invoices}`);

  // ═══ 5) منع البيع بلا رصيد ═══
  r = await page.evaluate(async () => {
    settings.oversell = 'block'; saveSettings();
    invoiceCart = [];
    addToCart(0, 1);                       // منتج ب (المتاح 5)
    invoiceCart[0].qty = 99;
    const before = invoices.length;
    createInvoiceFromCart();
    const blocked = invoices.length === before && !pendingInvoice;
    settings.oversell = 'warn'; saveSettings();
    return { blocked, pending: !!pendingInvoice };
  });
  check('وضع «منع»: لا تُنشأ فاتورة برصيد غير كافٍ', r.blocked && !r.pending, `pending=${r.pending}`);

  r = await page.evaluate(async () => {
    invoiceCart = [];
    addToCart(0, 1);
    invoiceCart[0].qty = 99;
    createInvoiceFromCart();               // warn → تُنشأ مع تنبيه
    return { pending: !!pendingInvoice };
  });
  check('وضع «تنبيه»: تُنشأ الفاتورة مع تحذير', r.pending === true, `pending=${r.pending}`);

  // ═══ 6) الوضع display: يخصم المعروض فقط (السلوك القديم) ═══
  r = await page.evaluate(async () => {
    settings.stockMode = 'display'; saveSettings();
    invoiceCart = []; pendingInvoice = null;
    addToCart(0, 0);
    invoiceCart[0].qty = 2;
    const it = db[0].items[0];
    const before = { q: getQ(it), qs: getQs(it) };
    createInvoiceFromCart();
    await confirmSaveInvoice();
    return { before, q: getQ(it), qs: getQs(it) };
  });
  check('وضع «المعروض فقط»: المخزن لا يتغير', r.q === r.before.q, `q ${r.before.q} → ${r.q} (ثابت)`);
  check('والمعروض يُخصم بمقدار البيع', r.qs === r.before.qs - 2, `qs ${r.before.qs} → ${r.qs}`);

  // ═══ 7) الوضع off: لا خصم إطلاقًا ═══
  r = await page.evaluate(async () => {
    settings.stockMode = 'off'; saveSettings();
    invoiceCart = []; pendingInvoice = null;
    addToCart(0, 1);
    invoiceCart[0].qty = 1;
    const it = db[0].items[1];
    const before = { q: getQ(it), qs: getQs(it) };
    createInvoiceFromCart();
    await confirmSaveInvoice();
    return { before, q: getQ(it), qs: getQs(it), applied: invoices[invoices.length - 1].stockApplied };
  });
  check('وضع «لا تخصم»: المخزون ثابت تمامًا',
    r.q === r.before.q && r.qs === r.before.qs, `q ${r.before.q}→${r.q} · qs ${r.before.qs}→${r.qs}`);
  check('وتُعلَّم الفاتورة بأنها لم تخصم', r.applied === false, `stockApplied=${r.applied}`);

  // ═══ 8) الأصناف القديمة (بلا lid) تُطابَق بالاسم ═══
  r = await page.evaluate(async () => {
    settings.stockMode = 'both'; saveSettings();
    // فاتورة قديمة: بلا lid — كما في البيانات الموجودة فعلًا
    const legacy = { no: 9999, lid: 'Lold', cid: null, status: 'تم التوصيل', stockApplied: 'both',
      items: [{ name: 'منتج أ', cat: 'قسم الاختبار', qty: 1, price: 60 }] };
    const before = getQ(db[0].items[0]);
    invoices.push(legacy);
    syncStockForStatus(legacy, 'تم التوصيل', 'ملغي');
    const after = getQ(db[0].items[0]);
    return { before, after };
  });
  check('فاتورة قديمة بلا معرّف تُطابَق بالاسم وتُسترجع', r.after === r.before + 1, `${r.before} → ${r.after}`);

  // ═══ 9) الأمان: الجرد لا يصير سالبًا ═══
  r = await page.evaluate(async () => {
    const it = db[0].items[0];
    it.q = 1; it.qs = 1;
    const inv = { no: 8888, lid: 'Lneg', status: 'قيد المعالجة', items: [{ name: 'منتج أ', cat: 'قسم الاختبار', qty: 50, price: 60, lid: 'La' }] };
    applyStockForInvoice(inv, +1);
    return { q: getQ(it), qs: getQs(it) };
  });
  check('🔒 الكمية لا تنزل تحت الصفر أبدًا', r.q === 0 && r.qs === 0, `q=${r.q} · qs=${r.qs}`);

  const realErrors = errors.filter(e => !/ERR_FAILED|401|404|Failed to load resource/.test(e));
  check('لا أخطاء جافاسكربت', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ نجحت كل فحوص خصم المخزون' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

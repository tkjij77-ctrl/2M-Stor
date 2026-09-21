// ═══════════════════════════════════════════════════════════════════
//  اختبار الميزات الجديدة (T3.4 + T3.5) في متصفح حقيقي
//  يشغّل التطبيق المُصلَّح ويتحقق من: الشحن من الإعدادات · الحذف الناعم · سلة المحذوفات
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const SEED = [{
  name: "قسم الاختبار", lid: "Lc1", cid: 1, items: [
    { n: "منتج أ", p: "60", pn: 60, q: 10, qs: 10, min: 2, b: "", img: "", lid: "La", cid: 101 },
    { n: "منتج ب", p: "50", pn: 50, q: 10, qs: 10, min: 2, b: "", img: "", lid: "Lb", cid: 102 },
    { n: "منتج ج", p: "200", pn: 200, q: 5, qs: 5, min: 2, b: "", img: "", lid: "Lc", cid: 103 }
  ]
}];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 150)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text().slice(0, 150)); });

  // لا نلمس قاعدة بيانات المحل — نحجب Supabase (نختبر المسار المحلي)
  await page.route('**/*', r => r.request().url().includes('supabase.co') ? r.abort() : r.continue());

  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_session_user', 'admin');
    localStorage.setItem('al_sayed_settings', JSON.stringify({ store: 'X', tax: 0, shipping: 20, freeShip: 200, couponCode: 'SAVE10', couponPct: 10 }));
  }, SEED);

  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // الجلسة في الكود لا تُستعاد من localStorage وحدها — نضبطها صراحةً
  await page.evaluate(() => { setUser({ u: 'admin', role: 'admin', name: 'مدير النظام' }); });
  const roleOk = await page.evaluate(() => sessionRole);
  if (roleOk !== 'admin') { console.log('❌ تعذّر ضبط الدور:', roleOk); process.exit(1); }

  const out = [];
  const line = s => { out.push(s); console.log(s); };
  const check = (name, pass, detail) => {
    line(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    return pass;
  };

  line('\n═══════════════════════════════════════════════════════════════');
  line('  اختبار الميزات الجديدة (T3.4 + T3.5) — متصفح حقيقي');
  line('═══════════════════════════════════════════════════════════════');

  let allPass = true;

  // ═══════════ T3.5: قواعد البيع من الإعدادات ═══════════
  line('\n【T3.5】 قواعد الشحن والكوبون من الإعدادات');

  // سيناريو 1: شحن 20، شحن مجاني فوق 200 → سلة 60 + 50 = 110 → شحن 20
  let r = await page.evaluate(() => {
    invoiceCart = [];
    addToCart(0, 0);   // 60
    addToCart(0, 1);   // 50  → المجموع الفرعي 110
    openCart();
    const t = cartTotals();
    return { subtotal: t.subtotal, shipping: t.shipping, total: t.total,
             shipText: (document.getElementById('cart-shipping') || {}).textContent,
             settings: { shipping: settings.shipping, freeShip: settings.freeShip } };
  });
  allPass &= check('الشحن من الإعدادات (110 ج.م < 200 → شحن 20)',
    r.subtotal === 110 && r.shipping === 20 && r.total === 130,
    `فرعي ${r.subtotal} · شحن ${r.shipping} · إجمالي ${r.total}`);

  // سيناريو 2: نغيّر الإعدادات → الشحن يصبح 45 والإعفاء فوق 100 → شحن مجاني
  r = await page.evaluate(() => {
    settings.shipping = 45; settings.freeShip = 100; saveSettings();
    renderCart();
    const t = cartTotals();
    return { subtotal: t.subtotal, shipping: t.shipping, total: t.total };
  });
  allPass &= check('تغيير الإعدادات يغيّر الحساب فورًا (110 ≥ 100 → شحن مجاني)',
    r.shipping === 0 && r.total === 110,
    `شحن ${r.shipping} · إجمالي ${r.total}`);

  // سيناريو 3: إعفاء 0 = لا يوجد إعفاء
  r = await page.evaluate(() => {
    settings.freeShip = 0; saveSettings(); renderCart();
    const t = cartTotals();
    return { shipping: t.shipping, total: t.total };
  });
  allPass &= check('إعفاء = 0 يعني دائمًا شحن (45 ج.م)',
    r.shipping === 45 && r.total === 155, `شحن ${r.shipping} · إجمالي ${r.total}`);

  // سيناريو 4: الكوبون من الإعدادات (SAVE10 = 10%)
  r = await page.evaluate(() => {
    settings.freeShip = 200; saveSettings(); renderCart();
    const inp = document.getElementById('couponCode');
    const placeholder = inp ? inp.placeholder : '';
    if (inp) { inp.value = 'SAVE10'; applyCoupon(); renderCart(); }
    const t = cartTotals();
    return { discount: t.discount, total: t.total, placeholder };
  });
  allPass &= check('كوبون مخصص من الإعدادات (SAVE10 = 10% من 110 = 11)',
    Math.abs(r.discount - 11) < 0.01, `الخصم ${r.discount} · الإجمالي ${r.total}`);
  allPass &= check('حقل الكوبون يعرض الكود من الإعدادات لا 2M10 المكتوب',
    r.placeholder.includes('SAVE10'), `placeholder: "${r.placeholder}"`);

  // سيناريو 5: تعطيل الكوبون
  r = await page.evaluate(() => {
    settings.couponCode = ''; saveSettings();
    localStorage.removeItem('al_sayed_coupon');
    renderCart();
    const t = cartTotals();
    const inp = document.getElementById('couponCode');
    return { discount: t.discount, ph: inp ? inp.placeholder : '' };
  });
  allPass &= check('إفراغ كود الخصم = لا يوجد كوبون', r.discount === 0, `الخصم ${r.discount} · "${r.ph}"`);

  // ═══════════ T3.4: الحذف الناعم + سلة المحذوفات ═══════════
  line('\n【T3.4】 الحذف الناعم وسلة المحذوفات');

  r = await page.evaluate(() => {
    const before = db[0].items.length;
    editingCat = 0; editingIdx = 1;          // منتج ب
    deleteItem();
    return { before, after: db[0].items.length,
             trash: JSON.parse(localStorage.getItem('al_sayed_trash') || '[]').map(x => ({ type: x.type, name: x.name, hasSnapshot: !!x.snapshot })) };
  });
  allPass &= check('حذف صنف يُنقص العدّاد', r.after === r.before - 1, `${r.before} → ${r.after}`);
  allPass &= check('الصنف المحذوف مسجَّل في سلة المحذوفات بنسخة كاملة',
    r.trash.length === 1 && r.trash[0].type === 'item' && r.trash[0].name === 'منتج ب' && r.trash[0].hasSnapshot,
    JSON.stringify(r.trash));

  // الواجهة
  r = await page.evaluate(async () => {
    await openTrash();
    await new Promise(s => setTimeout(s, 400));
    const body = document.getElementById('modalBody');
    return { text: (body ? body.innerText : '').slice(0, 300),
             hasRestoreBtn: !!(body && body.querySelector('button[onclick*="restoreLocalTrash"]')),
             hasPurgeBtn: !!(body && body.querySelector('button[onclick*="purgeLocalTrash"]')) };
  });
  allPass &= check('سلة المحذوفات تُفتح وتعرض العنصر',
    r.text.includes('منتج ب') && r.hasRestoreBtn && r.hasPurgeBtn,
    r.hasRestoreBtn ? 'زر استعادة + زر حذف نهائي موجودان' : 'الأزرار مفقودة!');

  // الاستعادة
  r = await page.evaluate(() => {
    restoreLocalTrash('Lb');
    return { count: db[0].items.length, names: db[0].items.map(i => i.n),
             trash: JSON.parse(localStorage.getItem('al_sayed_trash') || '[]').length };
  });
  allPass &= check('الاستعادة تُرجع الصنف بكل بياناته',
    r.count === 3 && r.names.includes('منتج ب') && r.trash === 0,
    `${r.names.join(' · ')} · السلة الآن ${r.trash}`);

  // حذف قسم — الأهم: كان يمحو الأصناف
  r = await page.evaluate(() => {
    db.push({ name: 'قسم مؤقت', lid: 'Ltmp', cid: null, items: [
      { n: 'صنف داخل القسم', p: '10', pn: 10, q: 1, qs: 1, min: 1, b: '', img: '', lid: 'Lt1', cid: null }] });
    const idx = db.length - 1;
    deleteCategory(idx);
    const trash = JSON.parse(localStorage.getItem('al_sayed_trash') || '[]');
    const catRec = trash.find(x => x.type === 'cat');
    return { hasCat: !!catRec, snapshotItems: catRec && catRec.snapshot ? (catRec.snapshot.items || []).length : 0,
             dbCats: db.length };
  });
  allPass &= check('حذف قسم يحفظ نسخته كاملة مع أصنافه (كان محوًا نهائيًا)',
    r.hasCat && r.snapshotItems === 1, `أصناف محفوظة: ${r.snapshotItems}`);

  // استعادة القسم — الخاصية المهمة: لا يضيع صنف ولا يتكرّر
  r = await page.evaluate(() => {
    const before = db.flatMap(c => (c.items || []).map(i => i.n)).sort();
    restoreLocalTrash('Ltmp');
    const after = db.flatMap(c => (c.items || []).map(i => i.n)).sort();
    const restored = db.find(c => c.lid === 'Ltmp');
    // الصنف كان انتقل تلقائيًا لقسم آخر عند حذف قسمه — نتأكد أنه حيّ مرة واحدة فقط
    const keptEverywhere = db.flatMap(c => (c.items || []).filter(i => i.n === 'صنف داخل القسم')).length;
    return { exists: !!restored, name: restored && restored.name, before: before.length, after: after.length, keptEverywhere,
             itemsInCat: restored ? (restored.items || []).length : -1 };
  });
  allPass &= check('استعادة القسم تُرجع القسم نفسه', r.exists && r.name === 'قسم مؤقت', `«${r.name}»`);
  allPass &= check('🔒 لا يضيع صنف ولا يتكرّر عند حذف/استعادة قسم',
    r.before === r.after && r.keptEverywhere === 1,
    `${r.before} → ${r.after} صنفًا · «صنف داخل القسم» موجود ${r.keptEverywhere} مرة`);

  // ═══════════ سلامة عامة ═══════════
  line('\n【عام】 سلامة التطبيق');
  r = await page.evaluate(() => {
    setView('shop');
    // المتجر يعرض في أكثر من مكان (الرئيسية + صفحة العرض) — نأخذ الأكبر
    const grids = [...document.querySelectorAll('.shop-grid')];
    const expected = db.reduce((n, c) => n + (c.items || []).length, 0);
    const shown = Math.max(0, ...grids.map(g => g.querySelectorAll('[onclick*="openProductDetail"]').length));
    const lids = db.flatMap(c => (c.items || []).map(i => i.lid));
    return { grid: grids.length > 0, shown, expected, dupes: lids.length - new Set(lids).size };
  });
  allPass &= check('المتجر يعرض كل الأصناف بعد كل التغييرات',
    r.grid && r.shown === r.expected, `معروض ${r.shown} / متوقع ${r.expected}`);
  allPass &= check('لا نسخ مكرّرة بعد الاستعادة', r.dupes === 0, `تكرار: ${r.dupes}`);

  const realErrors = pageErrors.filter(e => !/ERR_FAILED|401|404|Failed to load resource/.test(e));
  allPass &= check('لا أخطاء جافاسكربت جديدة', realErrors.length === 0,
    realErrors.length ? realErrors.slice(0, 3).join(' | ') : 'نظيف');

  line('\n═══════════════════════════════════════════════════════════════');
  line(allPass ? '  ✅ نجحت كل اختبارات الميزات الجديدة' : '  ❌ يوجد فشل — راجع أعلاه');
  line('═══════════════════════════════════════════════════════════════');

  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

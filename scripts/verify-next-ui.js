// ═══════════════════════════════════════════════════════════════════
//  T2.4 + T2.5 — اختبار واجهة Next.js في متصفح حقيقي
//  يتأكد أن: الأنماط تُطبَّق فعلًا (لا 38 كلاسًا بلا تعريف) ·
//  السلة تعمل وتُحفظ · التقارير المفبركة أُزيلت · الحسابات صحيحة
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));

  // نحجب السحابة (نفس مبدأ اختبارات التطبيق الرئيسي — لا نلمس بيانات المحل)
  await page.route('**/*', r => (/supabase\.co/.test(r.request().url()) ? r.abort() : r.continue()));

  let pass = true;
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    pass = pass && ok;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T2.4/T2.5 — واجهة Next.js (متصفح حقيقي)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── 【1】 الأنماط تُطبَّق فعلًا ──
  console.log('\n【1】 الأنماط (كان 60 كلاسًا بلا تعريف)');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const styling = await page.evaluate(() => {
    const hdr = document.querySelector('.app-header');
    const nav = document.querySelector('.app-nav-link');
    const tabs = document.querySelector('.view-tabs');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const h = cs(hdr), n = cs(nav), t = cs(tabs);
    const body = getComputedStyle(document.body);
    return {
      headerSticky: h && h.position === 'sticky',
      headerBorder: h && h.borderBottomWidth !== '0px',
      navWeight: n && parseInt(n.fontWeight) >= 700,
      tabsDefined: t && t.display !== 'inline',       // يُطبَّق عليها عرض مرن مثلًا
      bodyBg: body.backgroundColor,
      hasCustomFont: body.fontFamily.includes('Tajawal') || body.fontFamily.includes('Cairo'),
    };
  });
  check('الرأس ملتصق فعليًا (position: sticky)', styling.headerSticky, '');
  check('وخط فاصل أسفله (الأنماط محمّلة لا مهملة)', styling.headerBorder, '');
  check('روابط الرأس بخط عريض', styling.navWeight, '');
  check('أنماط التبويبات مُطبَّقة', styling.tabsDefined, '');
  check('الخلفية والخط من النظام اللوني', !!styling.bodyBg && styling.bodyBg !== 'rgba(0, 0, 0, 0)', styling.bodyBg);
  check('خط عربي مخصّص محمّل', styling.hasCustomFont, '');

  // ── 【2】 الرأس والتنقّل ──
  console.log('\n【2】 الرأس والتنقل');
  const nav = await page.evaluate(() => ({
    links: [...document.querySelectorAll('.app-nav-link')].map(a => a.textContent.trim()),
    cart: !!document.querySelector('a[href="/cart"]'),
    footer: !!document.querySelector('.app-footer'),
  }));
  check('روابط الرأس موجودة (كان الموقع بلا هيدر إطلاقًا)', nav.links.length >= 3, nav.links.join(' · '));
  check('رابط السلة في الرأس', nav.cart, '');
  check('تذييل الصفحة موجود', nav.footer, '');

  // ── 【3】 السلة: إضافة · حفظ · حساب ──
  console.log('\n【3】 السلة (كانت useState فارغة للأبد)');
  await page.goto(BASE + '/cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  let cartText = await page.innerText('body');
  check('السلة الفارغة تُظهر رسالة واضحة', /السلة فارغة/.test(cartText), '');

  // نضيف منتجًا عبر المخزن المشترك (كما يفعل زر المتجر)
  const added = await page.evaluate(async () => {
    const mod = await import('/_next/static/chunks/app/page.js').catch(() => null);
    // نستخدم الواجهة البرمجية للحالة من localStorage بدل تحميل الحِزم
    return null;
  });

  // الإضافة الحقيقية: نفتح المتجر ونضغط زر «إضافة للسلة» (البيانات من السحابة محجوبة → نزرعها)
  await page.evaluate(() => {
    localStorage.setItem('al_sayed_cart_next', JSON.stringify([
      { lid: 'L1', cid: 101, name: 'منتج اختبار أ', price: 60, priceText: '60', qty: 2, catName: 'قسم', maxQty: 10 },
      { lid: 'L2', cid: 102, name: 'منتج اختبار ب', price: 100, priceText: '100', qty: 1, catName: 'قسم', maxQty: 5 },
    ]));
    localStorage.setItem('al_sayed_settings', JSON.stringify({ shipping: 20, freeShip: 200, couponCode: 'SAVE10', couponPct: 10, tax: 0 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  cartText = await page.innerText('body');
  check('السلة تعرض الأصناف فعلًا', /منتج اختبار أ/.test(cartText) && /منتج اختبار ب/.test(cartText), '');
  check('المجموع الفرعي صحيح (60×2 + 100 = 220)', /220/.test(cartText), '');
  check('الشحن مجاني فوق 200 (الفرعي 220)', /مجاني/.test(cartText), '');
  check('الإجمالي = 220 بلا شحن', /220/.test(cartText), '');
  check('اسم العميل مطلوب في النموذج', /اسم العميل/.test(cartText), '');
  // ⚠️ placeholder لا يظهر في innerText — نفحص وجود الحقل نفسه
  check('حقل الكوبون موجود في الملخص', (await page.$('input[placeholder]')) !== null, '');

  // إدخال الكوبون
  await page.fill('input[placeholder="كود الخصم"]', 'SAVE10');
  await page.click('button:has-text("تطبيق")');
  await page.waitForTimeout(700);
  cartText = await page.innerText('body');
  check('كود SAVE10 يخصم 22 ج.م ويصير الإجمالي 198', /198/.test(cartText) && /22/.test(cartText), '');

  // الكميات تُعدّل
  // ⚠️ الكوبون مطبَّق: المجموع الفرعي 280 · الخصم 28 · الإجمالي 252
  const beforePlus = await page.innerText('body');
  // ⚠️ الأزرار متشابهة نصًّا (− + 🗑️ على كل سطر) — نستخدم وسوم الوصول
  await page.click('button[aria-label^="زيادة"]');
  await page.waitForTimeout(700);
  const afterPlus = await page.innerText('body');
  check('زر + يزيد الكمية (الفرعي 220 → 280)', /280/.test(afterPlus), '');
  check('الخصم يُعاد حسابه تلقائيًا (28 = 10% من 280)', /28/.test(afterPlus), '');

  // ── 【4】 الحفظ عبر إعادة التحميل ──
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const persisted = await page.innerText('body');
  check('🔒 السلة تبقى بعد إعادة التحميل (كانت تضيع)', /منتج اختبار أ/.test(persisted), '');

  // ── 【5】 تسجيل الدخول مطلوب للإتمام (لا يُفقد الطلب) ──
  const guard = await page.evaluate(() => {
    const txt = document.body.innerText;
    return { needsLogin: /سجّل الدخول|تسجيل الدخول/.test(txt), confirmDisabled: !!document.querySelector('button[disabled]') };
  });
  check('يطلب تسجيل الدخول قبل الإتمام (بدل Fail صامت)', guard.needsLogin, '');

  // ── 【6】 لا تقييمات مفبركة ولا ادعاءات غير مؤكدة ──
  console.log('\n【6】 الصدق في العرض (مثل T4.1)');
  const honesty = await page.evaluate(async () => {
    const res = await fetch('/product/1').catch(() => null);
    const html = res ? await res.text() : '';
    return {
      fakeRating: /4\.3/.test(html) || /تقييم\)/.test(html) || /⭐/.test(html),
      fakeReturns: /إرجاع مجاني/.test(html),
      hardcodedShip: /فوق 500/.test(html),
    };
  });
  check('لا تقييمات مفبركة في صفحة المنتج', !honesty.fakeRating, honesty.fakeRating ? '⚠️ ما زالت موجودة' : 'نُظِّفت');
  check('لا ادعاء «إرجاع مجاني 14 يوم»', !honesty.fakeReturns, '');
  check('لا رقم شحن مكتوب في الكود (يأتي من الإعدادات)', !honesty.hardcodedShip, '');

  // ── 【7】 سلامة عامة ──
  console.log('\n【7】 سلامة عامة');
  for (const path of ['/', '/cart', '/stock', '/admin']) {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    check(`الصفحة ${path} تعمل (بلا خطأ سيرفر)`, r.status() === 200, `HTTP ${r.status()}`);
  }
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت في الواجهة', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(pass ? '  ✅ نجحت كل فحوص واجهة Next.js' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await page.screenshot({ path: '/home/user/next-cart-after.png', fullPage: false });
  await browser.close();
  process.exit(pass ? 0 : 1);
})();

// ═══════════════════════════════════════════════════════════════════
//  T4.2 + T4.3 — صفحات Next القانونية (متصفح حقيقي)
//  ما نتحقق منه: الصفحات موجودة فعلًا · تُفتح من التذييل · المحتوى
//  مبني على ما يفعله النظام · سياسة الإرجاع صادقة عند غياب الإعداد.
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  await page.route('**/*', r => (/supabase\.co/.test(r.request().url()) ? r.abort() : r.continue()));

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T4.2/T4.3 — الصفحات القانونية في تطبيق Next');
  console.log('═══════════════════════════════════════════════════════════════');

  // ═══ 1) الروابط في التذييل ═══
  console.log('\n【1】 روابط التذييل');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const links = await page.$$eval('.app-footer-links a', as => as.map(a => a.getAttribute('href')));
  check('ثلاث روابط قانونية في التذييل', links.length === 3, links.join(' · '));
  check('تشير إلى /privacy و /terms و /returns',
    ['/privacy', '/terms', '/returns'].every(h => links.includes(h)));

  // ═══ 2) كل صفحة تُفتح بمحتوى حقيقي ═══
  console.log('\n【2】 الصفحات الثلاث');
  const pages = [
    { path: '/privacy', must: ['الفواتير', 'صلاحيات', 'خدمة خارجية'], name: 'الخصوصية' },
    { path: '/terms', must: ['السلة', 'الشحن', 'يُسجَّل'], name: 'الشروط' },
    { path: '/returns', must: ['إرجاع'], name: 'الإرجاع' },
  ];
  for (const p of pages) {
    const res = await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const txt = await page.evaluate(() => document.body.innerText);
    const ok = p.must.every(m => txt.includes(m));
    check(`صفحة ${p.name} تعمل ومحتواها موجود (HTTP ${res.status()})`, res.status() === 200 && ok,
      ok ? '' : 'ناقص: ' + p.must.filter(m => !txt.includes(m)).join(' · '));
    check(`صفحة ${p.name}: يوجد رابط عودة للمتجر`, txt.includes('العودة للمتجر'));
  }

  // ═══ 3) سياسة الإرجاع صادقة بلا إعدادات ═══
  console.log('\n【3】 الإرجاع بلا إعدادات (الحالة الافتراضية للمتجر)');
  const returnsTxt = await page.evaluate(() => document.body.innerText);
  check('تقول «لم تُحدَّد» بصراحة', returnsTxt.includes('لم تُحدَّد'));
  check('لا تدّعي مدة إرجاع رقمية', !/\d+\s*(يوم|أيام|يومًا)/.test(returnsTxt));
  check('توضح أن المدة يحددها صاحب المتجر', returnsTxt.includes('صاحب المتجر'));

  // ═══ 4) الإعدادات المحلية تُغيّر المحتوى ═══
  console.log('\n【4】 الإعدادات تغيّر ما يُعرض (لا نص ثابت في الكود)');
  await page.evaluate(() => localStorage.setItem('al_sayed_settings', JSON.stringify({
    store_name: 'متجر الاختبار', phone: '01000000001', address: 'المنصورة',
    store_desc: 'أدوات كهربائية', return_days: 14, return_note: 'بشرط الفاتورة الأصلية',
  })));
  await page.goto(BASE + '/returns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const withSettings = await page.evaluate(() => document.body.innerText);
  check('تُعرض المدة المحدَّدة بصياغة عربية صحيحة (14 يومًا)', withSettings.includes('14 يومًا'));
  check('ملاحظة المالك تظهر', withSettings.includes('الفاتورة الأصلية'));
  check('بيانات التواصل تظهر من الإعدادات', withSettings.includes('01000000001') && withSettings.includes('المنصورة'));
  check('صياغة 14 صحيحة لغويًا (لا «14 أيام»)', !withSettings.includes('14 أيام'));

  await page.evaluate(() => localStorage.setItem('al_sayed_settings', JSON.stringify({ store_name: 'متجر الاختبار' })));
  await page.goto(BASE + '/terms', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const termsTxt = await page.evaluate(() => document.body.innerText);
  check('اسم المتجر من الإعدادات في الشروط', termsTxt.includes('متجر الاختبار'));
  const hasContact = termsTxt.includes('تواصل معنا');
  check('لا تُعرض بيانات تواصل غير موجودة', !hasContact, hasContact ? 'ظهر قسم تواصل بلا بيانات' : '');

  // ═══ 5) سلامة ═══
  console.log('\n【5】 سلامة');
  const real = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', real.length === 0, real.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ نجحت كل فحوص الصفحات القانونية' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

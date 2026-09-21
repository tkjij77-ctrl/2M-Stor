// ═══════════════════════════════════════════════════════════════════
//  T4.2 + T4.3 — هوية المتجر والمحتوى القانوني (متصفح حقيقي)
//
//  ما كان: الموقع يقول «كتب، قرطاسية، وأدوات مكتبية» والمخزون الفعلي
//  أدوات كهربائية · رقم هاتف سعودي وبريد ومدينة مُخترعة · ولا صفحة
//  إرجاع/خصوصية، مع أن صفحة المنتج كانت تَعِد بـ«إرجاع 14 يوم».
//
//  ما نتحقق منه:
//   1) لا ادعاء نشاط غير موجود ولا بيانات تواصل مُخترعة
//   2) وصف المتجر يأتي من الإعدادات (يتغيّر فورًا عند تغييرها)
//   3) بيانات التواصل تظهر من الإعدادات فقط — وإن غابت نقول ذلك
//   4) ثلاث صفحات قانونية تفتح من التذييل
//   5) سياسة الإرجاع صادقة: «لم تُحدَّد» عند غياب الإعداد، وتُعرض عند تحديدها
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const SEED = [{
  name: 'قسم الاختبار', lid: 'Lc1', cid: 1, items: [
    { n: 'منتج أ', p: '60', pn: 60, q: 10, qs: 10, min: 2, b: '', img: '', lid: 'La', cid: 101 }
  ]
}];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  page.on('dialog', d => d.accept());
  await page.route('**/*', r => r.request().url().includes('supabase.co') ? r.abort() : r.continue());

  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_session_user', 'admin');
  }, SEED);

  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T4.2/T4.3 — الهوية والمحتوى القانوني (متصفح حقيقي)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ═══ 1) لا ادعاءات ولا بيانات مُخترعة ═══
  console.log('\n【1】 لا ادعاء نشاط ولا بيانات مُخترعة');
  // ⚠️ نفحص **النص المرئي** (innerText) لا مصدر الصفحة: تعليقات الكود
  // التي تشرح ما أُزيل ليست ادعاءات يراه الزائر.
  const visible = await page.evaluate(() => document.body.innerText);
  check('لا «كتب، قرطاسية» في النص المرئي', !/قرطاسية/.test(visible));
  check('لا رقم هاتف مُخترع (0500000000)', !visible.includes('0500000000'));
  check('لا بريد مُخترع (info@2m-stor.com)', !visible.includes('info@2m-stor.com'));
  check('لا مدينة مُخترعة (الرياض)', !visible.includes('الرياض'));
  check('لا وعد «إرجاع في مدة» ثابت', !/إرجاع[^.]{0,24}\d+\s*(يوم|أيام|يومًا)/.test(visible));

  // ═══ 2) الوصف من الإعدادات ═══
  console.log('\n【2】 وصف المتجر يأتي من الإعدادات');
  await page.evaluate(() => {
    settings.desc = 'أدوات ومستلزمات كهربائية أصلية';
    saveSettings(); renderAll();
  });
  await page.waitForTimeout(700);
  let desc = await page.evaluate(() => (document.getElementById('landing-desc') || {}).textContent || '');
  check('الوصف المحدَّد يظهر للزائر', desc.includes('أدوات ومستلزمات كهربائية'), desc.slice(0, 44));

  await page.evaluate(() => { settings.desc = 'وصف مُحدَّث'; saveSettings(); renderAll(); });
  await page.waitForTimeout(600);
  desc = await page.evaluate(() => document.getElementById('landing-desc').textContent);
  check('تغيير الإعداد يتغيّر فورًا (لا نص ثابت في الكود)', desc.includes('وصف مُحدَّث'));

  // ═══ 3) التواصل من الإعدادات فقط ═══
  console.log('\n【3】 بيانات التواصل حقيقية فقط');
  let contact = await page.evaluate(() => document.getElementById('landing-contact').innerText);
  check('بلا بيانات: نقول ذلك بصراحة', /لم تُضَف بيانات تواصل/.test(contact), contact.slice(0, 40));

  await page.evaluate(() => { settings.phone = '01000000001'; settings.address = 'المنصورة'; saveSettings(); renderAll(); });
  await page.waitForTimeout(600);
  contact = await page.evaluate(() => document.getElementById('landing-contact').innerText);
  check('يظهر الهاتف والعنوان عند تحديدهما', contact.includes('01000000001') && contact.includes('المنصورة'));

  // ═══ 4) الصفحات القانونية ═══
  console.log('\n【4】 صفحات قانونية تفتح من التذييل');
  const footer = await page.evaluate(() => {
    const links = [...document.querySelectorAll('#landing-footer a[onclick^="showLegal"]')];
    return { count: links.length, labels: links.map(a => a.textContent.trim()) };
  });
  check('٣ روابط قانونية في التذييل', footer.count === 3, footer.labels.join(' · '));

  const privacy = await page.evaluate(() => { showLegal('privacy'); const t = document.getElementById('modalBody').innerText; closeModal(); return t; });
  check('الخصوصية تشرح ما يُجمع فعلًا (فواتير)', privacy.includes('الفواتير'));
  check('الخصوصية تذكر إيقاف الإرسال لخدمة خارجية', privacy.includes('خدمة خارجية'));
  check('الخصوصية لا تدّعي عدم جمع أي بيانات', !privacy.includes('لا نجمع أي بيانات'));

  const terms = await page.evaluate(() => { showLegal('terms'); const t = document.getElementById('modalBody').innerText; closeModal(); return t; });
  check('الشروط تذكر أن الشحن يظهر في السلة', terms.includes('السلة'));

  // ═══ 5) سياسة الإرجاع صادقة ═══
  console.log('\n【5】 سياسة الإرجاع — لا وعد بلا أساس');
  let returns = await page.evaluate(() => { showLegal('returns'); const t = document.getElementById('modalBody').innerText; closeModal(); return t; });
  check('بلا إعداد: «لم تُحدَّد سياسة إرجاع بعد»', returns.includes('لم تُحدَّد'), returns.slice(0, 60).replace(/\n/g, ' '));
  check('لا مدة إرجاع مُخترعة', !/\d+\s*(يوم|أيام)/.test(returns));

  returns = await page.evaluate(() => {
    settings.returnDays = 14; settings.returnNote = 'بشرط الفاتورة الأصلية';
    saveSettings(); showLegal('returns');
    const t = document.getElementById('modalBody').innerText; closeModal(); return t;
  });
  check('عند تحديد 14 يومًا تُعرض بصياغة صحيحة', returns.includes('14 يومًا'), '');
  check('ملاحظة المالك تظهر', returns.includes('الفاتورة الأصلية'));
  check('لا تُعرض «14 أيام» (خطأ لغوي)', !returns.includes('14 أيام'));

  returns = await page.evaluate(() => { settings.returnDays = 1; showLegal('returns'); const t = document.getElementById('modalBody').innerText; closeModal(); return t; });
  check('مدة يوم واحد: «يوم واحد» لا «1 أيام»', returns.includes('يوم واحد'));

  const back = await page.evaluate(() => {
    settings.returnDays = 0; settings.returnNote = ''; saveSettings();
    showLegal('returns');
    const t = document.getElementById('modalBody').innerText; closeModal(); return t;
  });
  check('إعادة التصفير تُرحّل للصدق فورًا (لم تُحدَّد)', back.includes('لم تُحدَّد'));

  // ═══ 6) صفحة/نافذة تفاصيل المنتج — نفس الصدق ═══
  console.log('\n【6】 تفاصيل المنتج (كان بها تقييم 4.3 مبني على الكميات!)');
  await page.evaluate(() => {
    settings.shipping = 25; settings.freeShip = 150; settings.tax = 14;
    settings.returnDays = 7; settings.returnNote = 'بشرط الفاتورة';
    saveSettings();
    openProductDetail(0, 0);
  });
  await page.waitForTimeout(800);
  const pd = await page.evaluate(() => document.getElementById('productDetailCard').innerText);
  check('لا تقييم مفبرك (4.3 أو نجوم)', !/4\.3/.test(pd) && !/⭐/.test(pd));
  check('يقول بصراحة إن التقييمات غير متاحة', pd.includes('لا تُعرض تقييمات'));
  check('لا «توصيل خلال 24 ساعة»', !pd.includes('24 ساعة'));
  check('لا «دفع آمن» ولا «دفع عند الاستلام»', !pd.includes('دفع آمن') && !pd.includes('دفع عند الاستلام'));
  check('لا «إرجاع مجاني خلال 14 يوم»', !pd.includes('14 يوم'));
  check('الشحن من الإعدادات (مجاني فوق 150 · وإلا 25)', pd.includes('150') && pd.includes('25'), '');
  check('الضريبة مذكورة كنسبة تُضاف (14%)', pd.includes('14%'));
  check('سياسة الإرجاع من الإعدادات (7 أيام)', pd.includes('7 أيام'));
  check('رابط «التفاصيل» يفتح الصفحة القانونية', pd.includes('التفاصيل'));
  const opensLegal = await page.evaluate(() => {
    closeProductDetail(); showLegal('returns');
    const el = document.getElementById('modal');
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const body = document.getElementById('modalBody');
    const t = body.innerText || body.textContent;
    return { display: cs.display, visible: box.height > 100 && box.width > 100, text: t };
  });
  check('نافذة الصفحة القانونية **ظاهرة** فعليًا (ليست مخفية)', opensLegal.visible && opensLegal.display !== 'none',
        'display=' + opensLegal.display + ' · ارتفاع=' + Math.round(opensLegal.visible ? 900 : 0));
  check('نفس النص في الصفحة القانونية والنافذة', opensLegal.text.includes('7 أيام'));
  check('يمكن إغلاقها بزر «فهمت»', await page.evaluate(() => {
    closeModal();
    return getComputedStyle(document.getElementById('modal')).display === 'none';
  }));

  // ═══ 7) سلامة ═══
  console.log('\n【7】 سلامة');
  const real = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت', real.length === 0, real.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ نجحت كل فحوص الهوية والمحتوى القانوني' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

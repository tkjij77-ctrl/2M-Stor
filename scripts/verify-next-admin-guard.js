// ═══════════════════════════════════════════════════════════════════
//  T2.5/الأمن — حماية مسار /admin في تطبيق Next.js (متصفح حقيقي)
//
//  لماذا هذا السكربت موجود: الحماية كلها تعيش في ملف واحد (middleware.ts).
//  لو تعطّل — بإعادة تسمية في ترقية Next، أو بتغيير مَطcher، أو بحذف خطأ —
//  لا يفشل أي فحص آخر: الصفحة تعمل، والاختبارات تمرّ، ولوحة التحكم تصير
//  مفتوحة للزوار. هذا الفحص يقيس **الأثر** (تحويل فعلي) لا وجود الملف.
//
//  التشغيل: node scripts/verify-next-admin-guard.js   (يحتاج خادم Next على 3100)
//  أو:      APP_URL=http://127.0.0.1:3101 node scripts/verify-next-admin-guard.js
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const BASE = process.env.APP_URL || 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  // لا نلمس قاعدة حقيقية إطلاقًا: كل طلب إلى Supabase يُقطع
  await page.route('**/*', r => (/supabase\.co/.test(r.request().url()) ? r.abort() : r.continue()));

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  الأمن — حماية /admin بلا جلسة (middleware)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ═══ 1) التحويل الفعلي للزائر ═══
  console.log('\n【1】 الزائر بلا جلسة لا يصل إلى لوحة التحكم');
  for (const path of ['/admin', '/admin/dashboard']) {
    const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const finalUrl = new URL(page.url()).pathname;
    const body = await page.innerText('body').catch(() => '');
    const landedOff = finalUrl !== path && !finalUrl.startsWith('/admin');
    check(
      `${path} يُحوَّل بعيدًا عن لوحة التحكم`,
      landedOff,
      `النهاية: ${finalUrl} · حالة الاستجابة: ${res ? res.status() : '—'}`,
    );
    check(
      `${path} لا يُسرّب محتوى اللوحة`,
      !/إجمالي الأصناف|الأكثر مبيعاً|لوحة التحكم/.test(body),
      body.replace(/\s+/g, ' ').slice(0, 60),
    );
  }

  // ═══ 2) المتجر نفسه ما زال يعمل (لا نكسر العام بحماية الخاص) ═══
  console.log('\n【2】 المتجر العام يعمل كما هو');
  const home = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const homeBody = await page.innerText('body').catch(() => '');
  check('الصفحة الرئيسية تستجيب 200 وتحوي واجهة المتجر', !!home && home.status() === 200 && /المتجر|السلة|بحث/.test(homeBody), `HTTP ${home ? home.status() : '—'}`);
  check('التذييل وصفحات السياسات موجودة', /سياسة|الإرجاع|الخصوصية|الشروط/.test(homeBody));

  // ═══ 3) ترويسات الأمان (T1.3) ═══
  console.log('\n【3】 ترويسات الأمان على الاستجابات');
  const h = (home && home.headers()) || {};
  check('CSP موجودة على الصفحة', /default-src 'self'/.test(h['content-security-policy'] || ''), (h['content-security-policy'] || '').slice(0, 60) || 'غائبة');
  check('X-Frame-Options = DENY', (h['x-frame-options'] || '').toUpperCase() === 'DENY', h['x-frame-options'] || 'غائبة');
  check('X-Content-Type-Options = nosniff', (h['x-content-type-options'] || '').toLowerCase() === 'nosniff', h['x-content-type-options'] || 'غائبة');

  // ═══ 4) لا أخطاء جافاسكربت حقيقية ═══
  console.log('\n【4】 سلامة التشغيل');
  const realErrors = errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::/i.test(e));
  check('لا أخطاء جافاسكربت في الصفحات المفحوصة', realErrors.length === 0, realErrors.slice(0, 2).join(' · '));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ لوحة التحكم محمية · والمتجر العام سليم' : '  ❌ هناك خلل — راجع البنود أعلاه');
  console.log('  (طلبات Supabase مقطوعة في هذا الفحص — لا تلمس بيانات المتجر)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('❌ فشل الفحص:', e.message); process.exit(1); });

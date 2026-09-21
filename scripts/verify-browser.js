// ═══════════════════════════════════════════════════════════════════
//  اختبار متصفح حقيقي — يتحقق من أن إصلاحات الموجة 0 تعمل فعلًا
//  يشغّل النسخة الأصلية (قبل) والنسخة المُصلَّحة (بعد) ويقارن النتيجة
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const fs = require('fs');

const PAYLOAD = 'x" onerror="window.__XSS_FIRED=1" data-x="';

const SEED = [{
  name: "قسم اختبار",
  lid: "Ltest1", cid: 1,
  items: [
    { n: "منتج سليم", p: "100 - 150", pn: 100, q: 20, qs: 5, min: 3, b: "123456", img: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", lid: "Li1", cid: 101 },
    { n: "منتج بصورة ضارة", p: "50", pn: 50, q: 10, qs: 4, min: 2, b: "", img: PAYLOAD, lid: "Li2", cid: 102 },
    { n: "منتج بدون صورة", p: "25", pn: 25, q: 0, qs: 0, min: 5, b: "", img: "", lid: "Li3", cid: 103 }
  ]
}];

async function run(label, url, allowCDN) {
  const browser = await chromium.launch();
  // ⚠️ مهم: نحجب Service Worker ليصبح الاختبار عادلًا — بدون ذلك يعترض الـ SW
  // الطلبات فيمرّ من الفلتر (وكان هذا سبب فرق وهمي بين قبل وبعد في أول تشغيل)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const cspViolations = [];
  const pageErrors = [];
  const blocked = [];

  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') {
      consoleErrors.push(t.slice(0, 160));
      if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(t.slice(0, 160));
    }
  });
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 160)));

  // لا نلمس قاعدة بيانات المحل الحقيقية — نحجب كل طلبات Supabase
  // (نختبر مسار العمل المحلي/الأوفلاين، وهو اختبار أصعب وأدق)
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('supabase.co')) { blocked.push(u.split('?')[0]); return route.abort(); }
    if (!allowCDN && u.includes('cdn.jsdelivr.net')) { blocked.push(u.split('?')[0]); return route.abort(); }
    return route.continue();
  });

  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    window.__XSS_FIRED = undefined;
  }, SEED);

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2500);   // اترك الوقت للتهيئة والرسم

  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => document.querySelectorAll(s);
    return {
      libs: {
        supabase: typeof window.supabase !== 'undefined',
        Chart: typeof window.Chart !== 'undefined',
        QRCode: typeof window.QRCode !== 'undefined',
        jsQR: typeof window.jsQR !== 'undefined'
      },
      xssFired: window.__XSS_FIRED,
      // فحص دقيق: هل أنشأت الحمولةُ خاصيةً في الـ DOM؟
      payloadAttrs: qa('[onerror*="__XSS"], [data-x]').length,
      onerrorAttrs: qa('[onerror]').length,
      onerrorSample: [...qa('[onerror]')].map(e => (e.outerHTML || '').slice(0, 120)),
      jsSchemeSrc: [...qa('img')].filter(i => /^\s*javascript:/i.test(i.getAttribute('src') || '')).length,
      landing: !!q('.landing-hero, #landing, .hero, main'),
      hasEsc: typeof window.esc === 'function',
      hasSetupFn: typeof window.createFirstLocalAdmin === 'function',
      title: document.title,
      bodyLen: document.body.innerText.length,
      cats: (typeof db !== 'undefined' && db) ? db.length : 0,
      firstCat: (typeof db !== 'undefined' && db && db[0]) ? db[0].name : ''
    };
  });

  // اذهب لصفحة العرض وانتظر الكروت
  await page.evaluate(() => { try { setView('shop'); } catch (e) {} });
  await page.waitForTimeout(1200);
  const shop = await page.evaluate(() => ({
    grid: !!document.querySelector('.shop-grid'),
    cards: document.querySelectorAll('.shop-card').length,
    names: [...document.querySelectorAll('.shop-name')].map(e => e.textContent.trim()),
    prices: [...document.querySelectorAll('.shop-price')].map(e => e.textContent.trim())
  }));

  // اختبار شاشة الدخول: هل نص admin/admin اختفى؟ وهل شاشة التهيئة تظهر؟
  await page.evaluate(() => { try { localStorage.removeItem('al_sayed_session_user'); _forceLocal = true; showLogin(); renderLogin(); } catch (e) {} });
  await page.waitForTimeout(600);
  const login = await page.evaluate(() => {
    const el = document.getElementById('loginInner');
    const txt = el ? el.innerText : '';
    return {
      text: txt.slice(0, 400),
      mentionsAdminAdmin: /admin\s*\/\s*admin/i.test(txt),
      hasFirstRunForm: !!document.getElementById('setup-pass')
    };
  });

  // اختبار XSS مباشر: نضيف منتجًا بصورة ضارة ونعيد الرسم، ثم نتأكد أنه لم يُنفَّذ
  await page.evaluate(() => {
    window.__XSS_FIRED = undefined;
    db[0].items[1].img = 'y" onerror="window.__XSS_FIRED=1" z="';
    setView('shop');
  });
  await page.waitForTimeout(900);
  const xssAfterRender = await page.evaluate(() => window.__XSS_FIRED);

  await page.screenshot({ path: `/home/user/test-${label}.png`, fullPage: false });
  await browser.close();

  return { label, url, r, shop, login, xssAfterRender, consoleErrors, cspViolations, pageErrors, blocked: [...new Set(blocked)].length };
}

(async () => {
  const before = await run('before', 'http://127.0.0.1:8124/index.html', true);
  const after  = await run('after',  'http://127.0.0.1:8123/index.html', false);

  const line = (s) => console.log(s);
  const cmp = (name, a, b, good) => {
    const f = (v) => (v === undefined ? 'غير معرّف' : v === null ? 'null' : String(v));
    line(`  ${name.padEnd(34)} قبل: ${f(a).padEnd(22)} بعد: ${f(b).padEnd(22)} ${good(a, b) ? '✅' : '❌'}`);
  };

  line('\n═══════════════════════════════════════════════════════════════════');
  line('  نتائج الاختبار في متصفح حقيقي (Chromium) — قبل مقابل بعد');
  line('═══════════════════════════════════════════════════════════════════');

  line('\n【1】 المكتبات — هل حُمّلت؟');
  for (const k of ['supabase', 'Chart', 'QRCode', 'jsQR']) {
    cmp('  ' + k, before.r.libs[k], after.r.libs[k], (a, b) => b === true);
  }

  line('\n【2】 ثغرة XSS عبر صورة المنتج');
  cmp('  تنفيذ الكود الضار عند التحميل', before.r.xssFired, after.r.xssFired, (a, b) => b === undefined);
  cmp('  تنفيذ الكود الضار عند الرسم', before.xssAfterRender, after.xssAfterRender, (a, b) => b === undefined);
  cmp('  خصائص أنشأتها الحمولة الضارة', before.r.payloadAttrs, after.r.payloadAttrs, (a, b) => b === 0);
  cmp('  روابط ببروتوكول javascript: خطر', before.r.jsSchemeSrc, after.r.jsSchemeSrc, (a, b) => b === 0);

  line('\n【3】 انتحال نص الدخول القديم');
  cmp('  يذكر (admin / admin)', before.login.mentionsAdminAdmin, after.login.mentionsAdminAdmin, (a, b) => b === false);
  cmp('  شاشة تهيئة أول مرة (setup-pass)', before.login.hasFirstRunForm, after.login.hasFirstRunForm, (a, b) => a === false && b === true);

  line('\n【4】 سلامة الواجهة — المتجر ما زال يعمل');
  cmp('  شبكة المتجر .shop-grid', before.shop.grid, after.shop.grid, (a, b) => b === true);
  cmp('  عدد كروت المنتجات', before.shop.cards, after.shop.cards, (a, b) => b >= 3);
  cmp('  يعرض الأسعار', before.shop.prices.length, after.shop.prices.length, (a, b) => b >= 3);
  cmp('  عدد الأقسام المحمّلة', before.r.cats, after.r.cats, (a, b) => b > 0 && a === b);
  cmp('  اسم أول قسم (تطابق البيانات)', before.r.firstCat, after.r.firstCat, (a, b) => a === b && !!b);

  line('\n【5】 الأخطاء');
  cmp('  أخطاء صفحة (page errors)', before.pageErrors.length, after.pageErrors.length, (a, b) => b === 0);
  cmp('  انتهاكات CSP', before.cspViolations.length, after.cspViolations.length, (a, b) => b === 0);
  cmp('  أخطاء وحدة التحكم', before.consoleErrors.length, after.consoleErrors.length, (a, b) => b <= a);

  if (after.r.onerrorSample.length) line('\n  ℹ️ عناصر بها [onerror] في النسخة المُصلَّحة (للتشخيص):\n    ' + after.r.onerrorSample.join('\n    '));
  if (after.r.cats > 0) line(`\n  ℹ️ البيانات: ${after.r.cats} قسمًا · أول قسم: «${after.r.firstCat}»`);
  // ملاحظة N-1 (مُغلقة بترحيل 20260921050000): كانت هذه الأخطاء تأتي من القاعدة
  // لأن سياسات الجداول كانت تفشل للزائر («permission denied for function my_role»).
  // الاختبار **يحجب طلبات Supabase عمدًا** حفاظًا على بيانات المحل، فالطلبات
  // المحجوبة تُنتج ERR_FAILED/404 هنا — لا عطلًا في التطبيق. الإثبات الحقيقي
  // لسلوك الزائر على القاعدة نفسها موجود في scripts/verify-sql-live.sh (قسم RLS).
  if (after.consoleErrors.length) line('\n  ℹ️ أخطاء الكونسول المتبقية (طلبات Supabase محجوبة في الاختبار — ليست أعطالًا؛ سلوك الزائر مُختبَر على قاعدة حقيقية في verify-sql-live):\n    ' + [...new Set(after.consoleErrors)].slice(0, 4).join('\n    '));
  if (after.pageErrors.length) line('\n  ⚠️ أخطاء الصفحة بعد الإصلاح:\n    ' + after.pageErrors.slice(0, 5).join('\n    '));
  if (after.cspViolations.length) line('\n  ⚠️ انتهاكات CSP:\n    ' + after.cspViolations.slice(0, 5).join('\n    '));

  line('\n【6】 الحكم النهائي');
  const pass = after.r.xssFired === undefined && after.xssAfterRender === undefined &&
               after.r.onerrorAttrs === 0 && after.login.mentionsAdminAdmin === false &&
               after.login.hasFirstRunForm && after.shop.grid && after.shop.cards >= 3 &&
               after.pageErrors.length === 0 && after.cspViolations.length === 0 &&
               Object.values(after.r.libs).every(Boolean);
  line(pass ? '  ✅ نجحت كل الفحوصات — الإصلاحات تعمل والمتجر سليم'
            : '  ❌ يوجد فحص فاشل — راجع التفاصيل أعلاه');
  line(`\n  (تم حجب طلبات Supabase في الاختبار حفاظًا على بيانات المحل — ${after.blocked} طلبًا محجوبًا)`);
  line('  لقطات الشاشة: /home/user/test-before.png · /home/user/test-after.png');
  process.exit(pass ? 0 : 1);
})();

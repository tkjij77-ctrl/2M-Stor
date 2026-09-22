// ═══════════════════════════════════════════════════════════════════
//  F2 — قفل محاولات الدخول: هل هو حقيقي أم وهمي؟ (متصفح حقيقي)
//
//  العطل القديم: القفل كان في `localStorage` وحده ⇒
//    • مسح بيانات المتصفح يلغيه
//    • نافذة خاصة/جهاز آخر لا تراه أصلًا
//  الاختبار يثبت أن القفل الجديد لا يعتمد على المتصفح: نُقلّد السيرفر
//  (login_gate / login_fail / login_ok) بحالة محفوظة **خارج المتصفح**،
//  ثم نمسح localStorage ونفتح نافذة جديدة ونتأكد أن القفل باقٍ.
//
//  التشغيل: node scripts/verify-login-throttle.js   (يحتاج الخادم على 8123)
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const URL = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';

// ── سيرفر مُقلَّد: الحالة تعيش خارج المتصفح ──────────────────────
const S = { fails: [], windowMs: 15 * 60 * 1000, limit: 5, calls: { gate: 0, fail: 0, ok: 0 } };
const now = () => Date.now();
const prune = () => { S.fails = S.fails.filter((a) => now() - a.at < S.windowMs); };
function gate(u) {
  prune();
  const n = S.fails.filter((a) => a.u === u).length;
  if (n >= S.limit) return { allowed: false, locked_seconds: 300, attempts_left: 0, scope: 'username' };
  return { allowed: true, locked_seconds: 0, attempts_left: S.limit - n, scope: 'none' };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let fails = 0;
  const check = (name, pass, detail) => {
    if (!pass) fails++;
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + String(detail).slice(0, 90) : ''}`);
  };

  // ── صفحة بسحابة مُقلَّدة (on:true ⇒ واجهة الدخول السحابية كما في الإنتاج) ──
  async function open({ cloud = true, seed = true } = {}) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (!url.includes('supabase.co')) return route.continue();
      const fn = url.includes('/rpc/') ? url.split('/rpc/')[1].split('?')[0] : '';
      const body = (() => { try { return req.postDataJSON() || {}; } catch { return {}; } })();
      if (fn === 'login_gate' || fn === 'login_fail') {
        S.calls[fn === 'login_gate' ? 'gate' : 'fail']++;
        if (fn === 'login_fail') S.fails.push({ u: body.p_username, d: body.p_device, at: now() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gate(body.p_username)) });
      }
      if (fn === 'login_ok') {
        S.calls.ok++;
        S.fails = S.fails.filter((a) => a.u !== body.p_username);
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
      }
      if (fn) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      if (url.includes('/auth/v1/')) {
        // كل محاولات الدخول السحابي تفشل بحساب/كلمة مرور خاطئة
        return route.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
      }
      if (url.includes('/rest/v1/')) {
        const single = (req.headers()['accept'] || '').includes('pgrst.object');
        return route.fulfill({ status: 200, contentType: 'application/json', body: single ? 'null' : '[]' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.addInitScript((cfg) => {
      localStorage.clear();
      if (cfg.seed) {
        localStorage.setItem('al_sayed_users', JSON.stringify([
          { u: 'owner', role: 'admin', name: 'المالك', p: 'x', salt: 'y' },   // كلمة المرور غير معروفة ⇒ فشل مؤكد
        ]));
        localStorage.setItem('al_sayed_db', JSON.stringify([]));
        localStorage.setItem('al_sayed_invoices', '[]');
      }
      localStorage.setItem('al_sayed_cloud', JSON.stringify({ url: 'https://mock.supabase.co', key: 'anon-mock', on: !!cfg.cloud }));
    }, { cloud, seed });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof cloudDoLogin === 'function');
    await page.evaluate(() => { try { renderLogin(); showLogin(); } catch {} });
    await page.waitForTimeout(600);
    return { ctx, page };
  }

  /** يدعم وضعي الدخول: سحابي (cl-email) ومحلي (login-user) */
  async function tryLogin(page, user, pass) {
    return page.evaluate(async (creds) => {
      const cloud = !!document.getElementById('cl-email');
      if (cloud) {
        document.getElementById('cl-email').value = creds.u;
        document.getElementById('cl-pass').value = creds.p;
        await cloudDoLogin();
      } else {
        // 🚫 T-A3: لم يعد هناك مسار دخول محلي — الواجهة السحابية هي الوحيدة
        return { mode: 'none', text: 'لا واجهة دخول ظاهرة', shown: false };
      }
      await new Promise((r) => setTimeout(r, 400));
      const el = document.getElementById('loginError');
      const note = document.getElementById('loginOk');
      const txt = ((el && el.style.display !== 'none' ? el.textContent : '') || (note && note.style.display !== 'none' ? note.textContent : '') || '');
      return { mode: cloud ? 'cloud' : 'none', text: txt, shown: !!(txt && txt.trim()) };
    }, { u: user, p: pass });
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  F2 — قفل محاولات الدخول (متصفح حقيقي · سيرفر مُقلَّد بحالة)');
  console.log('═══════════════════════════════════════════════════════════════');

  let { ctx, page } = await open({ cloud: true });

  // ── 0) الواجهة السحابية هي المعروضة (المسار الحقيقي للمستخدمين) ──
  console.log('\n【0】 المسار المُختبَر');
  const mode = await page.evaluate(() => ({ cloud: !!document.getElementById('cl-email'), local: !!document.getElementById('login-user') }));
  check('واجهة الدخول السحابية معروضة', mode.cloud === true, JSON.stringify(mode));

  // ── 1) محاولة فاشلة: رسالة واضحة + المتبقي ──
  console.log('\n【1】 المحاولة الأولى: رسالة تفهم، لا «حدث خطأ»');
  const r1 = await tryLogin(page, 'owner@test.com', 'wrong');
  check('رسالة خطأ مفهومة للمستخدم', r1.shown && r1.text.includes('غير صحيحة'), r1.text.slice(0, 80));
  check('تظهر المحاولات المتبقية (من السيرفر)', /بقي\s*\d+/.test(r1.text), r1.text.slice(-45));
  check('السيرفر سُئل فعلًا (login_gate + login_fail)', S.calls.gate > 0 && S.calls.fail === 1, JSON.stringify(S.calls));

  // ── 2) خمس محاولات ⇒ قفل الحساب ──
  console.log('\n【2】 خمس محاولات فاشلة ⇒ قفل');
  for (let i = 0; i < 4; i++) await tryLogin(page, 'owner@test.com', 'wrong');
  const r5 = await tryLogin(page, 'owner@test.com', 'wrong');
  check('رسالة القفل ظاهرة ومفهومة', r5.shown && /قُفل|قفل/.test(r5.text), r5.text.slice(0, 85));
  check('السيرفر نفسه يقول «مقفول»', gate('owner@test.com').allowed === false, JSON.stringify(gate('owner@test.com')));

  // ── 3) جوهر F2: مسح بيانات المتصفح + نافذة جديدة ──
  console.log('\n【3】 مسح بيانات المتصفح ونافذة جديدة — هل يسقط القفل؟');
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await ctx.close();
  ({ ctx, page } = await open({ cloud: true }));
  const rFresh = await tryLogin(page, 'owner@test.com', 'wrong');
  check('بعد المسح: القفل باقٍ (لا يُتجاوز بتفريغ المتصفح)', /قُفل|قفل/.test(rFresh.text), rFresh.text.slice(0, 85));
  const leftAfterClear = await page.evaluate(() => lockInfo());
  check('لا قفل محلي محفوظ — القفل قادم من السيرفر', leftAfterClear === null, JSON.stringify(leftAfterClear));
  const rGuess = await tryLogin(page, 'owner@test.com', 'maybe-correct');
  check('حتى «كلمة المرور الصحيحة» لا تُدخل أثناء القفل', /قُفل|قفل/.test(rGuess.text), rGuess.text.slice(0, 60));
  check('لا محاولة جديدة أُرسلت للسحابة أثناء القفل', S.calls.fail === 5, 'login_fail=' + S.calls.fail);

  // ── 4) حساب آخر لا يُعاقب ──
  console.log('\n【4】 حساب آخر لا يُقفل بسبب حساب مُقيَّد');
  check('السيرفر يسمح للحساب الآخر', gate('other@test.com').allowed === true, JSON.stringify(gate('other@test.com')));
  const rOther = await tryLogin(page, 'other@test.com', 'wrong');
  check('الحساب الآخر يُدخل محاولته (لا رسالة قفل له)', !/قُفل/.test(rOther.text), rOther.text.slice(0, 70));

  // ── 5) انتهاء المدة ⇒ يعود الدخول ──
  console.log('\n【5】 انتهاء المدة ⇒ يعود الدخول متاحًا');
  S.fails = S.fails.map((a) => ({ ...a, at: now() - S.windowMs - 1000 }));
  check('بعد المدة السيرفر يسمح', gate('owner@test.com').allowed === true, JSON.stringify(gate('owner@test.com')));
  const rExpired = await tryLogin(page, 'owner@test.com', 'wrong');
  check('المستخدم يرى فشلًا عاديًا لا قفلًا', !/قُفل/.test(rExpired.text), rExpired.text.slice(0, 70));
  await ctx.close();

  // ── 6) 🚫 T-A3: الحساب المحلي أُزيل بالكامل — السحابة هي المسار الوحيد ──
  console.log('\n【6】 إزالة الحساب المحلي (T-A3) + البداية صفحة ترحيب');
  S.fails = [];
  o = await open({ cloud: true });
  const arch = await o.page.evaluate(() => ({
    doLogin: typeof window.doLogin, doRegister: typeof window.doRegister,
    quickCustomer: typeof window.quickCustomer, createFirstLocalAdmin: typeof window.createFirstLocalAdmin,
    forceLocalLogin: typeof window.forceLocalLogin, doLoginLocalBtn: !!document.getElementById('login-user'),
    cloudLogin: typeof window.cloudDoLogin === 'function', cloudReg: typeof window.cloudDoRegister === 'function',
    embeddedDb: typeof window.getDefaultDB === 'function',
    showLandingFn: typeof window.showLanding === 'function'
  }));
  // إعادة تحميل بلا أي تدخّل: نفحص ما يراه المستخدم فعلًا عند أول زيارة
  await o.page.reload({ waitUntil: 'load' });
  await o.page.waitForTimeout(1200);
  const boot = await o.page.evaluate(() => ({
    overlay: getComputedStyle(document.getElementById('loginOverlay')).display,
    home: getComputedStyle(document.getElementById('homeView')).display,
    heroLen: (document.querySelector('.hero') || { innerHTML: '' }).innerHTML.length,
    authBtn: (() => { const b = document.getElementById('authHeaderBtn'); return b ? b.offsetParent !== null : null; })()
  }));
  check('دوال الحساب المحلي مُزالة من الصفحة', ['doLogin','doRegister','quickCustomer','createFirstLocalAdmin','forceLocalLogin'].every(k => arch[k] === 'undefined'), JSON.stringify(arch));
  check('لا حقل دخول محلي ولا قاعدة بيانات مضمَّنة', arch.doLoginLocalBtn === false && arch.embeddedDb === false);
  check('الدخول والتسجيل السحابي موجودان', arch.cloudLogin && arch.cloudReg);
  check('البداية صفحة ترحيب بلا حاجب (عند أول زيارة)', arch.showLandingFn && boot.overlay === 'none' && boot.home !== 'none' && boot.heroLen > 300, JSON.stringify(boot));
  check('زر التسجيل ظاهر أعلى الصفحة للزائر', boot.authBtn === true);
  const gateCall = await o.page.evaluate(async () => await gateBeforeLogin('owner@test.com'));
  check('القفل السيرفري يُسأل قبل أي دخول', !!gateCall && typeof gateCall.block === 'boolean', JSON.stringify(gateCall) + ' · نداءات البوابة=' + S.calls.gate);
  await o.ctx.close();

  // ── 7) بلا اتصال: قفل محلي متصاعد + إفصاح صريح ──
  console.log('\n【7】 بلا اتصال: قفل محلي متصاعد وإفصاح صريح');
  o = await open({ cloud: false });
  const offline = await o.page.evaluate(async () => {
    localStorage.removeItem('al_sayed_lock');
    for (let i = 0; i < 6; i++) failLogin();
    const g = await gateBeforeLogin('owner');
    return { block: g.block, online: g.online, msg: g.message, info: lockInfo() };
  });
  check('القفل المحلي يعمل (بلا إنترنت)', offline.block === true, offline.msg);
  check('ويُفصح أنه محلي — بلا إيهام', offline.online === false && /محلي/.test(offline.msg), offline.msg);
  check('المدة متصاعدة (5 محاولات ⇒ قفل ≥ دقيقة)', offline.info.until > Date.now(), 'strikes=' + offline.info.strikes);

  // ── 8) السقف الزمني الصاعد محليًا ──
  console.log('\n【8】 القفل المحلي يتضاعف (1 · 5 · 15 · 60 دقيقة)');
  const esc = await o.page.evaluate(() => {
    localStorage.removeItem('al_sayed_lock');
    const out = [];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) failLogin();
      localStorage.setItem('al_sayed_lock', JSON.stringify({ ...lockInfo(), until: 0 })); // انتهى القفل ⇒ الجولة التالية
      out.push(lockInfo().strikes);
    }
    return out;
  });
  check('التصاعد محفوظ (strikes 1→2→3)', esc.join(',') === '1,2,3', esc.join(','));
  await o.ctx.close();

  // ── 9) السلامة ──
  console.log('\n【9】 سلامة');
  check('لا أخطاء جافاسكربت', errors.length === 0, errors.slice(0, 2).join(' · ') || 'نظيف');

  await browser.close();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(fails === 0 ? '  ✅ كل فحوص قفل المحاولات ناجحة (F2 مُثبَت في المتصفح)' : `  ❌ فشل ${fails} فحصًا`);
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(fails === 0 ? 0 : 1);
})();

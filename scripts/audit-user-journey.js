// ═══════════════════════════════════════════════════════════════════
//  تدقيق رحلة المستخدم العادي — قياس فعلي في متصفح حقيقي
//
//  الغرض: أن نرى الموقع **بعين العميل** لا بعين المطوّر. كل بند يطبع دليلًا
//  (نص مرئي · لقطة شاشة · استجابة شبكة · خطأ جافاسكربت)، لا رأيًا.
//
//  التشغيل: node scripts/audit-user-journey.js
//  ملاحظات أمان: لا نُتمّ أي فاتورة (نتوقف قبل الحفظ) — وقراءة فقط من السحابة.
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const SHOT = '/home/user/audit-shots';
const OUT = { findings: [], net: [], errors: [] };

fs.mkdirSync(SHOT, { recursive: true });
const log = (s = '') => console.log(s);
const h = (t) => { log('\n' + '═'.repeat(63)); log('  ' + t); log('═'.repeat(63)); };
const B = (t) => log('\n【' + t + '】'); void B;

function finding(sev, title, evidence) {
  OUT.findings.push({ sev, title, evidence });
  const icon = { high: '🔴', med: '🟠', low: '🟡', ok: '✅' }[sev] || '•';
  log(`  ${icon} ${title}`);
  if (evidence) log(`      ↳ ${String(evidence).replace(/\s+/g, ' ').slice(0, 300)}`);
}

(async () => {
  const browser = await chromium.launch();
  // نتصرّف كعميل حقيقي على هاتف — أغلب عملاء المحل من الموبايل
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'ar-EG', timezoneId: 'Africa/Cairo',
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') OUT.errors.push('[console] ' + m.text().slice(0, 200));
    if (m.type() === 'warning' && /error|fail/i.test(m.text())) OUT.errors.push('[warn] ' + m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => OUT.errors.push('[pageerror] ' + String(e.message).slice(0, 200)));
  page.on('response', async (r) => {
    const u = r.url();
    if (/supabase\.co\/(auth|rest)/.test(u) && !/storage/.test(u)) {
      const row = { url: u.replace(/https:\/\/[a-z0-9]+\.supabase\.co/, ''), status: r.status() };
      try { const t = await r.text(); row.body = t.slice(0, 160); } catch { }
      OUT.net.push(row);
    }
  });

  const txt = () => page.innerText('body').catch(() => ''); void txt;
  const vis = (sel) => page.isVisible(sel).catch(() => false); void vis;
  const shot = (n) => page.screenshot({ path: `${SHOT}/${n}.png`, fullPage: false });

  // ═══ 1) أول ما يراه الزائر ═══
  h('1) أول انطباع: ماذا يرى الزائر لحظة فتح الموقع؟');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await shot('01-first-paint');
  const overlayOpen = await page.evaluate(() => {
    const o = document.getElementById('loginOverlay');
    return o ? getComputedStyle(o).display !== 'none' : null;
  });
  const header = await page.innerText('#appHeader').catch(() => '');
  const modalTxt = (await page.innerText('#loginInner').catch(() => '')).replace(/\s+/g, ' ');
  finding(overlayOpen ? 'high' : 'ok',
    overlayOpen ? 'أول ما يراه الزائر: شاشة تسجيل دخول تغطي الموقع كله' : 'أول ما يراه الزائر: صفحة ترحيب',
    'نص الشاشة الأولى: ' + modalTxt.slice(0, 160));
  finding(/تسجيل|دخول|حساب/.test(header) ? 'ok' : 'med',
    'هل يوجد زر «تسجيل/دخول» ظاهر في الشريط العلوي؟',
    'الشريط: ' + header.replace(/\s+/g, ' ').slice(0, 140));
  log('  ℹ️ نص الشاشة الأولى الكامل:\n     ' + modalTxt.slice(0, 400));

  // ═══ 2) تسجيل حساب جديد: هل يحدث أي شيء؟ ═══
  h('2) «أنشئ حساب» — أشهر شكوى: الزر يبدو بلا مفعول');
  const tabReg = await page.$('#tabRegister');
  if (tabReg) {
    await tabReg.click(); await page.waitForTimeout(500);
    await shot('02-register-tab');
    finding('ok', 'تبويب «حساب جديد» يفتح فعلًا', (await page.innerText('#paneRegister')).replace(/\s+/g, ' ').slice(0, 120));
  } else finding('high', 'لا يوجد تبويب «حساب جديد» في هذه الحالة');

  // (2-أ) تحقّق تجريبي بلا لمس القاعدة: كلمة مرور قصيرة يجب أن تُظهر رسالة خطأ
  const beforeErr = await page.evaluate(() => {
    const e = document.getElementById('loginError');
    return e ? { text: e.textContent, display: getComputedStyle(e).display, inVisiblePane: !!e.closest('#paneLogin') && getComputedStyle(e.closest('#paneLogin')).display !== 'none' } : null;
  });
  await page.fill('#reg-username', 'عميل تجربة');
  await page.fill('#reg-name2', 'عميل تجربة');
  await page.fill('#reg-email', 'not-an-email');
  await page.fill('#reg-pass2', '123');           // أقل من 6 ⇒ يجب رسالة
  await page.click('button:has-text("إنشاء الحساب")');
  await page.waitForTimeout(1200);
  await shot('03-after-bad-submit');
  const afterErr = await page.evaluate(() => {
    const e = document.getElementById('loginError');
    if (!e) return null;
    const pane = e.closest('#paneLogin');
    return {
      text: e.textContent.trim(),
      display: getComputedStyle(e).display,
      paneVisible: pane ? getComputedStyle(pane).display !== 'none' : null,
      registerVisible: getComputedStyle(document.getElementById('paneRegister')).display !== 'none',
    };
  });
  finding(
    afterErr && afterErr.display !== 'none' && afterErr.paneVisible !== false ? 'ok' : 'high',
    'ضغط الزر بمدخلات خاطئة ⇒ هل يرى المستخدم سبب الفشل؟',
    JSON.stringify(afterErr),
  );
  log(`  ℹ️ قبل الضغط: ${JSON.stringify(beforeErr)}`);
  log(`  ℹ️ بعد الضغط: ${JSON.stringify(afterErr)}`);
  finding(afterErr && afterErr.registerVisible && afterErr.paneVisible === false ? 'high' : 'ok',
    'موضع رسالة الخطأ: هل هي داخل التبويب الذي ينظر إليه المستخدم؟',
    afterErr && afterErr.paneVisible === false
      ? '❌ الرسالة تُكتب في عنصر داخل تبويب «دخول» المخفي ⇒ المستخدم لا يراها إطلاقًا'
      : 'موضعها سليم');

  // ═══ 3) دخول فعلي كعميل ═══
  h('3) دخول فعلي بحساب عميل — ثم تجربة المتجر');
  const email = fs.readFileSync('/tmp/ux_email', 'utf8').trim();
  // نعود لتبويب الدخول
  await page.click('#tabLogin').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('#cl-email', email);
  await page.fill('#cl-pass', 'Test12345');
  await shot('04-login-filled');
  await page.click('#paneLogin button.btn-primary');
  await page.waitForTimeout(7000);
  await shot('05-after-login');
  const afterLogin = await page.evaluate(() => {
    const o = document.getElementById('loginOverlay');
    return {
      overlay: o ? getComputedStyle(o).display : null,
      role: (document.getElementById('roleChip') || {}).textContent || '',
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
    };
  });
  log('  ℹ️ بعد الدخول: ' + JSON.stringify(afterLogin).slice(0, 400));
  finding(afterLogin.overlay === 'none' ? 'ok' : 'high',
    afterLogin.overlay === 'none' ? 'الدخول نجح واختفى حاجب الدخول' : 'الدخول لم يُغلق شاشة الدخول',
    'شارة الدور: ' + afterLogin.role);

  // ما الشاشات المتاحة للعميل في القائمة؟
  await page.evaluate(() => { const b = document.getElementById('burgerBtn'); if (b) b.click(); });
  await page.waitForTimeout(600);
  await shot('06-burger-customer');
  let burger = '';
  try { burger = await page.innerText('#burgerMenu'); }
  catch { try { burger = await page.innerText('.burger-menu'); } catch { burger = ''; } }
  log('  ℹ️ قائمة العميل: ' + burger.replace(/\s+/g, ' ').slice(0, 300));

  // ═══ 4) تصفّح المتجر ═══
  h('4) تصفّح المتجر كمستخدم عادي');
  await page.keyboard.press('Escape').catch(() => { });
  await page.evaluate(() => { if (typeof closeBurger === 'function') closeBurger(); });
  await page.evaluate(() => setView('shop'));
  await page.waitForTimeout(2500);
  await shot('07-shop');
  const shopInfo = await page.evaluate(() => ({
    cards: document.querySelectorAll('.shop-card').length,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
  }));
  log('  ℹ️ ' + JSON.stringify(shopInfo).slice(0, 400));
  finding(shopInfo.cards > 0 ? 'ok' : 'high', `عدد بطاقات المنتجات المعروضة: ${shopInfo.cards}`, shopInfo.text);

  // ═══ 5) صفحة المنتج: ماذا يرى العميل؟ ═══
  h('5) صفحة المنتج — «هل يرى العميل بيانات داخلية؟»');
  const opened = await page.evaluate(() => {
    const c = document.querySelector('.shop-card');
    if (!c) return null;
    c.click(); return true;
  });
  await page.waitForTimeout(2000);
  await shot('08-product-as-customer');
  const pd = await page.evaluate(() => {
    const card = document.getElementById('productDetailCard');
    const text = card ? card.innerText.replace(/\s+/g, ' ') : '';
    const btns = [...document.querySelectorAll('#productDetailCard button')].map(b => b.innerText.trim()).filter(Boolean);
    return { text, btns };
  });
  log('  ℹ️ نص صفحة المنتج:\n     ' + pd.text.slice(0, 900));
  log('  ℹ️ أزرار الصفحة: ' + JSON.stringify(pd.btns));
  finding(opened ? 'ok' : 'high', 'بطاقة المنتج تُفتح من المتجر', opened ? '' : 'لم أجد بطاقة');

  const leaked = [];
  if (/تنبيه عند/.test(pd.text)) leaked.push('حد التنبيه للمخزون (min_alert)');
  if (/إجمالي المخزن/.test(pd.text)) leaked.push('إجمالي المخزن الحقيقي');
  if (/قيمة المخزن/.test(pd.text)) leaked.push('قيمة المخزن بالجنيه');
  if (/قيمة|المعروض:/.test(pd.text) && /ج\.م/.test(pd.text)) leaked.push('قيمة المعروض للبيع');
  finding(leaked.length ? 'high' : 'ok',
    leaked.length ? 'بيانات داخلية ظاهرة للعميل في صفحة المنتج' : 'لا بيانات داخلية في صفحة المنتج',
    leaked.join(' · '));
  const editBtn = pd.btns.some(b => /تعديل/.test(b));
  const workerBtn = pd.btns.some(b => /سعر|خصم|جرد|فاتورة/.test(b));
  finding(editBtn ? 'high' : 'ok', editBtn ? 'زر «✏️ تعديل» ظاهر للعميل' : 'زر التعديل مخفي عن العميل', pd.btns.join(' · '));
  if (workerBtn) finding('med', 'أزرار تشغيلية أخرى ظاهرة للعميل', pd.btns.join(' · '));
  // هل الزر يعمل أصلًا لو ضُغط (أي هل يوجد حماية فعليًا)؟
  if (editBtn) {
    await page.click('#productDetailCard button:has-text("تعديل")').catch(() => { });
    await page.waitForTimeout(1200);
    const afterEdit = await page.evaluate(() => ({
      modal: !!document.querySelector('.modal-overlay[style*="flex"], .modal-overlay.open'),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
    }));
    await shot('09-edit-clicked-by-customer');
    finding(afterEdit.modal ? 'med' : 'ok',
      afterEdit.modal ? 'الزر يفتح نافذة التعديل للعميل (أي الحماية في مكان آخر فقط)' : 'الزر لا يفتح شيئًا (مرفوض بالصلاحيات)',
      afterEdit.text);
  }

  // ═══ 6) السلة ═══
  h('6) السلة والإجماليات');
  await page.evaluate(() => { if (typeof closeProductDetail === 'function') closeProductDetail(); });
  await page.evaluate(() => { const b = document.querySelector('.amz-btn-cart'); if (b) b.click(); });
  await page.waitForTimeout(2500);
  await shot('10-cart');
  const cart = await page.evaluate(() => {
    const ov = document.querySelector('.cart-overlay');
    return {
      open: ov ? getComputedStyle(ov).display !== 'none' : false,
      text: (ov ? ov.innerText : '').replace(/\s+/g, ' ').slice(0, 600),
      btns: ov ? [...ov.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean) : [],
    };
  });
  log('  ℹ️ السلة: ' + JSON.stringify(cart).slice(0, 800));
  finding(cart.open ? 'ok' : 'high', cart.open ? 'السلة تُفتح بعد الإضافة' : 'السلة لم تُفتح', cart.text.slice(0, 200));
  finding(/ج\.م/.test(cart.text) ? 'ok' : 'med', 'الإجماليات ظاهرة في السلة', cart.text.slice(0, 200));

  // ═══ 7) خلاصة الأخطاء والشبكة ═══
  h('7) أخطاء جافاسكربت وطلبات السحابة');
  const realErr = OUT.errors.filter(e => !/abort|ERR_FAILED|Failed to fetch|net::|favicon|404/i.test(e));
  log('  طلبات Supabase:');
  OUT.net.slice(0, 14).forEach(n => log(`    ${n.status} ${n.url}  ${n.body ? '→ ' + n.body.slice(0, 90) : ''}`));
  log('  أخطاء حقيقية: ' + (realErr.length ? realErr.length : 'لا شيء'));
  realErr.slice(0, 8).forEach(e => log('    ✗ ' + e));
  finding(realErr.length ? 'med' : 'ok', `أخطاء جافاسكربت: ${realErr.length}`, realErr.slice(0, 3).join(' | '));

  fs.writeFileSync('/tmp/audit-out.json', JSON.stringify(OUT, null, 2));
  h('خلاصة التدقيق');
  ['high', 'med', 'low'].forEach(s => {
    const rows = OUT.findings.filter(f => f.sev === s);
    if (!rows.length) return;
    log(`\n${s === 'high' ? '🔴 حرج' : s === 'med' ? '🟠 مهم' : '🟡 بسيط'} (${rows.length}):`);
    rows.forEach(f => log('  • ' + f.title));
  });
  log(`\n  ✅ اللقطات: ${SHOT}`);
  await browser.close();
})().catch(e => { console.error('❌ فشل التدقيق:', e.message); process.exit(1); });

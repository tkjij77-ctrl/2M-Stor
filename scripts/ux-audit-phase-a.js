// 🧪 تدقيق مرحلة (أ): صفحة الترحيب · إصلاح التسجيل · إزالة الحساب المحلي · بوابة الصلاحيات
const { chromium } = require('playwright');
const log = console.log;
const R = []; const ok = (n, c, d='') => { R.push([c, n, d]); log(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };
const S = '/home/user/audit-shots';
const URL = 'http://127.0.0.1:8123/index.html?v=' + Date.now();

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, serviceWorkers:'block' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0,140)));
  await p.goto(URL, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(9000);

  // ═══ ١) الزائر: صفحة ترحيب لا شاشة تسجيل ═══
  const v = await p.evaluate(() => ({
    overlay: getComputedStyle(document.getElementById('loginOverlay')).display,
    home: getComputedStyle(document.getElementById('homeView')).display,
    hero: (document.querySelector('.hero h1')||{}).innerText || '',
    authBtn: (() => { const b = document.getElementById('authHeaderBtn'); return b ? { text: b.innerText.trim(), vis: b.offsetParent !== null } : null; })(),
    cards: document.querySelectorAll('#homeView .shop-card').length,
    stats: [...document.querySelectorAll('.hero-stats .stat h3')].map(e => e.innerText),
    menuHidden: ['burger-stock','burger-dash','burger-invoices','burger-settings','burger-users','burger-export','burger-import','burger-pass','burger-logout']
      .map(id => { const e = document.getElementById(id); return e ? e.offsetParent !== null : null; }),
    localFns: { doLogin: typeof window.doLogin, quickCustomer: typeof window.quickCustomer, createFirstLocalAdmin: typeof window.createFirstLocalAdmin, doRegister: typeof window.doRegister, forceLocalLogin: typeof window.forceLocalLogin },
    factoryDb: typeof window.getDefaultDB,
  }));
  ok('الزائر يرى صفحة الترحيب (لا حاجب تسجيل)', v.overlay === 'none' && v.home !== 'none', `overlay=${v.overlay} home=${v.home}`);
  ok('العنوان الترحيبي ظاهر', /2M-Stor/.test(v.hero), v.hero.replace(/\s+/g,' ').slice(0,50));
  ok('زر التسجيل أعلى الصفحة ظاهر للزائر', !!(v.authBtn && v.authBtn.vis), v.authBtn ? v.authBtn.text : 'مفقود');
  ok('منتجات صفحة الترحيب من السحابة', v.cards > 0, `${v.cards} بطاقة · إحصاءات ${JSON.stringify(v.stats)}`);
  ok('قائمة الزائر بلا بنود إدارية', v.menuHidden.every(x => x === false), JSON.stringify(v.menuHidden));
  ok('دوال الحساب المحلي مُزالة فعلًا', v.localFns.doLogin === 'undefined' && v.localFns.quickCustomer === 'undefined' && v.localFns.createFirstLocalAdmin === 'undefined' && v.localFns.doRegister === 'undefined' && v.localFns.forceLocalLogin === 'undefined', JSON.stringify(v.localFns));
  ok('قاعدة البيانات المضمَّنة حُذفت', v.factoryDb === 'undefined', `getDefaultDB=${v.factoryDb}`);
  await p.screenshot({ path: S + '/60-visitor-landing.png' });

  // ═══ ٢) تصفّح بدون حساب ═══
  await p.evaluate(() => setView('shop')); await p.waitForTimeout(2500);
  const shop = await p.evaluate(() => ({ cards: document.querySelectorAll('#appContent .shop-card').length, chip: (document.querySelector('.cat-chip')||{}).innerText, title: (document.getElementById('sectionTitle')||{}).innerText.replace(/\s+/g,' ') }));
  ok('الزائر يتصفّح المتجر', shop.cards > 0, `${shop.cards} بطاقة · ${shop.title}`);
  await p.screenshot({ path: S + '/61-visitor-shop.png' });

  // ═══ ٣) صفحة المنتج للزائر: بلا تعديل وبلا أرقام مخزون ═══
  await p.evaluate(() => { const c = [...document.querySelectorAll('#appContent .shop-card')].find(x => x.offsetParent !== null && /متوفر|آخر|غير متوفر/.test(x.innerText)); c.click(); });
  await p.waitForTimeout(1800);
  const pd = await p.evaluate(() => {
    const t = document.getElementById('productDetailCard').innerText.replace(/\s+/g,' ');
    const edit = [...document.querySelectorAll('#productDetailCard button')].find(b => /تعديل/.test(b.innerText));
    return { open: document.getElementById('productDetailCard').offsetParent !== null, text: t,
      editVisible: edit ? edit.offsetParent !== null : false,
      hasStockNumbers: /المخزن:\s*\d|قيمة المخزن|المعروض:\s*\d|تنبيه عند/.test(t) };
  });
  ok('صفحة المنتج تُفتح للزائر', pd.open);
  ok('زر «✏️ تعديل» مخفي عن الزائر', !pd.editVisible);
  ok('لا أرقام مخزون/قيمة للزائر', !pd.hasStockNumbers, pd.text.match(/الحالة: [^·]+|متوفر[^·]*/)?.[0] || '');
  await p.screenshot({ path: S + '/62-visitor-product.png' });
  await p.evaluate(() => closeProductDetail());

  // ═══ ٤) الإصلاح الجذري: رسالة خطأ مرئية في تبويب التسجيل ═══
  await p.click('#authHeaderBtn'); await p.waitForTimeout(900);
  await p.evaluate(() => switchLoginTab('register')); await p.waitForTimeout(400);
  await p.click('#btnCloudRegister'); await p.waitForTimeout(900);
  const regMsg = await p.evaluate(() => {
    const e = document.getElementById('loginError');
    const pane = document.getElementById('paneRegister');
    return { text: e ? e.innerText.trim() : '', vis: !!(e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'), paneVis: !!(pane && pane.offsetParent !== null), insidePane: e ? pane.contains(e) : null };
  });
  ok('رسالة التسجيل مرئية أثناء تبويب «حساب جديد»', regMsg.vis && regMsg.text.length > 3 && !regMsg.insidePane, `${regMsg.text} · داخل التبويب=${regMsg.insidePane}`);
  await p.screenshot({ path: S + '/63-register-error-visible.png' });

  // ═══ ٥) رسالة إيميل غير صحيح ═══
  await p.fill('#reg-username','زبون اختبار'); await p.fill('#reg-email','not-an-email'); await p.fill('#reg-pass2','123456');
  await p.click('#btnCloudRegister'); await p.waitForTimeout(900);
  const badEmail = await p.evaluate(() => (document.getElementById('loginError')||{}).innerText.trim());
  ok('رسالة إيميل غير صحيح', /إيميل صحيح/.test(badEmail), badEmail);

  // ═══ ٦) تسجيل حقيقي ثم اختبار العميل ═══
  const email = 'pha-' + Date.now() + '@example.com';
  require('fs').writeFileSync('/tmp/phase_a_email', email);
  await p.fill('#reg-email', email); await p.fill('#reg-pass2','Test12345'); await p.fill('#reg-name2','زبون المرحلة أ');
  await p.click('#btnCloudRegister'); await p.waitForTimeout(9000);
  const after = await p.evaluate(() => ({ overlay: getComputedStyle(document.getElementById('loginOverlay')).display, user: typeof sessionUser !== 'undefined' ? sessionUser : null, role: typeof sessionRole !== 'undefined' ? sessionRole : null,
    authBtnVis: (() => { const b = document.getElementById('authHeaderBtn'); return b ? b.offsetParent !== null : null; })(), ok: (document.getElementById('loginOk')||{}).innerText }));
  ok('التسجيل يعمل وينشئ جلسة سحابية', after.overlay === 'none' && after.role === 'customer', JSON.stringify(after));
  ok('زر التسجيل يختفي بعد الدخول', after.authBtnVis === false);
  await p.screenshot({ path: S + '/64-after-register.png' });

  // ═══ ٧) العميل: لا يصل لصفحة المخزن ═══
  await p.evaluate(() => setView('stock')); await p.waitForTimeout(1200);
  const cust = await p.evaluate(() => ({ view: currentView, menu: ['burger-stock','burger-dash','burger-invoices','burger-settings','burger-users','burger-export','burger-import'].map(id => { const e=document.getElementById(id); return e ? e.offsetParent !== null : null; }),
    toast: [...document.querySelectorAll('.toast, [class*=toast]')].map(t => t.innerText.trim()).filter(Boolean).join(' | ') }));
  ok('العميل يُمنع من صفحة المخزن', cust.view !== 'stock', `view=${cust.view} · الرسالة: ${cust.toast}`);
  ok('بنود القائمة الإدارية مخفية عن العميل', cust.menu.every(x => x === false), JSON.stringify(cust.menu));

  // ═══ ٨) محاكاة عامل/مدير: الأرقام والزر تظهر ═══
  await p.evaluate(() => { sessionRole = 'admin'; applyRoleUI(); });
  await p.evaluate(() => { setView('shop'); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const c = [...document.querySelectorAll('#appContent .shop-card')].find(x => x.offsetParent !== null); c.click(); });
  await p.waitForTimeout(1500);
  const staffPd = await p.evaluate(() => {
    const t = document.getElementById('productDetailCard').innerText.replace(/\s+/g,' ');
    const edit = [...document.querySelectorAll('#productDetailCard button')].find(b => /تعديل/.test(b.innerText));
    return { editVisible: edit ? edit.offsetParent !== null : false, hasStock: /المخزن:\s*\d|قيمة المخزن/.test(t) };
  });
  ok('العامل/المدير يرى «✏️ تعديل»', staffPd.editVisible);
  ok('العامل/المدير يرى أرقام المخزون', staffPd.hasStock);
  await p.screenshot({ path: S + '/65-staff-product.png' });

  // ═══ ٩) QR في الإيصال ═══
  await p.evaluate(() => { sessionRole = 'customer'; applyRoleUI(); closeProductDetail(); });
  await p.evaluate(() => { setView('shop'); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const c = [...document.querySelectorAll('#appContent .shop-card')].find(x => x.offsetParent !== null && /متوفر|آخر/.test(x.innerText)); c.click(); });
  await p.waitForTimeout(1200);
  await p.click('#productDetailCard .amz-btn-cart'); await p.waitForTimeout(1800);
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('.cart-overlay button')].find(x => x.innerText.includes('إنشاء الفاتورة')); b2.click(); });
  await p.waitForTimeout(7000);
  const qr = await p.evaluate(() => [...document.querySelectorAll('.receipt-copy [id^="qrcode-"]')].map(e => {
    const cv = e.querySelector('canvas'); let dark = 0;
    if (cv) { const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; for (let i=0;i<d.length;i+=4) if (d[i+3]>10 && d[i]<128) dark++; }
    return { w: e.offsetWidth, canvas: !!cv, dark };
  }));
  ok('رمز QR مرسوم في نسختَي الإيصال', qr.length === 2 && qr.every(x => x.dark > 100), JSON.stringify(qr));
  await p.screenshot({ path: S + '/66-receipt-qr-fixed.png' });

  ok('لا أخطاء جافاسكربت', errs.length === 0, errs.slice(0,3).join(' | '));
  const pass = R.filter(r => r[0]).length;
  log(`\n═══ النتيجة: ${pass}/${R.length} ناجح ═══`);
  if (pass < R.length) { log('الفاشلة:'); R.filter(r => !r[0]).forEach(r => log('  ❌ ' + r[1] + ' — ' + r[2])); }
  require('fs').writeFileSync('/tmp/phase-a-result.json', JSON.stringify(R, null, 1));
  await b.close();
})().catch(e => { log('💥 خطأ في السكربت: ' + e.message); process.exit(1); });

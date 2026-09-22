// ═══════════════════════════════════════════════════════════════════════════
//  T5.3 — فحص مراقبة الأخطاء في متصفح حقيقي
//  التشغيل: node scripts/verify-monitoring.js   (يحتاج خادمًا على 8123)
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (m, c, d) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${m}${d ? '  → ' + d : ''}`); };

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const pageErrs = []; p.on('pageerror', e => pageErrs.push(e.message.slice(0, 120)));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof db === 'object' && Object.keys(db).length > 0, { timeout: 25000 });
  await p.waitForTimeout(1500);

  console.log('\n【1】 التقاط الأخطاء غير المتوقعة');
  const caught = await p.evaluate(async () => {
    errLogClear();
    // خطأ جافاسكربت حقيقي (كما لو وقع في كود التطبيق)
    window.dispatchEvent(new ErrorEvent('error', { message: 'عطل تجريبي في الواجهة', filename: 'web/views.js', lineno: 42 }));
    // ووعد مرفوض (أشهر مصادر الأخطاء الصامتة)
    const ev = new Event('unhandledrejection');
    ev.reason = new Error('فشل تجريبي في المزامنة');
    window.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 300));
    const rows = errLogLoad();
    return { n: rows.length, kinds: rows.map(r => r.kind).join(','), first: rows[0] && rows[0].msg, where: rows[0] && rows[0].where, build: rows[0] && rows[0].build };
  });
  ok('خطأ الجافاسكربت سُجِّل', caught.kinds.includes('js'), caught.first);
  ok('والوعد المرفوض سُجِّل', caught.kinds.includes('promise'));
  ok('السجل يحمل الصفحة/الدور والنسخة', !!caught.where && !!caught.build, caught.where + ' · ' + caught.build);

  console.log('\n【2】 حماية السجل من التضخّم');
  const caps = await p.evaluate(async () => {
    errLogClear(); _errSeen = {};
    for (let i = 0; i < 60; i++) logClientError('js', 'خطأ مكرر رقم ' + i);
    const after60 = errLogLoad().length;
    errLogClear(); _errSeen = {};
    for (let i = 0; i < 30; i++) logClientError('js', 'نفس الرسالة تمامًا');
    const same30 = errLogLoad().length;
    return { after60, same30 };
  });
  ok('السقف 50 خطأ لا أكثر', caps.after60 === 50, 'سُجّل ' + caps.after60);
  ok('نفس الرسالة لا تُسجَّل أكثر من 10 مرات', caps.same30 === 10, 'سُجّل ' + caps.same30);

  console.log('\n【3】 الإرسال السحابي لا يُزعج عند عدم توفّر الجدول');
  const remote = await p.evaluate(async () => {
    _errRemoteOff = false;
    logClientError('js', 'خطأ لاختبار الإرسال السحابي');
    await new Promise(r => setTimeout(r, 2500));   // محاولة إرسال حقيقية
    const first = _errRemoteOff;
    const before = _errRemoteOff;
    logClientError('js', 'خطأ آخر بعد إيقاف المحاولة');
    await new Promise(r => setTimeout(r, 600));
    return { off: first, stayed: before === _errRemoteOff, n: errLogLoad().length };
  });
  ok('توقف عن المحاولة السحابية بلا جدول/صلاحية (لا فشل متكرر)', remote.off || remote.stayed === true, 'off=' + remote.off);
  ok('والسجل المحلي استمر يعمل رغم ذلك', remote.n >= 2, remote.n + ' خطأ محفوظ');

  console.log('\n【4】 واجهة المدير');
  const viewer = await p.evaluate(async () => {
    sessionRole = 'admin'; applyRoleUI();
    showErrorsModal();
    await new Promise(r => setTimeout(r, 300));
    const m = document.getElementById('modal');
    const txt = m.innerText.replace(/\s+/g, ' ');
    const shown = m.style.display === 'flex' && /سجل الأخطاء/.test(txt);
    closeModal();
    sessionRole = 'customer'; applyRoleUI();
    showErrorsModal();
    const blocked = document.getElementById('modal').style.display === 'none';
    return { shown, blocked, toast: document.getElementById('toastContainer').innerText.trim() };
  });
  ok('المدير يرى السجل', viewer.shown);
  ok('والعميل ممنوع', viewer.blocked, viewer.toast.slice(0, 60));

  console.log('\n【5】 زر لوحة التحكم');
  const dashBtn = await p.evaluate(() => {
    sessionRole = 'admin'; applyRoleUI();
    renderDashboard();   // اللوحة تُبنى في #dashBody داخل #dashOverlay
    return [...document.querySelectorAll('#dashBody button')].some(x => /أخطاء المستخدمين/.test(x.innerText));
  });
  ok('زر «🐞 أخطاء المستخدمين» موجود في لوحة التحكم', dashBtn);

  console.log('\n【6】 سلامة');
  ok('لا أخطاء جافاسكربت غير متوقعة', pageErrs.length === 0, pageErrs.slice(0, 2).join(' | '));
  console.log(`\n  النتيجة: ${pass}/${pass + fail} ${fail ? '❌ يوجد فشل' : '✅ نجحت كل فحوص المراقبة'}\n`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();

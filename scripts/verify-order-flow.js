// ═══════════════════════════════════════════════════════════════════════════
//  T4.4 — فحص رحلة الطلب للعميل: من السلة إلى تأكيد الطلب وواتساب المحل
//  التشغيل: node scripts/verify-order-flow.js   (يحتاج خادمًا على 8123)
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (m, c, d) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${m}${d ? '  → ' + d : ''}`); };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof db === 'object' && Object.keys(db).length > 0, { timeout: 25000 });
  await p.waitForTimeout(1800);

  console.log('\n【1】 إعداد الطلب: عميل + رقم واتساب للمحل');
  const seed = await p.evaluate(async () => {
    // db مصفوفة أقسام (كل قسم: { name, items:[{ n, p, qs }] })
    const SEED = [{ name: 'كهربائيات', items: [{ n: 'مفتاح', p: '50', qs: 7 }, { n: 'سلك', p: '30', qs: 3 }] }];
    db = JSON.parse(JSON.stringify(SEED)); ensureLids();
    settings.phone = '01012345678'; settings.store = '2M-Stor';
    sessionRole = 'customer'; sessionUser = 'زبون تجربة'; applyRoleUI(); renderAll();
    setView('shop'); await new Promise(r => setTimeout(r, 800));
    addToCart(0, 0); addToCart(0, 1);
    await new Promise(r => setTimeout(r, 500));
    return { cart: cartCount(), wa: waNumber(settings.phone) };
  });
  ok('العميل أضاف صنفين للسلة', seed.cart === 2, 'السلة: ' + seed.cart);
  ok('رقم المحل يُطبَّع للصيغة الدولية (01… → 20…)', seed.wa === '201012345678', seed.wa);

  console.log('\n【2】 نص الطلب الذي يوصل للمحل');
  const msg = await p.evaluate(() => decodeURIComponent(orderWaLink({
    no: 1007, customer: 'أحمد', items: [{ name: 'مفتاح', qty: 2 }, { name: 'سلك', qty: 1 }], total: 130,
  })));
  ok('يحمل رقم الطلب', /#1007/.test(msg), (msg.match(/طلب جديد[^\n]*/) || [])[0]);
  ok('فيه الأصناف والكميات', /مفتاح ×2/.test(msg) && /سلك ×1/.test(msg));
  ok('فيه الإجمالي والدفع عند التسليم', /الإجمالي: 130/.test(msg) && /الدفع: عند التسليم/.test(msg));
  ok('فيه سطر عنوان يكمله العميل (رقمه يصل من واتسابه)', /العنوان:/.test(msg));
  ok('الرابط موجّه لواتساب بالرقم الصحيح', await p.evaluate(() => orderWaLink({ no: 1, items: [], total: 0 }).startsWith('https://wa.me/201012345678?text=')));

  console.log('\n【3】 بطاقة تأكيد الطلب بعد الحفظ');
  await p.evaluate(() => showOrderConfirm({ no: 1007, total: 130, items: [{ name: 'مفتاح', qty: 2 }], status: 'قيد المعالجة' }));
  await p.waitForTimeout(700);
  const card = await p.evaluate(() => {
    const m = document.getElementById('modal');
    return { open: m.style.display === 'flex', text: m.innerText.replace(/\s+/g, ' '),
      wa: !!([...m.querySelectorAll('button')].find(x => /واتساب/.test(x.innerText))) };
  });
  ok('النافذة ظهرت فعلًا', card.open, 'display=' + card.open);
  ok('فيها رقم الطلب والإجمالي والحالة', /#1007/.test(card.text) && /130/.test(card.text) && /قيد المعالجة/.test(card.text));
  ok('وفيها «الدفع عند التسليم»', /عند التسليم/.test(card.text));
  ok('وزر الإرسال على واتساب موجود', card.wa);

  console.log('\n【4】 زر «طلباتي» ينقل فعلًا لتبويب الطلبات');
  await p.evaluate(() => [...document.querySelectorAll('#modal button')].find(x => /طلباتي/.test(x.innerText)).click());
  await p.waitForTimeout(1200);
  const acc = await p.evaluate(() => ({ view: currentView, tab: accTab, modal: document.getElementById('modal').style.display }));
  ok('انتقل إلى صفحة الحساب/تبويب الطلبات', acc.view === 'account' && acc.tab === 'orders', JSON.stringify(acc));
  ok('ونُوافذ التسجيل أُغلقت', acc.modal === 'none');

  console.log('\n【5】 بلا رقم محل: تلميح صريح بدل زر معطّل');
  const noPhone = await p.evaluate(() => {
    closeModal(); settings.phone = ''; showOrderConfirm({ no: 1, total: 10, items: [], status: 'قيد المعالجة' });
    const m = document.getElementById('modal');
    return { wa: !!([...m.querySelectorAll('button')].find(x => /واتساب/.test(x.innerText))), hint: /لتفعيل الإرسال/.test(m.innerText) };
  });
  ok('لا زر واتساب بلا رقم', !noPhone.wa);
  ok('ويظهر كيف يُفعّله المحل', noPhone.hint);

  console.log('\n【6】 سلامة');
  ok('لا أخطاء جافاسكربت', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n  النتيجة: ${pass}/${pass + fail} ${fail ? '❌ يوجد فشل' : '✅ نجحت كل فحوص رحلة الطلب'}\n`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();

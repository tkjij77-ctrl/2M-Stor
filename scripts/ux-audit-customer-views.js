const { chromium } = require('playwright'); const fs=require('fs'); const log=console.log;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'})).newPage();
  await p.goto('http://127.0.0.1:8123/index.html',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6000);
  const email = fs.readFileSync('/tmp/ux_email','utf8').trim();
  await p.fill('#cl-email', email); await p.fill('#cl-pass','Test12345');
  await p.click('#paneLogin button.btn-primary'); await p.waitForTimeout(7000);
  log('الدور بعد الدخول: ' + await p.evaluate(()=>sessionRole) + ' · الاسم: ' + await p.evaluate(()=>sessionUser));

  // ── أ) عناصر القائمة الجانبية للعميل ──
  await p.evaluate(()=>{ document.getElementById('burgerBtn').click(); }); await p.waitForTimeout(700);
  const menu = await p.evaluate(() => {
    const m=document.querySelector('.burger-menu')||document.getElementById('burgerMenu')||document.body;
    return [...m.querySelectorAll('.burger-item, [onclick]')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,30);
  });
  log('عناصر القائمة للعميل: ' + JSON.stringify(menu));
  await p.screenshot({ path:'/home/user/audit-shots/30-customer-menu.png' });
  await p.keyboard.press('Escape'); await p.evaluate(()=>closeBurger()); await p.waitForTimeout(400);

  // ── ب) هل يستطيع العميل فتح صفحة المخزن؟ وما يرى فيها؟ ──
  await p.evaluate(()=>{ try{ setView('stock'); }catch { /* تجاهل */ } }); await p.waitForTimeout(2500);
  const stock = await p.evaluate(() => ({
    view: currentView,
    header: (document.getElementById('appHeader')||{}).innerText?.replace(/\s+/g,' ').slice(0,160),
    hasValue: /قيمة المخزن|قيمة المخزون/.test(document.body.innerText),
    hasEdit: /✏️ تعديل|🗑️|إضافة صنف/.test(document.body.innerText),
    hasMin: /تنبيه عند|حد التنبيه/.test(document.body.innerText),
    sample: document.body.innerText.replace(/\s+/g,' ').slice(0,320),
    statRowVisible: getComputedStyle(document.getElementById('statRow')).display,
  }));
  log('صفحة المخزن للعميل: ' + JSON.stringify(stock, null, 1).slice(0,800));
  await p.screenshot({ path:'/home/user/audit-shots/31-customer-stock-page.png' });

  // ── ج) هل يستطيع العميل إنشاء فاتورة (صلاحية invoice=true)؟ وما معنى ذلك؟ ──
  const inv = await p.evaluate(() => ({ canInvoice: can('invoice'), canHistory: can('history'), canDash: can('dash') }));
  log('صلاحيات العميل: ' + JSON.stringify(inv));

  // ── د) البحث والفرز والتصفية في المتجر ──
  await p.evaluate(()=>setView('shop')); await p.waitForTimeout(2500);
  const shopUI = await p.evaluate(() => {
    const inputs=[...document.querySelectorAll('input')].map(i=>({ph:i.placeholder, type:i.type, id:i.id})).filter(i=>i.ph);
    const selects=[...document.querySelectorAll('select')].map(s=>({id:s.id, opts:[...s.options].map(o=>o.textContent).slice(0,6)}));
    return { searchInputs: inputs.filter(i=>/بحث|search/i.test(i.ph)), allInputs: inputs.slice(0,8), selects,
             filters: document.querySelectorAll('.filter-chip, .chip').length };
  });
  log('أدوات المتجر: ' + JSON.stringify(shopUI, null, 1).slice(0,700));

  // ── هـ) «طلباتي» للعميل ──
  await p.evaluate(()=>setView('account')); await p.waitForTimeout(2500);
  const acc = await p.evaluate(()=>document.getElementById('accountView').innerText.replace(/\s+/g,' ').slice(0,400));
  log('حسابي: ' + acc);
  const tabs = await p.evaluate(()=>[...document.querySelectorAll('#accountView button, #accountView a, #accountView .acc-tab')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,15));
  log('تبويبات حسابي: ' + JSON.stringify(tabs));
  await p.screenshot({ path:'/home/user/audit-shots/32-customer-account.png', fullPage:true });
  await b.close();
})();

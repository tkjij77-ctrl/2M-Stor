const { chromium } = require('playwright');
const SEED = [{ name:'أدوات كهربائية', lid:'L1', cid:1, items:[
  {n:'لمبة LED ٩ واط', p:'45', pn:45, q:40, qs:40, min:5, b:'', img:'', lid:'L1a', cid:11},
  {n:'مفتاح كهرباء مفرد', p:'28', pn:28, q:120, qs:120, min:10, b:'', img:'', lid:'L1b', cid:12}]}];
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ serviceWorkers:'block', viewport:{width:1280,height:900} });
  const p = await c.newPage();
  await p.route('**/*', r => r.request().url().includes('supabase.co') ? r.abort() : r.continue());
  await p.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_users', JSON.stringify([{u:'admin', name:'المدير', role:'admin', p:'x'}]));
    localStorage.setItem('al_sayed_session_user', 'admin');
    localStorage.setItem('al_sayed_settings', JSON.stringify({store_name:'2M-Stor', phone:'01000000001', address:'المنصورة — الدقهلية',
      store_desc:'أدوات ومستلزمات كهربائية أصلية', return_days:14, return_note:'بشرط الفاتورة الأصلية وعدم استخدام الصنف',
      shipping:25, freeShip:150, tax:14, currency:'ج.م'}));
  }, SEED);
  await p.goto('http://127.0.0.1:8123/index.html', {waitUntil:'load'});
  await p.waitForTimeout(2500);
  const gate = await p.evaluate(() => getComputedStyle(document.getElementById('loginScreen')).display);
  console.log('شاشة الدخول:', gate);
  await p.evaluate(() => { closeModal(); openProductDetail(0, 0); });
  await p.waitForTimeout(1200);
  await p.screenshot({ path:'/home/user/product-honest.png' });
  await p.evaluate(() => { closeModal(); showLegal('returns'); });
  await p.waitForTimeout(1000);
  await p.screenshot({ path:'/home/user/legal-returns-app.png' });
  await p.evaluate(() => { closeModal(); showLegal('privacy'); });
  await p.waitForTimeout(800);
  await p.screenshot({ path:'/home/user/legal-privacy-app.png' });
  await b.close(); console.log('✅ 3 لقطات');
})();

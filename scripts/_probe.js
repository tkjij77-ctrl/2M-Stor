const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,150)));
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?probe=1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000});
  await p.waitForTimeout(9000);
  await p.evaluate(()=>setView('shop')); await p.waitForTimeout(3000);

  const state=()=>p.evaluate(()=>({
    cards:document.querySelectorAll('#view-root .shop-card').length,
    shopSort: (typeof shopSort!=='undefined'?shopSort:'—'),
    filter: document.getElementById('stockFilter')?document.getElementById('stockFilter').value:'لا عنصر',
    sortSel: document.getElementById('sortSelect')?document.getElementById('sortSelect').value:'لا عنصر',
    limits: (typeof shopLimit!=='undefined'?shopLimit:'—'),
    total: db.reduce((s,c)=>s+c.items.length,0)
  }));
  console.log('الحالة الابتدائية:', JSON.stringify(await state()));

  console.log('\n── العناصر المتاحة في شريط الفلتر ──');
  console.log(JSON.stringify(await p.evaluate(()=>{
    const bar=document.getElementById('filterRow')||document.getElementById('viewTabs')||document.body;
    return [...bar.querySelectorAll('select,input,button')].slice(0,12).map(e=>({tag:e.tagName,id:e.id||'',txt:(e.innerText||e.placeholder||'').slice(0,22),oc:(e.getAttribute('onchange')||'').slice(0,40),val:(e.value||'').slice(0,12)}));
  })));

  console.log('\n── اختبار الترتيب بالسعر تصاعديًا ──');
  let r = await p.evaluate(async()=>{ const s=document.getElementById('sortSelect'); if(!s) return {err:'لا يوجد #sortSelect'};
    s.value='price-asc'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(x=>setTimeout(x,2500));
    const held=[...document.querySelectorAll('#view-root .shop-card')].slice(0,8).map(c=>({txt:(c.querySelector('.shop-price')||{}).innerText, name:(c.querySelector('.shop-name')||{}).innerText}));
    return { shopSort, sortSel:s.value, held }; });
  console.log('  shopSort الآن:', r.shopSort, '| قيمة القائمة:', r.sortSel);
  console.log('  أول ٨ بطاقات:', JSON.stringify(r.held));

  console.log('\n── اختبار فلتر «غير المتوفر» ──');
  r = await p.evaluate(async()=>{ const f=document.getElementById('stockFilter'); if(!f) return {err:'لا يوجد #stockFilter'};
    f.value='out'; f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(x=>setTimeout(x,2500));
    const cards=[...document.querySelectorAll('#view-root .shop-card')];
    return { filter:f.value, n:cards.length, first:cards.slice(0,3).map(c=>({n:(c.querySelector('.shop-name')||{}).innerText, a:(c.querySelector('.shop-avail')||{}).innerText, cart:(c.querySelector('.cart-add')||{}).innerText})) }; });
  console.log('  ', JSON.stringify(r).slice(0,400));

  console.log('\n── هل يظهر «عرض المزيد» ويوسّع حتى 229؟ ──');
  r = await p.evaluate(async()=>{ const f=document.getElementById('stockFilter'); f.value='all'; f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(x=>setTimeout(x,1200));
    let n=0; for(let i=0;i<14;i++){ const b=[...document.querySelectorAll('button')].find(x=>/عرض المزيد/.test(x.innerText)); if(!b) break; b.click(); n++; await new Promise(x=>setTimeout(x,700)); }
    return { clicks:n, cards:document.querySelectorAll('#view-root .shop-card').length, title:document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,55) }; });
  console.log('  ', JSON.stringify(r));

  console.log('\n── الرئيسية: منتجات مميزة ──');
  r = await p.evaluate(async()=>{ setView('home'); await new Promise(x=>setTimeout(x,2200));
    const hv=document.getElementById('homeView');
    return { hero:!!hv.querySelector('.hero'), cards:hv.querySelectorAll('.shop-card').length, names:[...hv.querySelectorAll('.shop-name')].map(x=>x.innerText).slice(0,6), cta:[...hv.querySelectorAll('button')].map(x=>x.innerText.trim()).slice(0,5), height:document.documentElement.scrollHeight }; });
  console.log('  ', JSON.stringify(r).slice(0,400));

  console.log('\n── المخزن: البطاقة نفسها تفتح التعديل؟ ──');
  r = await p.evaluate(async()=>{ setView('stock'); await new Promise(x=>setTimeout(x,2500));
    const c=document.querySelector('.product-card'); const oc=c?c.getAttribute('onclick'):null;
    c.click(); await new Promise(x=>setTimeout(x,900));
    return { onclick:oc, modal:document.getElementById('modal').style.display, price:!!document.getElementById('modal-price'), name:(document.getElementById('modal-name')||{}).value }; });
  console.log('  ', JSON.stringify(r).slice(0,300));

  await b.close();
  console.log('\nأخطاء JS:', errs.length?JSON.stringify(errs.slice(0,3)):'صفر ✅');
})();

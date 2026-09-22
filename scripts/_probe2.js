const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})).newPage();
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?probe=2&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await p.waitForTimeout(8000);
  await p.evaluate(()=>setView('shop')); await p.waitForTimeout(2500);
  const r = await p.evaluate(async()=>{
    const cards=[...document.querySelectorAll('#view-root .shop-card')];
    const labels=[...new Set(cards.map(c=>(c.querySelector('.shop-avail')||{}).innerText||''))];
    const avail=cards.find(c=>/متوفر ✅/.test((c.querySelector('.shop-avail')||{}).innerText||''));
    avail.click(); await new Promise(x=>setTimeout(x,1800));
    const ov=document.getElementById('productDetailOverlay');
    return { labels,
      ovText: ov.innerText.replace(/\s+/g,' '),
      btns: [...ov.querySelectorAll('button')].map(x=>x.innerText.trim()).filter(Boolean),
      numbers: (ov.innerText.match(/\d+/g)||[]).slice(0,12) };
  });
  console.log('وسوم التوفر في الصفحة:', JSON.stringify(r.labels));
  console.log('\nنص تفاصيل المنتج للعميل:\n', r.ovText.slice(0,700));
  console.log('\nأزرار النافذة:', JSON.stringify(r.btns));
  console.log('\nأرقام ظاهرة في النافذة:', JSON.stringify(r.numbers));
  await b.close();
})();

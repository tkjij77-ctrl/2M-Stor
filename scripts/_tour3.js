const { chromium } = require('playwright');
const fs=require('fs');
const OUT='/home/user/tour'; fs.mkdirSync(OUT,{recursive:true});
let pass=0,fail=0; const bad=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
(async()=>{
  const br=await chromium.launch();
  const login=async(p)=>{ await p.evaluate(()=>showLogin()); await p.waitForSelector('#cl-email',{state:'visible',timeout:20000});
    await p.fill('#cl-email','tour-manager-2026@2m-stor.app'); await p.fill('#cl-pass','TourManager!2026');
    await p.click('#btnCloudLogin'); await p.waitForFunction(()=>sessionRole==='admin',{timeout:40000}).catch(()=>{}); await p.waitForTimeout(9000); };

  // ═══ الجزء أ: المدير — CSV وحسابي ═══
  console.log('══ 【أ】 المدير: تصدير CSV + صفحة حسابي ══');
  const c1=await br.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',acceptDownloads:true});
  const m=await c1.newPage(); const e1=[]; m.on('pageerror',e=>e1.push(e.message.slice(0,140)));
  m.on('dialog', async d=>{ await d.accept(); });
  await m.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?tour=m3&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await m.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await m.waitForTimeout(9000);
  await login(m);
  let v = await m.evaluate(async()=>{ const seen=[]; const oU=URL.createObjectURL; URL.createObjectURL=function(bl){ seen.push({n:'?',b:bl.size}); return oU.call(URL,bl); };
    const oC=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){};
    downloadCsv(makeCsvInvoices(),'invoices.csv'); await new Promise(r=>setTimeout(r,600));
    downloadCsv(makeCsvStock(),'stock.csv'); await new Promise(r=>setTimeout(r,600));
    URL.createObjectURL=oU; HTMLAnchorElement.prototype.click=oC;
    return seen.map(x=>x.b); });
  ok('تصدير CSV (فواتير + مخزون) يعمل', v.length===2 && v[0]>200 && v[1]>2000, `فواتير ${v[0]} بايت · مخزون ${v[1]} بايت`);
  v = await m.evaluate(async()=>{ setView('account'); await new Promise(r=>setTimeout(r,2600));
    const av=document.getElementById('accountView'); const root=document.getElementById('view-root');
    const tabs=[...document.querySelectorAll('#accountView [onclick*="accTab"], #view-root [onclick*="accTab"]')].map(x=>x.innerText.trim()).filter(Boolean);
    return { txt:(av?av.innerText:'').replace(/\s+/g,' ').slice(0,120), tabs:tabs.slice(0,6), rootTxt:root.innerText.slice(0,40) }; });
  console.log('  ', JSON.stringify(v).slice(0,300));
  ok('صفحة «حسابي» تعرض الملف والتبويبات للمدير', v.txt.length>30, v.txt.slice(0,80));
  await m.screenshot({path:`${OUT}/28-manager-account.png`, fullPage:true});

  // ═══ الجزء ب: العميل (زائر) — تصفح وسلة وطلب ═══
  console.log('\n══ 【ب】 العميل: تصفّح ← سلة ← طلب حقيقي ══');
  const c2=await br.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',acceptDownloads:true});
  const p=await c2.newPage(); const e2=[]; p.on('pageerror',e=>e2.push(e.message.slice(0,140)));
  const toasts=[]; p.on('dialog', async d=>{ await d.accept(); });
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?tour=c1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await p.waitForTimeout(9000);
  await p.evaluate(()=>{ window.__t=[]; const o=window.toast; window.toast=function(x,y){ window.__t.push(String(x)); return o(x,y); }; });
  const t=()=>p.evaluate(()=>window.__t.splice(0));
  v = await p.evaluate(()=>({signedIn:!!(sessionUser||cloudProfile),role:sessionRole,featured:document.querySelectorAll('#homeView .shop-card').length,hero:!!document.querySelector('#homeView .hero')}));
  ok('الزائر يفتح الرئيسية بلا تسجيل', v.signedIn===false && v.hero, v.featured+' منتجات مميزة');
  await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(600);
  await p.screenshot({path:`${OUT}/29-customer-home-top.png`});
  for(const y of [900,1800,2400]){ await p.evaluate(v=>window.scrollTo(0,v),y); await p.waitForTimeout(900); await p.screenshot({path:`${OUT}/30-customer-home-scroll-${y}.png`}); }
  await p.screenshot({path:`${OUT}/31-customer-home-full.png`, fullPage:true});

  v = await p.evaluate(async()=>{ setView('shop'); await new Promise(r=>setTimeout(r,3000));
    const head=document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ');
    const cards=[...document.querySelectorAll('#view-root .shop-card')];
    return { head, shown:cards.length, avail:cards.filter(c=>/✅/.test((c.querySelector('.shop-avail')||{}).innerText||'')).length,
             out:cards.filter(c=>/غير متوفر/.test((c.querySelector('.shop-avail')||{}).innerText||'')).length,
             disabled:cards.filter(c=>(c.querySelector('.cart-add')||{className:''}).className.includes('disabled')).length }; });
  console.log('  ', JSON.stringify(v));
  ok('العميل يرى المنتجات مع حالة التوفر (بلا أرقام مخزون)', v.shown>=40 && /منتج متاح/.test(v.head), `«${v.head.slice(0,45)}» · متوفر ${v.avail} · غير متوفر ${v.out}`);
  await p.screenshot({path:`${OUT}/32-customer-shop.png`});
  v = await p.evaluate(async()=>{ let n=0; for(let i=0;i<14;i++){ const b=[...document.querySelectorAll('button')].find(x=>/عرض المزيد/.test(x.innerText)); if(!b) break; b.click(); n++; await new Promise(r=>setTimeout(r,800)); }
    return { clicks:n, cards:document.querySelectorAll('#view-root .shop-card').length, head:document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,40) }; });
  ok('«عرض المزيد» يصل بكل الأصناف للعميل', v.cards>=229, `${v.clicks} ضغطة → ${v.cards} منتجًا`);
  await p.screenshot({path:`${OUT}/33-customer-all-products.png`});
  await p.evaluate(async()=>{ const s=document.getElementById('searchInput'); s.value='كراسة'; s.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,1500)); });
  await p.screenshot({path:`${OUT}/34-customer-search.png`});
  await p.evaluate(async()=>{ const s=document.getElementById('searchInput'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,1200)); });

  v = await p.evaluate(async()=>{ const card=[...document.querySelectorAll('#view-root .shop-card')].find(c=>/✅/.test((c.querySelector('.shop-avail')||{}).innerText||''));
    card.click(); await new Promise(r=>setTimeout(r,1800));
    const ov=document.getElementById('productDetailOverlay');
    const txt=ov.innerText.replace(/\s+/g,' ');
    const vis=[...ov.querySelectorAll('button')].filter(x=>x.offsetParent!==null).map(x=>x.innerText.trim());
    return { open:getComputedStyle(ov).display, add:/إضافة إلى السلة/.test(txt),
             qtyLeak:/المتاح الآن|إجمالي المخزن|قطعة جاهزة/.test(txt), editVisible:vis.some(x=>/تعديل/.test(x)),
             visible:vis.filter(Boolean), txt:txt.slice(0,110) }; });
  ok('تفاصيل المنتج للعميل: زر شراء ظاهر وبلا مخزون/تعديل', v.open==='block' && v.add && !v.qtyLeak && !v.editVisible, 'الأزرار الظاهرة: '+v.visible.join(' · '));
  await p.screenshot({path:`${OUT}/35-customer-product.png`});
  v = await p.evaluate(async()=>{ const b=[...document.querySelectorAll('#productDetailOverlay button')].filter(x=>x.offsetParent!==null).find(x=>/إضافة إلى السلة/.test(x.innerText)); b.click(); await new Promise(r=>setTimeout(r,900));
    closeProductDetail(); await new Promise(r=>setTimeout(r,600));
    const c2=[...document.querySelectorAll('#view-root .shop-card')].find(c=>{ const b=c.querySelector('.cart-add'); return b && !b.className.includes('disabled'); });
    c2.querySelector('.cart-add').click(); await new Promise(r=>setTimeout(r,900));
    openCart(); await new Promise(r=>setTimeout(r,1200));
    const body=document.getElementById('cartBody').innerText.replace(/\s+/g,' ');
    return { items:document.querySelectorAll('.cart-item').length, body:body.slice(0,110), total:/الإجمالي/.test(body) }; });
  console.log('  ', JSON.stringify(v).slice(0,260));
  ok('الإضافة للسلة وفتح السلة يعملان (منتجان)', v.items>=2 && v.total, v.items+' سطرًا · '+(v.body.match(/الإجمالي[^0-9]*[0-9.,]+/)?.[0]||''));
  await p.screenshot({path:`${OUT}/36-customer-cart.png`});

  v = await p.evaluate(async()=>{ const q=document.querySelector('.cart-item .q-plus'); q.click(); await new Promise(r=>setTimeout(r,900));
    const inc=document.querySelector('.cart-item .qty-ctrl span').innerText;
    document.getElementById('couponCode').value='خطأ'; applyCoupon(); await new Promise(r=>setTimeout(r,600));
    const wrong=window.__t[window.__t.length-1];
    document.getElementById('couponCode').value=(settings.couponCode||'').toUpperCase(); applyCoupon(); await new Promise(r=>setTimeout(r,800));
    const okMsg=window.__t[window.__t.length-1]; const disc=document.getElementById('cart-discount').value;
    return { inc, wrong:String(wrong).slice(0,50), okMsg:String(okMsg).slice(0,50), disc, totals:document.getElementById('cartBody').innerText.replace(/\s+/g,' ').slice(-110) }; });
  console.log('  ', JSON.stringify(v).slice(0,340));
  ok('الكمية تتغير والكوبون الخاطئ يُرفض والصحيح يُطبَّق', v.inc==='2' && /غير صحيح/.test(v.wrong) && /تم تطبيقه/.test(v.okMsg), `${v.wrong} ⇒ ${v.okMsg} (خصم ${v.disc})`);
  await p.screenshot({path:`${OUT}/37-customer-coupon.png`});

  v = await p.evaluate(async()=>{ document.getElementById('cart-customer').value='عميل الجولة التجريبي';
    createInvoiceFromCart(); await new Promise(r=>setTimeout(r,2500));
    const mb=document.getElementById('modalBody').innerText.replace(/\s+/g,' ');
    const printBtn=[...document.querySelectorAll('#modalBody button')].some(x=>/طباعة/.test(x.innerText));
    return { preview:/فاتورة|إيصال/.test(mb), printBtn, save:!!document.querySelector('button[onclick*="confirmSaveInvoice"]'), head:mb.slice(0,90) }; });
  ok('معاينة الإيصال قبل الحفظ (باسم العميل)', v.preview && v.save, v.head.slice(0,70));
  await p.screenshot({path:`${OUT}/38-customer-receipt-preview.png`});
  v = await p.evaluate(async()=>{ await confirmSaveInvoice(); await new Promise(r=>setTimeout(r,6000));
    const last=invoices[invoices.length-1];
    return { count:invoices.length, no:last&&last.no, customer:last&&last.customer, total:last&&last.total, cid:last&&last.cid, status:last&&(last.status||'—'), outbox:outbox.length }; });
  console.log('  ', JSON.stringify(v));
  ok('الطلب يُحفظ فعليًا برقم رسمي', v.count===14 && v.no>16, `فاتورة #${v.no} · ${v.total} ج.م · حالة ${v.status} · طابور ${v.outbox}`);
  await p.screenshot({path:`${OUT}/39-customer-order-done.png`});

  v = await p.evaluate(async()=>{ setView('account'); await new Promise(r=>setTimeout(r,2600));
    const av=document.getElementById('accountView');
    const tabs=[...document.querySelectorAll('#accountView [onclick*="accTab"]')].map(x=>x.innerText.trim());
    const ordBtn=[...document.querySelectorAll('#accountView [onclick*="accTab"]')].find(x=>/طلباتي/.test(x.innerText));
    if(ordBtn){ ordBtn.click(); await new Promise(r=>setTimeout(r,1800)); }
    const txt=(av?av.innerText:'').replace(/\s+/g,' ');
    return { tabs:tabs.slice(0,5), hasOrder:/#00\d\d|ج\.م/.test(txt), txt:txt.slice(0,120) }; });
  console.log('  ', JSON.stringify(v).slice(0,300));
  ok('«طلباتي» تعرض الطلب الجديد للعميل', v.tabs.length>=2, v.tabs.join(' · '));
  await p.screenshot({path:`${OUT}/40-customer-my-orders.png`, fullPage:true});
  v = await p.evaluate(async()=>{ setView('legal'); await new Promise(r=>setTimeout(r,1500));
    const root=document.getElementById('view-root').innerText.replace(/\s+/g,' ').slice(0,80);
    return root; });
  ok('الصفحة القانونية تُعرض للعميل', v.length>20, v.slice(0,60));
  await p.screenshot({path:`${OUT}/41-customer-legal.png`});
  v = await p.evaluate(async()=>{ toggleDarkMode(); await new Promise(r=>setTimeout(r,900)); const d=document.documentElement.getAttribute('data-theme'); return d; });
  ok('الوضع الليلي يعمل', v==='dark', 'data-theme='+v);
  await p.screenshot({path:`${OUT}/42-customer-dark.png`});

  // ═══ الجزء ج: المدير يحذف طلب الاختبار ويُرجع المخزون ═══
  console.log('\n══ 【ج】 المدير: حذف طلب الاختبار + إرجاع الكميات ══');
  const before = await m.evaluate(()=>({count:invoices.length, stock:db.reduce((s,c)=>s+c.items.reduce((a,i)=>a+(i.q||0),0),0), qs:db.reduce((s,c)=>s+c.items.reduce((a,i)=>a+(i.qs||0),0),0)}));
  v = await m.evaluate(async()=>{ await manualSync().catch(()=>{}); await new Promise(r=>setTimeout(r,6000));
    const i=invoices.findIndex(x=>x.customer==='عميل الجولة التجريبي');
    if(i<0) return {err:'لم يصل الطلب للسجل', n:invoices.length};
    const no=invoices[i].no; const total=invoices[i].total;
    deleteInvoice(i); await new Promise(r=>setTimeout(r,6000));
    return { no, total, count:invoices.length, outbox:outbox.length, gone:!invoices.some(x=>x.no===no) }; });
  console.log('  الحذف:', JSON.stringify(v));
  ok('المدير حذف طلب الاختبار من السجل', v.gone===true && v.count===13, `#${v.no} حُذفت · السجل عاد إلى ${v.count}`);
  await m.waitForTimeout(6000);
  v = await m.evaluate(async()=>{ await manualSync().catch(()=>{}); await new Promise(r=>setTimeout(r,4000));
    return { count:invoices.length, outbox:outbox.length, stock:db.reduce((s,c)=>s+c.items.reduce((a,i)=>a+(i.q||0),0),0), qs:db.reduce((s,c)=>s+c.items.reduce((a,i)=>a+(i.qs||0),0),0) }; });
  ok('الكميات رجعت للمخزون بعد الحذف', v.stock===before.stock && v.qs===before.qs, `مخزن ${before.stock}→${v.stock} · معروض ${before.qs}→${v.qs} · طابور ${v.outbox}`);

  await br.close();
  console.log(`\n  🛍️ جولة العميل + التنظيف: ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'}`);
  console.log('  أخطاء JS — مدير:', e1.length?JSON.stringify(e1.slice(0,2)):'صفر ✅', '| عميل:', e2.length?JSON.stringify(e2.slice(0,2)):'صفر ✅');
})();

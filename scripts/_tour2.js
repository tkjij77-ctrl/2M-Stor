const { chromium } = require('playwright');
const fs=require('fs');
const OUT='/home/user/tour'; fs.mkdirSync(OUT,{recursive:true});
let pass=0,fail=0; const bad=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,150)));
  p.on('dialog', async d=>{ await d.accept(); });
  const shot=(n,full)=>p.screenshot({path:`${OUT}/${n}.png`, fullPage:!!full});
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?tour=m2&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000});
  await p.waitForTimeout(9000);
  await p.evaluate(()=>showLogin()); await p.waitForSelector('#cl-email',{state:'visible',timeout:20000});
  await p.fill('#cl-email','tour-manager-2026@2m-stor.app'); await p.fill('#cl-pass','TourManager!2026');
  await p.click('#btnCloudLogin'); await p.waitForFunction(()=>sessionRole==='admin',{timeout:40000}).catch(()=>{});
  await p.waitForTimeout(9000);

  console.log('══ 【١١】 سجل الفواتير: قائمة · تفاصيل · معاينة/طباعة · حذف ══');
  let v = await p.evaluate(async()=>{ showInvoiceHistory(); await new Promise(r=>setTimeout(r,1800));
    return { items:document.querySelectorAll('.inv-hist-item').length, head:document.getElementById('modalBody').innerText.replace(/\s+/g,' ').slice(0,70) }; });
  ok('سجل الفواتير يفتح بكل الفواتير', v.items>=13, v.items+' فاتورة · «'+v.head.slice(0,45)+'»');
  await shot('24-invoice-history');
  v = await p.evaluate(async()=>{ document.querySelector('.inv-hist-item').click(); await new Promise(r=>setTimeout(r,900));
    const it=document.querySelector('.inv-hist-item');
    const det=it.querySelector('.inv-hi-items');
    return { open:det?getComputedStyle(det).display:'—', btns:[...it.querySelectorAll('.inv-actions button')].map(x=>x.innerText.trim()) }; });
  ok('تفاصيل الفاتورة تُفتح بأزرارها (معاينة/طباعة/حذف)', v.open!=='none' && v.btns.length>=2, v.btns.join(' · '));
  await shot('25-invoice-expanded');
  v = await p.evaluate(async()=>{ const btns=[...document.querySelectorAll('.inv-hist-item .inv-actions button')]; const prev=btns.find(x=>/معاينة|طباعة|عرض/.test(x.innerText)); prev.click();
    await new Promise(r=>setTimeout(r,2200));
    const mb=document.getElementById('modalBody').innerText.replace(/\s+/g,' ');
    const hasPrint=[...document.querySelectorAll('#modalBody button')].some(x=>/طباعة/.test(x.innerText));
    return { hasPrint, head:mb.slice(0,90), qr:!!document.querySelector('#modalBody canvas, #modalBody img[src^="data:image"]') }; });
  console.log('  ', JSON.stringify(v).slice(0,240));
  ok('المعاينة تعرض الإيصال وفيها زر طباعة', v.hasPrint===true, v.head.slice(0,60));
  await shot('26-receipt-preview');
  await p.evaluate(()=>closeModal()); await p.waitForTimeout(500);

  console.log('══ 【١٢】 تصدير الفواتير والمخزون CSV ══');
  v = await p.evaluate(async()=>{ const seen=[]; const oU=URL.createObjectURL; URL.createObjectURL=function(bl){ seen.push(Math.round(bl.size)); return oU.call(URL,bl); };
    const oC=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){};
    makeCsvInvoices(); await new Promise(r=>setTimeout(r,900)); const a1=seen.slice();
    if (typeof makeCsvStock==='function') { makeCsvStock(); await new Promise(r=>setTimeout(r,900)); }
    URL.createObjectURL=oU; HTMLAnchorElement.prototype.click=oC;
    return { a1, all:seen, hasStock: typeof makeCsvStock==='function' }; });
  ok('تصدير CSV للفواتير يعمل', v.a1.length>0, 'حجم: '+v.a1.join(',')+' بايت'+(v.hasStock?' · تصدير المخزون متاح: '+v.all.slice(1).join(',')+' بايت':''));
  await shot('27-csv-export');

  console.log('══ 【١٣】 تغيير حالة طلب حقيقي ثم إرجاعه (كمدير) ══');
  v = await p.evaluate(async()=>{
    const i=invoices.findIndex(x=>(x.status||'قيد المعالجة')==='قيد المعالجة');
    if(i<0) return {skip:true, statuses:[...new Set(invoices.map(x=>x.status||'—'))]};
    const before=invoices[i].status||'قيد المعالجة'; const no=invoices[i].no;
    updateOrderStatus(i,'في الطريق'); await new Promise(r=>setTimeout(r,2500)); const mid=invoices[i].status;
    updateOrderStatus(i,before); await new Promise(r=>setTimeout(r,3000));
    return { no, before, mid, after:invoices[i].status };
  });
  ok('حالة الطلب تتغيّر وتُرجَع', v.skip || (v.mid==='في الطريق' && v.after===v.before), v.skip?('كل الطلبات: '+JSON.stringify(v.statuses)):`#${v.no}: ${v.before} → ${v.mid} → ${v.after}`);

  console.log('══ 【١٤】 حسابي (كمدير) + الطلبات ══');
  v = await p.evaluate(async()=>{ setView('account'); await new Promise(r=>setTimeout(r,2500));
    const root=document.getElementById('view-root');
    return { txt:root.innerText.replace(/\s+/g,' ').slice(0,150), tabs:[...root.querySelectorAll('button,[role=tab]')].map(x=>x.innerText.trim()).filter(Boolean).slice(0,8),
      cards:root.querySelectorAll('.order-card,.acc-card,.account-card').length }; });
  console.log('  ', JSON.stringify(v).slice(0,340));
  ok('صفحة حسابي تعرض شيئًا للمدير', v.txt.length>30, v.txt.slice(0,70));
  await shot('28-manager-account', true);

  console.log('══ 【١٥】 تعديل صنف فعليًا: معروض +1 ثم −1 (تحقق أن المخزون يتغير فعلًا) ══');
  v = await p.evaluate(async()=>{ setView('stock'); await new Promise(r=>setTimeout(r,2500));
    const item=db.flatMap((c,ci)=>c.items.map((it,ii)=>({ci,ii,it}))).find(x=>(x.it.qs||0)>0);
    const before=item.it.qs; const beforeQ=item.it.q;
    adjustQty(item.ci,item.ii,'qs',1); await new Promise(r=>setTimeout(r,1500)); const plus=item.it.qs;
    adjustQty(item.ci,item.ii,'qs',-1); await new Promise(r=>setTimeout(r,2000)); const back=item.it.qs;
    return { name:item.it.n, before, plus, back, q:item.it.q, beforeQ }; });
  ok('تعديل «المعروض» يعمل ذهابًا وإيابًا', v.plus===v.before+1 && v.back===v.before, `${v.name}: ${v.before} → ${v.plus} → ${v.back}`);
  await p.waitForTimeout(4000);

  await b.close();
  console.log(`\n  👔 الجزء المكمّل للمدير: ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'}`);
  console.log('  أخطاء JS:', errs.length?JSON.stringify(errs.slice(0,3)):'صفر ✅');
})();

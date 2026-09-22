const { chromium } = require('playwright');
const OUT='/home/user/tour';
let pass=0,fail=0; const bad=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
(async()=>{
  const br=await chromium.launch();
  console.log('انتظار وصول النسخة الجديدة للـCDN…');
  const ctx0=await br.newContext({serviceWorkers:'block'});
  const p0=await ctx0.newPage();
  let live=false;
  for(let i=0;i<8;i++){
    await p0.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?vc='+Date.now(),{waitUntil:'domcontentloaded'});
    const has=await p0.evaluate(()=>fetch('web/views.js?v='+Date.now()).then(r=>r.text()).then(t=>/أنت تطلب/.test(t)).catch(()=>false));
    if(has){ live=true; break; }
    await p0.waitForTimeout(20000);
  }
  await ctx0.close();
  ok('النسخة الجديدة وصلت الإنتاج', live);
  if(!live) { await br.close(); console.log('توقف: CDN لم يحدّث بعد'); return; }

  console.log('\n══ 【١】 زائر على الإنتاج: طلب حقيقي — هل يقول الحقيقة؟ ══');
  const c1=await br.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  const p=await c1.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?vp=1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await p.waitForTimeout(9000);
  await p.evaluate(()=>{ window.__t=[]; const o=window.toast; window.toast=function(x,y){ window.__t.push(String(x)); return o(x,y); }; });
  let v = await p.evaluate(async()=>{
    setView('shop'); await new Promise(r=>setTimeout(r,2500));
    let f=null; db.forEach((c,ci)=>c.items.forEach((it,ii)=>{ if(!f && (it.qs||0)>0) f={ci,ii}; }));
    const name=db[f.ci].items[f.ii].n;
    incCart(f.ci,f.ii); await new Promise(r=>setTimeout(r,900));
    openCart(); await new Promise(r=>setTimeout(r,1200));
    const cc=document.getElementById('cart-customer'); if(cc) cc.value='عميل الجولة';
    await new Promise(r=>setTimeout(r,400)); closeCart(); await new Promise(r=>setTimeout(r,500));
    window.__t=[]; createInvoiceFromCart(); await new Promise(r=>setTimeout(r,1800));
    const pre=document.getElementById('modalBody').innerText.replace(/\s+/g,' ').slice(0,80);
    await confirmSaveInvoice(); await new Promise(r=>setTimeout(r,3000));
    const mb=document.getElementById('modalBody').innerText.replace(/\s+/g,' ');
    return { name, pre, toasts:window.__t.map(x=>x.slice(0,80)), guest:/كزائر/.test(mb),
             wa:/واتساب/.test(mb), txt:mb.slice(0,150), shown:document.getElementById('modal').style.display };
  });
  console.log('  المنتج:', v.name);
  console.log('  التنبيهات:', JSON.stringify(v.toasts));
  console.log('  الشاشة:', v.txt.slice(0,140));
  ok('شاشة التأكيد تظهر للزائر على الإنتاج', v.shown==='flex');
  ok('تنبيه «كزائر — لم يصل للمحل» ظاهر', v.guest===true);
  ok('تنبيه منبثق صادق', v.toasts.some(x=>/محفوظ على جهازك/.test(x)));
  await p.screenshot({path:`${OUT}/53-guest-order-honest-production.png`});
  v = await p.evaluate(async()=>{ closeModal(); accTab='orders'; setView('account'); await new Promise(r=>setTimeout(r,2000));
    return document.getElementById('accountView').innerText.replace(/\s+/g,' ').slice(0,120); });
  console.log('  «حسابي» للزائر:', v.slice(0,80));
  await p.screenshot({path:`${OUT}/54-guest-account.png`});

  console.log('\n══ 【٢】 المدير على الإنتاج: التنبيهات الجديدة + سلامة كل شيء ══');
  const c2=await br.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  const m=await c2.newPage(); const e2=[]; m.on('pageerror',e=>e2.push(e.message.slice(0,140)));
  m.on('dialog', async d=>{ await d.accept(); });
  await m.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?vp=2&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await m.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await m.waitForTimeout(9000);
  await m.evaluate(()=>showLogin()); await m.waitForSelector('#cl-email',{state:'visible',timeout:20000});
  await m.fill('#cl-email','tour-manager-2026@2m-stor.app'); await m.fill('#cl-pass','TourManager!2026');
  await m.click('#btnCloudLogin'); await m.waitForFunction(()=>sessionRole==='admin',{timeout:40000}).catch(()=>{});
  await m.waitForTimeout(9000);
  v = await m.evaluate(async()=>{ toggleDashboard(); await new Promise(r=>setTimeout(r,3000));
    const t=document.getElementById('dashBody').innerText;
    return { warn:/غير مضبوط/.test(t), cards:document.querySelectorAll('#dashBody .dash-stat').length, cvs:[...document.querySelectorAll('#dashBody canvas')].filter(c=>c.width>0).length }; });
  ok('لوحة المدير تُنبّه على غياب رقم واتساب', v.warn===true, `${v.cards} بطاقة · ${v.cvs} رسم`);
  await m.screenshot({path:`${OUT}/55-manager-phone-warning.png`, fullPage:true});
  v = await m.evaluate(async()=>{ toggleDashboard(); await new Promise(r=>setTimeout(r,700)); openSettingsModal(); await new Promise(r=>setTimeout(r,800));
    const w=document.getElementById('set-phone-warn'); const vis=w?getComputedStyle(w).display!=='none':false; closeModal(); return vis; });
  ok('الإعدادات تُنبّه تحت حقل الهاتف', v===true);
  v = await m.evaluate(()=>({items:db.reduce((s,c)=>s+c.items.length,0),inv:invoices.length,outbox:outbox.length,role:sessionRole}));
  ok('بيانات المدير سليمة كاملة', v.items===229 && v.inv===13 && v.outbox===0, JSON.stringify(v));

  await br.close();
  console.log(`\n  🧾 تحقق الإنتاج: ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'}`);
  console.log('  أخطاء JS:', (errs.length||e2.length)?JSON.stringify(errs.concat(e2).slice(0,3)):'صفر ✅');
})();

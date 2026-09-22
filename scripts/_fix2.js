const { chromium } = require('playwright');
let pass=0,fail=0; const bad=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
(async()=>{
  const b=await chromium.launch();
  const c=await b.newContext({viewport:{width:1200,height:800},serviceWorkers:'block'});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  p.on('dialog', async d=>{ await d.accept(); });
  await p.goto('http://127.0.0.1:8123/index.html?fix2=1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:30000});
  await p.waitForTimeout(2000);
  await p.evaluate(()=>{ window.__t=[]; const o=window.toast; window.toast=function(x,y){ window.__t.push(String(x)); return o(x,y); }; });

  console.log('【١】 زائر: طلب كامل — هل يقول الحقيقة الآن؟');
  let v = await p.evaluate(async()=>{
    let f=null; db.forEach((cc,ci)=>cc.items.forEach((it,ii)=>{ if(!f && (it.qs||0)>0) f={ci,ii}; }));
    incCart(f.ci,f.ii); await new Promise(r=>setTimeout(r,500));
    window.__t=[];
    createInvoiceFromCart(); await new Promise(r=>setTimeout(r,1500));
    await confirmSaveInvoice(); await new Promise(r=>setTimeout(r,2500));
    const mb=document.getElementById('modalBody');
    return { shown:document.getElementById('modal').style.display, txt:mb?mb.innerText.replace(/\s+/g,' ').slice(0,220):'',
             guestWarn: mb? /كزائر/.test(mb.innerText):false, toasts:window.__t.map(x=>x.slice(0,70)) };
  });
  console.log('  التنبيهات:', JSON.stringify(v.toasts));
  console.log('  الشاشة:', v.txt.slice(0,150));
  ok('تظهر شاشة تأكيد الطلب للزائر (كانت لا تظهر)', v.shown==='flex' && /طلبك|تم استلام/.test(v.txt));
  ok('تنبيه صريح: «أنت تطلب كزائر … لم يصل للمحل»', v.guestWarn===true);
  ok('التنبيه المنبثق صادق (لم يقل «تم حفظ الفاتورة» فقط)', v.toasts.some(x=>/محفوظ على جهازك/.test(x)), v.toasts.join(' | ').slice(0,90));
  await p.screenshot({path:'/home/user/tour/53-guest-order-honest.png'});
  v = await p.evaluate(async()=>{ closeModal(); accTab='orders'; setView('account'); await new Promise(r=>setTimeout(r,1500));
    const av=document.getElementById('accountView'); return { txt:(av?av.innerText:'').replace(/\s+/g,' ').slice(0,120) }; });
  console.log('  حسابي:', v.txt.slice(0,90));

  console.log('\n【٢】 المدير: تنبيهات غياب رقم واتساب (لوحة + إعدادات)');
  v = await p.evaluate(async()=>{ sessionUser='مدير الجولة'; sessionRole='admin'; cloudProfile=null; applyRoleUI();
    toggleDashboard(); await new Promise(r=>setTimeout(r,2500));
    const warn=/غير مضبوط/.test(document.getElementById('dashBody').innerText);
    toggleDashboard(); await new Promise(r=>setTimeout(r,700));
    openSettingsModal(); await new Promise(r=>setTimeout(r,700));
    const w=document.getElementById('set-phone-warn'); const vis=w? getComputedStyle(w).display!=='none':'لا عنصر';
    const pin=!!document.getElementById('set-pin');
    closeModal();
    return { warn, vis, pin }; });
  ok('اللوحة تُنبّه: رقم واتساب غير مضبوط', v.warn===true);
  ok('الإعدادات تُنبّه تحت حقل الهاتف', v.vis===true, 'ظاهر: '+v.vis+' · قسم PIN سليم: '+v.pin);

  console.log('\n【٣】 لا أثر جانبي على البيانات المحلية');
  v = await p.evaluate(()=>({items:db.reduce((s,x)=>s+x.items.length,0), inv:invoices.length, outbox:outbox.length}));
  ok('البيانات سليمة بعد الاختبار', v.items===229, JSON.stringify(v));
  await b.close();
  console.log(`\n  الإصلاح: ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'}`);
  console.log('  أخطاء JS:', errs.length?JSON.stringify(errs.slice(0,3)):'صفر ✅');
})();

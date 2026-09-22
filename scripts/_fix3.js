const { chromium } = require('playwright');
let pass=0,fail=0; const bad=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1200,height:900},serviceWorkers:'block'})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  await p.goto('http://127.0.0.1:8123/index.html?fix3=1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:30000}); await p.waitForTimeout(2000);
  let v = await p.evaluate(async()=>{ setView('account'); await new Promise(r=>setTimeout(r,1500));
    return { txt:document.getElementById('accountView').innerText.replace(/\s+/g,' ').slice(0,80) }; });
  ok('زائر بلا طلبات: تظهر دعوة التسجيل كما كانت', /سجّل دخولك/.test(v.txt), v.txt.slice(0,50));
  v = await p.evaluate(async()=>{
    db.forEach((c,ci)=>c.items.forEach((it,ii)=>{ if(!f0 && (it.qs||0)>0) {} })); return 1; }).catch(()=>1);
  v = await p.evaluate(async()=>{
    let f=null; db.forEach((c,ci)=>c.items.forEach((it,ii)=>{ if(!f && (it.qs||0)>0) f={ci,ii}; }));
    incCart(f.ci,f.ii); await new Promise(r=>setTimeout(r,600));
    createInvoiceFromCart(); await new Promise(r=>setTimeout(r,1500)); await confirmSaveInvoice(); await new Promise(r=>setTimeout(r,2500));
    closeModal(); accTab='orders'; setView('account'); await new Promise(r=>setTimeout(r,2000));
    const t=document.getElementById('accountView').innerText.replace(/\s+/g,' ');
    return { t, badge:/لم يصل للمحل/.test(t), header:/كزائر/.test(t), list:/طلب #/.test(t), reg:/إنشاء حساب/.test(t) };
  });
  console.log('  ', JSON.stringify(v).slice(0,240));
  ok('الزائر يرى طلباته بعد الشراء («كزائر»)', v.header===true && v.list===true);
  ok('كل طلب موسوم «⏳ لم يصل للمحل بعد»', v.badge===true);
  ok('زر إنشاء حساب ظاهر', v.reg===true);
  await p.screenshot({path:'/home/user/tour/56-guest-account-orders.png', fullPage:true});
  await b.close();
  console.log(`\n  ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'} · أخطاء JS: ${errs.length?JSON.stringify(errs.slice(0,2)):'صفر ✅'}`);
})();

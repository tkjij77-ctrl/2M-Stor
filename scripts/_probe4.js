const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1200,height:800},serviceWorkers:'block'})).newPage();
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?probe=4&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await p.waitForTimeout(8000);

  console.log('── ١) هل «الدخول المجهول» مُفعَّل في المشروع؟ ──');
  let v = await p.evaluate(async()=>{
    try {
      const r = await sb.auth.signInAnonymously();
      if (r.error) return { ok:false, err:(r.error.status||'')+' · '+r.error.message.slice(0,120) };
      const u = r.data.user;
      return { ok:true, uid:String(u.id).slice(0,8), anon:!!u.is_anonymous };
    } catch(e){ return { ок:false, ok:false, err:e.message.slice(0,120) }; }
  });
  console.log('  ', JSON.stringify(v));

  if (v.ok) {
    console.log('\n── ٢) هل تسمح سياسات RLS لجلسة مجهولة بإدراج فاتورة؟ (بند فحص يُحذف فورًا) ──');
    v = await p.evaluate(async()=>{
      const ins=await sb.from('invoices').insert({invoice_no:-9998, customer_name:'__probe_anon__', total:1, status:'قيد المعالجة'}).select('id');
      const res={ err: ins.error? (ins.error.code+' · '+ins.error.message).slice(0,130) : 'مسموح ✅', id: ins.data&&ins.data[0]?ins.data[0].id:null };
      if(res.id){ const d=await sb.from('invoices').delete().eq('id',res.id); res.cleaned = d.error? ('فشل الحذف: '+d.error.message.slice(0,60)) : 'حُذف ✅'; }
      return res;
    });
    console.log('  ', JSON.stringify(v));
    console.log('\n── ٣) هل أُنشئ ملف شخصي للضيف؟ ──');
    v = await p.evaluate(async()=>{ const r=await sb.from('profiles').select('id,username,role').limit(3); return r.error? r.error.message.slice(0,90) : r.data; });
    console.log('  ', JSON.stringify(v).slice(0,250));
    console.log('\n── ٤) إشارة خروج لعدم إبقاء جلسة على النسخة الحيّة ──');
    console.log('  ', JSON.stringify(await p.evaluate(async()=>{ const r=await sb.auth.signOut(); return r.error? r.error.message:'خرج ✅'; })));
  }
  await b.close();
})();

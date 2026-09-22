const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1200,height:800},serviceWorkers:'block'})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?probe=3&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000}); await p.waitForTimeout(9000);
  await p.evaluate(()=>{ window.__t=[]; const o=window.toast; window.toast=function(x,y){ window.__t.push(String(x)); return o(x,y); }; });

  let v = await p.evaluate(async()=>{
    let sess=null; try { const r=await sb.auth.getSession(); sess=r&&r.data&&r.data.session?('جلسة: '+(r.data.session.user.is_anonymous?'مجهولة':'مسجّل')+' · '+String(r.data.session.user.id).slice(0,8)):'لا جلسة'; } catch(e){ sess='خطأ: '+e.message.slice(0,40); }
    return { cloudStatus, ready:(typeof cloudReady==='function')?cloudReady():'—', sess, profile:cloudProfile?('نعم: '+(cloudProfile.username||cloudProfile.u)):'لا', outbox:outbox.length, failed:(typeof outboxFailed!=='undefined'?outboxFailed.length:'—') };
  });
  console.log('حالة الزائر:', JSON.stringify(v));

  console.log('\n── محاولة كتابة سحابية كزائر (بند فحص مؤقت يُحذف فورًا) ──');
  v = await p.evaluate(async()=>{
    const t0=Date.now();
    const ins=await sb.from('invoices').insert({invoice_no: -9999, customer_name:'__probe_silent__', total: 1, status:'قيد المعالجة'}).select('id');
    const res={ err: ins.error? (ins.error.code+' · '+ins.error.message).slice(0,120) : 'لا خطأ', id: ins.data&&ins.data[0]?ins.data[0].id:null };
    if(res.id){ const del=await sb.from('invoices').delete().eq('id',res.id); res.cleaned = del.error? ('فشل الحذف: '+del.error.message.slice(0,50)) : 'حُذف ✅'; }
    return res;
  });
  console.log('  نتيجة الإدراج المباشر:', JSON.stringify(v));

  console.log('\n── تسلسل الطلب الحقيقي: سلة → فاتورة → مزامنة ──');
  v = await p.evaluate(async()=>{
    // نضع صنفًا متاحًا في السلة
    let found=null; db.forEach((c,ci)=>c.items.forEach((it,ii)=>{ if(!found && (it.qs||0)>0) found={ci,ii}; }));
    incCart(found.ci, found.ii); await new Promise(r=>setTimeout(r,600));
    document.getElementById('cart-customer') && (document.getElementById('cart-customer').value='اختبار الوصول');
    createInvoiceFromCart(); await new Promise(r=>setTimeout(r,1500));
    const pre={ outbox:outbox.length, failed:outboxFailed?outboxFailed.length:'—', toast:window.__t.slice(-2) };
    await confirmSaveInvoice(); await new Promise(r=>setTimeout(r,7000));
    const last=invoices[invoices.length-1];
    return { pre, count:invoices.length, no:last&&last.no, cid:last&&last.cid, status:last&&last.status,
      outbox:outbox.length, failed:outboxFailed?outboxFailed.length:'—',
      failedDetail:(outboxFailed&&outboxFailed[0])?JSON.stringify(outboxFailed[0]).slice(0,200):null,
      toasts:window.__t.slice(-4), cloud:cloudStatus };
  });
  console.log('  ', JSON.stringify(v).slice(0,600));

  console.log('\n── هل تُرسل الفاتورة عبر واتساب من الإيصال؟ ──');
  v = await p.evaluate(async()=>{ const mb=document.getElementById('modalBody'); return mb? [...mb.querySelectorAll('button')].map(x=>x.innerText.trim()).filter(Boolean):'لا نافذة'; });
  console.log('  أزرار الإيصال:', JSON.stringify(v));

  await b.close();
  console.log('\nأخطاء JS:', errs.length?JSON.stringify(errs.slice(0,3)):'صفر');
})();

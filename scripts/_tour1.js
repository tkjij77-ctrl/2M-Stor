const { chromium } = require('playwright');
const fs=require('fs');
const OUT='/home/user/tour'; fs.mkdirSync(OUT,{recursive:true});
const EDIT_SEL='.product-card button[onclick*="openModal("]';
let pass=0,fail=0; const bad=[], notes=[];
const ok=(m,c,d)=>{ if(c){pass++;console.log(`  ✅ ${m}${d?' → '+d:''}`);}else{fail++;bad.push(m);console.log(`  ❌ ${m}${d?' → '+d:''}`);} };
const note=(m)=>{ notes.push(m); console.log('  ◦ '+m); };
(async()=>{
  const b=await chromium.launch();
  const p=await (await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  p.on('dialog', async d=>{ await d.accept(); });
  const shot=(n,full)=>p.screenshot({path:`${OUT}/${n}.png`, fullPage:!!full});
  const scrollShots=async(prefix,steps)=>{
    await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(700);
    const h=await p.evaluate(()=>document.documentElement.scrollHeight);
    for(let i=0;i<steps;i++){
      await p.evaluate(y=>window.scrollTo(0,y), Math.round((h-900)*i/(steps-1)));
      await p.waitForTimeout(900);
      await shot(`${prefix}-${i+1}`);
      if(i===0) await shot(`${prefix}-full`, true);
    }
  };

  await p.goto('https://tkjij77-ctrl.github.io/2M-Stor/index.html?tour=m1&cb='+Date.now(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof db==='object'&&Array.isArray(db),{timeout:40000});
  await p.waitForTimeout(9000);

  console.log('══ 【٠】 دخول المدير ══');
  await p.evaluate(()=>showLogin()); await p.waitForSelector('#cl-email',{state:'visible',timeout:20000});
  await p.fill('#cl-email','tour-manager-2026@2m-stor.app'); await p.fill('#cl-pass','TourManager!2026');
  await p.click('#btnCloudLogin'); await p.waitForFunction(()=>sessionRole==='admin',{timeout:40000}).catch(()=>{});
  await p.waitForTimeout(9000);
  let v = await p.evaluate(()=>({role:sessionRole,user:sessionUser,chip:document.getElementById('roleChip').textContent.trim(),stats:document.getElementById('statRow').style.display,
     items:db.reduce((s,c)=>s+c.items.length,0),cats:db.map(c=>c.name),outbox:outbox.length,cloud:typeof cloudStatus!=='undefined'?cloudStatus:'?'}));
  ok('دخلت كمدير وظهرت الشريحة والإحصاءات', v.role==='admin' && v.stats==='flex', `${v.chip} · ${v.items} صنفًا · مزامنة ${v.cloud} · طابور ${v.outbox}`);
  await shot('01-manager-logged-in');

  console.log('══ 【١】 الرئيسية: تمرير كامل + هل المنتجات ظاهرة؟ ══');
  await p.evaluate(()=>setView('home')); await p.waitForTimeout(3000);
  v = await p.evaluate(()=>({
    hero: !!document.querySelector('#homeView .hero'),
    cards: document.querySelectorAll('#homeView .shop-card').length,
    featured: [...document.querySelectorAll('h1,h2,h3,.section-title')].map(x=>x.innerText.trim()).filter(Boolean).slice(0,6),
    height: document.documentElement.scrollHeight,
    cta: [...document.querySelectorAll('button,a')].filter(x=>/ابدأ|تسوق|تصفح|المنتجات/.test(x.innerText||'')&&x.offsetParent).map(x=>x.innerText.trim()).slice(0,4)
  }));
  console.log('  ', JSON.stringify(v).slice(0,380));
  ok('الرئيسية فيها قسم ترحيب وزر بدء', v.hero===true && v.cta.length>0, v.cta.join(' | '));
  ok('منتجات ظاهرة في الرئيسية (منتجات مميزة)', v.cards>0, v.cards+' منتجات مميزة داخل الرئيسية');
  await scrollShots('02-home',4);

  console.log('══ 【٢】 صفحة العرض: من ٤٠ إلى كل الـ229 بزر «عرض المزيد» ══');
  await p.evaluate(()=>setView('shop')); await p.waitForTimeout(3500);
  v = await p.evaluate(()=>({shown:document.querySelectorAll('.shop-card').length, title:document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,60), more:!!document.querySelector('button[onclick*="loadMoreShop"]')}));
  console.log('  البداية:', JSON.stringify(v));
  await shot('06-shop-first-screen');
  let clicks=0;
  for(let i=0;i<12;i++){
    const has=await p.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/عرض المزيد/.test(x.innerText)); if(b){b.click(); return true;} return false; });
    if(!has) break; clicks++;
    await p.waitForTimeout(1200);
    if(clicks===3||clicks===7) await shot('07-shop-loadmore-'+clicks);
  }
  v = await p.evaluate(()=>({shown:document.querySelectorAll('.shop-card').length, total:document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,50)}));
  ok('كل المنتجات تُعرض بعد «عرض المزيد»', v.shown>=229, `${v.shown} بطاقة بعد ${clicks} ضغطة · «${v.total}»`);
  await shot('08-shop-all-products');
  await scrollShots('09-shop-scroll',3);

  console.log('══ 【٣】 البحث والفلترة والترتيب والمفضلة ══');
  v = await p.evaluate(async()=>{ const s=document.getElementById('searchInput'); s.value='قلم'; s.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,1400));
    return { n:document.querySelectorAll('.shop-card').length, marks:document.querySelectorAll('.search-highlight').length, sample:[...document.querySelectorAll('.shop-name')].slice(0,2).map(x=>x.innerText) }; });
  ok('البحث يعمل ويميّز الكلمة', v.n>0 && v.marks>0, `${v.n} نتيجة · تظليل ${v.marks} · ${v.sample.join(' / ')}`);
  await shot('10-shop-search');
  v = await p.evaluate(async()=>{ const s=document.getElementById('searchInput'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true}));
    const f=document.getElementById('stockFilter'); f.value='out'; f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,1500));
    const cards=[...document.querySelectorAll('.shop-card')];
    return { n:cards.length, badges:[...new Set(cards.map(c=>(c.querySelector('.shop-avail')||{}).innerText||'').filter(Boolean))].slice(0,3) }; });
  ok('فلتر «غير المتوفر» يعرض الأصناف الناقصة بوسمها', v.n>0 && v.badges.every(x=>!/متوفر\s*✅/.test(x)), `${v.n} صنفًا · الوسوم: ${v.badges.join(' · ')}`);
  await shot('11-shop-filter-out');
  v = await p.evaluate(async()=>{ const f=document.getElementById('stockFilter'); f.value='all'; f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,900));
    const sel=document.getElementById('sortSelect'); sel.value='price-asc'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,2600));
    const prices=[...document.querySelectorAll('#view-root .shop-card .shop-price')].slice(0,8).map(x=>parseFloat(x.innerText)||0);
    return { sel:!!sel, prices }; });
  ok('الترتيب بالسعر يعمل', v.sel && v.prices.length>2 && v.prices.join()===[...v.prices].sort((a,b)=>a-b).join(), v.prices.join(' ≤ '));
  v = await p.evaluate(async()=>{ const btn=document.querySelector('.shop-card .fav-btn'); btn.click(); await new Promise(r=>setTimeout(r,900));
    const active=document.querySelector('.shop-card .fav-btn').classList.contains('active');
    document.querySelector('.shop-card').click(); await new Promise(r=>setTimeout(r,1500));
    const ov=document.getElementById('productDetailOverlay');
    return { active, open:getComputedStyle(ov).display, edit:/تعديل/.test(ov.innerText), qty:/المتاح الآن|المخزن/.test(ov.innerText), img:!!ov.querySelector('img,.amz-img,svg') }; });
  ok('زر المفضلة يستجيب ويفتح تفاصيل المنتج (مدير: يرى «تعديل» والمخزون)', v.active && v.open==='block' && v.edit && v.qty, 'تعديل:'+v.edit+' · مخزون:'+v.qty);
  await shot('12-product-detail-manager');
  await p.evaluate(()=>closeProductDetail()); await p.waitForTimeout(500);

  console.log('══ 【٤】 صفحة المخزن: كل الأصناف + تنبيه النقص + قيمة المخزن ══');
  await p.evaluate(()=>setView('stock')); await p.waitForTimeout(3000);
  v = await p.evaluate(()=>({cards:document.querySelectorAll('.product-card').length, editBtns:document.querySelectorAll('.product-card[onclick]').length,
    title:document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,60)}));
  ok('صفحة المخزن تعرض كل الأصناف والبطاقة تفتح التعديل', v.cards>=229 && v.editBtns>0, `${v.cards} بطاقة · ${v.editBtns} قابلة للنقر · «${v.title}»`);
  await scrollShots('13-stock',3);
  v = await p.evaluate(async()=>{ document.querySelector('.product-card').click(); await new Promise(r=>setTimeout(r,900));
    const mp=document.getElementById('modal-price'), pn=document.getElementById('modal-pn');
    mp.value='73'; mp.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,300));
    const follow=pn.value; closeModal(); return { follow }; });
  ok('فخ السعر ما زال مُصلحًا في نافذة التعديل', v.follow==='73', 'الرقمي تبع المعروض: '+v.follow);
  await p.evaluate(async()=>{ document.querySelector('.product-card').click(); });
  await p.waitForTimeout(900); await shot('14-edit-modal');
  await p.evaluate(()=>closeModal());

  console.log('══ 【٥】 لوحة التحكم وسجل الأخطاء ══');
  v = await p.evaluate(async()=>{ toggleDashboard(); await new Promise(r=>setTimeout(r,3200));
    const cvs=[...document.querySelectorAll('#dashBody canvas')].map(c=>c.width+'x'+c.height);
    const cards=document.querySelectorAll('#dashBody .stat-card, #dashBody .dash-card').length;
    return { cvs, cards, errBtn:[...document.querySelectorAll('#dashBody button')].some(x=>/أخطاء/.test(x.innerText)) }; });
  ok('اللوحة: ٧ بطاقات و٣ رسوم وزر سجل الأخطاء', v.cards>=7 && v.cvs.filter(x=>!x.startsWith('0')).length>=3 && v.errBtn, v.cards+' بطاقة · '+v.cvs.join(' · '));
  await shot('15-dashboard', true);
  await p.evaluate(()=>toggleDashboard()); await p.waitForTimeout(800);

  console.log('══ 【٦】 الطلبات/الفواتير: عرض · تفاصيل · طباعة ══');
  v = await p.evaluate(async()=>{ setView('invoices'); await new Promise(r=>setTimeout(r,2200));
    const rows=document.querySelectorAll('.invoice-row, .inv-row, .order-row').length;
    const head=document.getElementById('sectionTitle')?document.getElementById('sectionTitle').innerText.replace(/\s+/g,' ').slice(0,50):'';
    return { rows, head, all:invoices.length }; });
  ok('سجل الطلبات يعرض الفواتير', v.all>0, `${v.all} فاتورة في السجل · صفوف معروضة ${v.rows}`);
  await shot('16-invoices');
  v = await p.evaluate(async()=>{ const d=document.querySelector('[onclick*="toggleInvoiceDetail"], [onclick*="previewInvoice"]'); if(!d) return {ok:false};
    d.click(); await new Promise(r=>setTimeout(r,1500));
    return { ok:true, hasPrint:!!document.querySelector('[onclick*="printReceipt"]'), txt:document.body.innerText.slice(0,0) }; });
  ok('تفاصيل الفاتورة تُفتح وفيها زر طباعة', v.ok===true && v.hasPrint===true);
  await shot('17-invoice-detail');

  console.log('══ 【٧】 العاملون والعملاء ══');
  v = await p.evaluate(async()=>{ toggleStaffPage(); await new Promise(r=>setTimeout(r,3000));
    const body=document.getElementById('staffBody')?document.getElementById('staffBody').innerText:'';
    return { rows:document.querySelectorAll('.user-row, .staff-row').length, m:/22|19|20|21|18/.test(body), txt:document.body.innerText.length }; });
  console.log('  ', JSON.stringify(v).slice(0,180));
  await shot('18-staff', true);
  v = await p.evaluate(async()=>{ const t=document.getElementById('staffOverlay'); if(t) t.style.display='none'; return 1; });

  console.log('══ 【٨】 الإعدادات: كل الحقول + الأمان + النسخ + المزامنة + السلة ══');
  v = await p.evaluate(async()=>{ openSettingsModal(); await new Promise(r=>setTimeout(r,900));
    const body=document.getElementById('modalBody');
    const fields=body.querySelectorAll('input,select').length;
    const pin=!!document.getElementById('set-pin'), backups=/النسخ الاحتياطية/.test(body.innerText), cloud=/السحابة|Supabase/.test(body.innerText);
    return { fields, pin, backups, cloud }; });
  ok('الإعدادات كاملة: كل الحقول + قسم PIN + نسخ احتياطية + سحابة', v.fields>=18 && v.pin && v.backups, v.fields+' حقلًا/قائمة · PIN:'+v.pin+' · نسخ:'+v.backups);
  await shot('19-settings', true);
  await p.evaluate(()=>closeModal()); await p.waitForTimeout(400);
  v = await p.evaluate(async()=>{ openSyncStatus(); await new Promise(r=>setTimeout(r,1800));
    const t=document.getElementById('modalBody').innerText.replace(/\s+/g,' ').slice(0,110); closeModal(); return t; });
  ok('لوحة حالة المزامنة تُفتح', v.length>10, v.slice(0,70));
  await shot('20-sync-status');
  await p.evaluate(async()=>{ openTrash(); await new Promise(r=>setTimeout(r,1800)); }); await p.waitForTimeout(1200);
  v = await p.evaluate(()=>document.getElementById('modalBody').innerText.replace(/\s+/g,' ').slice(0,90));
  ok('سلة المحذوفات تُفتح', v.length>5, v.slice(0,60));
  await shot('21-trash');
  await p.evaluate(()=>closeModal());

  console.log('══ 【٩】 تصدير البيانات + حسابي ══');
  v = await p.evaluate(async()=>{ const seen=[]; const oU=URL.createObjectURL; URL.createObjectURL=function(bl){ seen.push(Math.round(bl.size/1024)+'ك.ب'); return oU.call(URL,bl); };
    const oC=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(!(this.href||'').startsWith('blob:')) oC.call(this); };
    exportData(); await new Promise(r=>setTimeout(r,1500)); URL.createObjectURL=oU; HTMLAnchorElement.prototype.click=oC; return seen; });
  ok('نسخة البيانات الكاملة تُنزَّل', v.length>0, v.join(' · '));
  v = await p.evaluate(async()=>{ setView('account'); await new Promise(r=>setTimeout(r,2200));
    const tabs=[...document.querySelectorAll('.acc-tab, .account-tab, [data-acc-tab]')].map(x=>x.innerText.trim());
    return { tabs:tabs.slice(0,5), cards:document.querySelectorAll('.order-card, .acc-card').length }; });
  console.log('  ', JSON.stringify(v).slice(0,240));
  await shot('22-account', true);

  console.log('══ 【١٠】 القفل كمدير (رمز PIN) ══');
  v = await p.evaluate(async()=>{ openSettingsModal(); await new Promise(r=>setTimeout(r,700));
    document.getElementById('set-pin').value='2026'; document.getElementById('set-pin-conf').value='2026';
    await saveCounterPin(); await new Promise(r=>setTimeout(r,300)); closeModal(); quickLock(); await new Promise(r=>setTimeout(r,700));
    return { show:document.getElementById('lockOverlay').style.display, pad:document.querySelectorAll('#lockPinArea .pin-btn').length }; });
  ok('القفل يشتغل للمدير', v.show==='flex' && v.pad===12);
  await shot('23-lock');
  v = await p.evaluate(async()=>{ for(const d of ['2','0','2','6']){ lockPadPress(d); await new Promise(r=>setTimeout(r,90)); } await new Promise(r=>setTimeout(r,900));
    return document.getElementById('lockOverlay').style.display; });
  ok('الفتح برمز PIN يعمل', v==='none');

  await b.close();
  console.log(`\n  👔 جولة المدير: ${pass}/${pass+fail} ${fail?'❌ '+JSON.stringify(bad):'✅ نظيف'}`);
  console.log('  أخطاء JS:', errs.length?JSON.stringify(errs.slice(0,3)):'صفر ✅');
  console.log('  لقطات:', fs.readdirSync(OUT).length);
})();

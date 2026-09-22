    // ===== INIT =====
    (function migratePrices() {
        db.forEach(c => c.items.forEach(it => { if (it.pn === undefined) it.pn = firstNum(it.p); }));
    })();
    ensureLids();
    autoBackup();
    renderLogin();
    renderFilterRow();
    renderAll();
    updateCartBadge();
    updateFavBadge();
    if (cloudCfg && cloudCfg.on) {
      if(window.supabase){
        initCloudClient();
        setCloudStatus(sb ? 'on' : 'connect');
        // محاولة تفريغ الطلبات العالقة حتى بدون تسجيل سحابي (anon) — بعد إصلاح RLS
        setTimeout(()=>{ if(cloudReady() && outbox.length) flushOutbox(); if(cloudReady()) pullAll().catch(()=>{}); }, 1200);
        showLanding();
        cloudInit();
      } else {
        // Supabase CDN لسه بيحمل — انتظر لحظات ثم اعد المحاولة (يحل مشكلة defer القديم)
        let _tries=0;
        const _iv=setInterval(()=>{
          _tries++;
          if(window.supabase){
            clearInterval(_iv);
            initCloudClient();
            setCloudStatus(sb ? 'on' : 'connect');
            renderLogin();
            showLanding();
            cloudInit();
          } else if(_tries>20){
            clearInterval(_iv);
            renderLogin();
            showLanding();
          }
        }, 400);
        renderLogin();
        showLanding();
      }
    } else {
      // ☁️ T-A3: لا جلسات محلية — الجلسة تُستعاد من السحابة فقط، والزائر يرى صفحة الترحيب
      sessionUser = '';
      sessionRole = '';
      localStorage.removeItem('al_sayed_session_user');
      localStorage.removeItem('al_sayed_db');
      showLanding();
    }
    window.addEventListener('online', () => { if (cloudReady()) { flushOutbox(); pullAll(); } }, { passive: true });
    // 🔄 T3.2: لو فشل الرفع أثناء الاتصال (انقطاع لحظي بمكان)، نعيد المحاولة
    // دوريًا بدل انتظار تغيير جديد من المستخدم — كان الطابور يبقى متوقفًا للأبد.
    setInterval(() => {
        if (!cloudReady()) return;
        if (document.visibilityState === 'visible' && outbox.length > 0 && !flushing) flushOutbox();
        updateSyncChip();
    }, 30000);
    // عند العودة للتبويب: ارفع ما تبقّى فورًا
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && cloudReady() && outbox.length > 0) flushOutbox();
    });
    window.addEventListener('offline', () => { if (cloudReady()) setCloudStatus('offline'); }, { passive: true });
    setInterval(() => {
        if (cloudReady() && sessionRole) {
            if ('requestIdleCallback' in window) requestIdleCallback(() => pullAll(), { timeout: 2000 });
            else pullAll();
        }
    }, 30000);

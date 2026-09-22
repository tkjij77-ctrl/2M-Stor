    // ☁️ T-A4 (2026-09-22): لا بيانات مضمَّنة في الصفحة — السحابة هي المصدر الوحيد.
    // السبب: كانت هناك قاعدة محلية بـ 456 صنفًا تُدمج مع السحابة ⇒ تكرار وتضليل إحصاءات
    // + تسريب قائمة الأسعار كاملة في كود الصفحة العلني.
    let db = [];
    // بيانات المصنع (مؤقتة قبل أول مزامنة سحابية) — متُرفعش للسحابة عشان مانلوثش البيانات
    let dbIsFactory = true; // لا توجد بيانات مصنع بعد الآن — كل شيء من السحابة
    let invoices = JSON.parse(localStorage.getItem('al_sayed_invoices')) || [];
    // هجرة حالات الطلب القديمة (بدون status) → قيد المعالجة
    invoices.forEach(inv=>{ if(!inv.status) inv.status='قيد المعالجة'; });
    // ===== IndexedDB للـ offline الحقيقي (يتجاوز 5MB localStorage) — لا يمس السلوك الحالي =====
    const IDB_NAME='al-sayed-v2', IDB_STORE='kv';
    function idbGet(key){ return new Promise(res=>{ try{ const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=e=>{ try{ e.target.result.createObjectStore(IDB_STORE); }catch{} }; r.onsuccess=()=>{ try{ const tx=r.result.transaction(IDB_STORE,'readonly'); const st=tx.objectStore(IDB_STORE); const g=st.get(key); g.onsuccess=()=>res(g.result||null); g.onerror=()=>res(null); }catch{res(null)} }; r.onerror=()=>res(null);}catch{res(null)} }); }
    function idbSet(key,val){ try{ const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=e=>{ try{ e.target.result.createObjectStore(IDB_STORE); }catch{} }; r.onsuccess=()=>{ try{ const tx=r.result.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put(val,key); }catch{} }; }catch{} }
    // حاول تحميل من IDB لو localStorage فارغ (جهاز جديد أو quota exceeded سابقاً)
    (async()=>{ try{ const iv=await idbGet('al_sayed_invoices'); if(iv){ try{ const parsed=JSON.parse(iv); if(parsed.length && !invoices.length){ invoices=parsed; invoices.forEach(x=>{ if(!x.status) x.status='قيد المعالجة'; }); renderAll(); } }catch{} } }catch{} })();
    let currentCat = 'all';
    let currentView = 'home';
    let shopPageSize = 40, shopLimit = 40;
    let shopSort = 'default';
    let shopFavOnly = false;
    let accTab='profile';
    let favs = JSON.parse(localStorage.getItem('al_sayed_fav')||'[]');
    let searchDebounce = null;
    let editingCat = -1, editingIdx = -1;
    let invoiceCart = [];
    let pendingInvoice = null;
    let animateNextRender = true;
    let deferredPrompt;
    let imgState = { val: null, dirty: false };

    // ===== (حُذفت قاعدة البيانات المضمَّنة T-A4: 456 صنفًا كانت في كود الصفحة) =====
    // ===== HELPERS =====
    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function getQ(item) { return item.q !== undefined ? item.q : 0; }
    function getQs(item) { return item.qs !== undefined ? item.qs : 0; }
    function getMin(item) { return item.min !== undefined && item.min !== null ? item.min : 5; }
    // 🔒 T-A5 (2026-09-22): العامل والمدير فقط يرون أرقام المخزون.
    // العميل يرى «متوفر / غير متوفر» (وتنبيه «آخر N قطع» عند الاقتراب من النفاد).
    function isStaff() {
      if (sessionRole === 'admin' || sessionRole === 'worker') return true;
      return typeof can === 'function' && (can('stock') || can('del') || can('add'));
    }
    function availText(it) {
      const qs = getQs(it);
      if (qs <= 0) return 'غير متوفر';
      if (isStaff()) return 'متاح: ' + qs;
      return qs <= 3 ? ('آخر ' + qs + ' قطع') : 'متوفر ✅';
    }
    function firstNum(s) { const m = String(s).match(/\d+([.,]\d+)?/); return m ? parseFloat(m[0].replace(',', '.')) : 0; }
    function itemPrice(item) { return item.pn !== undefined ? item.pn : firstNum(item.p); }
    function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString('en-EG'); }
    function fmtDateTime(iso){ try{ return new Date(iso).toLocaleString('ar-EG', {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'}); }catch{ return new Date(iso).toLocaleString('ar-EG'); } }
    function fmtTime(iso){ try{ return new Date(iso).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}); }catch{ return ''; } }
    function cssVar(name, fb) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fb;
    }
    function highlightName(name, search) {
        const safe = esc(name);
        if (!search) return safe;
        try {
            const re = new RegExp(esc(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            return safe.replace(re, m => '<span class="search-highlight">' + m + '</span>');
        } catch (e) { return safe; }
    }
    function favKey(ci,ii){ return ci+':'+ii; }
    function isFav(ci,ii){ return favs.includes(favKey(ci,ii)); }
    function toggleFav(ci,ii){
        const k=favKey(ci,ii);
        if(favs.includes(k)) favs=favs.filter(x=>x!==k);
        else favs.push(k);
        try{ localStorage.setItem('al_sayed_fav', JSON.stringify(favs)); }catch(e){}
        updateFavBadge();
        renderAll();
        toast(isFav(ci,ii)?'❤️ أُضيف للمفضلة':'💔 أُزيل من المفضلة');
    }
    function updateFavBadge(){
        const el=document.getElementById('favCount');
        if(el){ el.textContent=favs.length; el.style.display=favs.length?'grid':'none'; }
        const fc=document.getElementById('favCountMobile');
        if(fc){ fc.textContent=favs.length; fc.style.display=favs.length?'inline-flex':'none'; }
    }
    const ORDER_STATUSES=['قيد المعالجة','في الطريق','تم التوصيل','تم رفض الطلب','ملغي'];
    function statusClass(s){
        if(s==='في الطريق') return 'shipping';
        if(s==='تم التوصيل') return 'done';
        if(s==='تم رفض الطلب') return 'rejected';
        if(s==='ملغي') return 'cancelled';
        return '';
    }
    function canManageOrders(){ return sessionRole==='admin' || sessionRole==='worker'; }
    const wording={
      admin:{ orders:'📦 الطلبات (الكل)', ordersEmpty:'لا توجد طلبات حتى الآن', account:'👑 لوحة المدير', fav:'المفضلة (الكل)', profile:'ملف المدير'},
      worker:{ orders:'📋 طلبات اليوم', ordersEmpty:'لا توجد طلبات اليوم', account:'👷 حساب العامل', fav:'المفضلة', profile:'ملفي'},
      customer:{ orders:'📦 طلباتي', ordersEmpty:'لم تطلب بعد', account:'👤 حسابي', fav:'مفضلتي', profile:'ملفي'}
    };
    function w(key){ return (wording[sessionRole]||wording.customer)[key] || key; }

    // ===== SETTINGS (بيانات المحل والإيصال) =====
    let settings = Object.assign(
        {
            store: '2M-Stor', address: '', phone: '', footer: 'شكراً لتسوقكم معنا',
            // 🏪 T4.2 (2026-09-21): وصف المتجر من الإعدادات — كان مكتوبًا
            // «كتب وقرطاسية» بلا أي أساس (المخزون الفعلي أدوات كهربائية).
            // الافتراضي لا يدّعي أي نشاط: يُحرّره المالك من الإعدادات.
            desc: 'تصفّح الأصناف المتوفرة فعليًا في المخزن وأضفها للسلة.',
            // ⚖️ T4.3: سياسة الإرجاع — يحددها المالك. 0 = لم تُحدَّد بعد
            // (والصفحة تقول ذلك بصراحة بدل اختراع مدة إرجاع).
            returnDays: 0,
            returnNote: '',
            tax: 0,
            // 🔧 T3.5 (2026-09-21): قواعد البيع صارت في الإعدادات بدل أرقام مكتوبة في الكود
            shipping: 20,         // مصاريف الشحن (ج.م)
            freeShip: 200,        // الشحن مجاني فوق المبلغ ده (0 = لا يوجد إعفاء)
            couponCode: '2M10',   // كود الخصم (فاضي = بدون كوبون)
            couponPct: 10,        // نسبة خصم الكوبون %
            // 📦 T3.3 (2026-09-21): نموذج المخزون — كان البيع ينقص «المعروض» فقط
            // ويترك «إجمالي المخزن» ثابتًا للأبد → الجرد وهمي.
            stockMode: 'both',    // both = خصم المخزن والمعروض · display = المعروض فقط · off = لا خصم
            oversell: 'warn'      // warn = تنبيه والسماح · block = منع البيع بلا رصيد
        },
        JSON.parse(localStorage.getItem('al_sayed_settings') || 'null') || {}
    );
    function saveSettings() { localStorage.setItem('al_sayed_settings', JSON.stringify(settings)); }

    // ═══════════════════════════════════════════════════════════════
    //  🗑️ سلة المحذوفات (T3.4) — الحذف ناعم وله رجعة
    //  تُخزَّن نسخة من كل عنصر محذوف محليًا (بديل شبكة آمن عند فقد الاتصال)،
    //  وتُقرأ النسخة السحابية عبر deleted_at عند توفّر الاتصال.
    // ═══════════════════════════════════════════════════════════════
    function trashList() { try { return JSON.parse(localStorage.getItem('al_sayed_trash') || '[]'); } catch (e) { return []; } }
    function trashSave(arr) { try { localStorage.setItem('al_sayed_trash', JSON.stringify(arr.slice(-200))); } catch (e) {} }
    function trashPush(rec) {
        const arr = trashList();
        arr.push(Object.assign({ deletedAt: new Date().toISOString() }, rec));
        trashSave(arr);
    }
    function trashRemove(lid) {
        trashSave(trashList().filter(x => x.lid !== lid));
    }

    // ===== INVOICE NUMBER (ترقيم متسلسل) =====
    let invCounter = parseInt(localStorage.getItem('al_sayed_invno') || '0', 10) || 0;

    // ===== AUDIT LOG (سجل النشاط) =====
    let audit = JSON.parse(localStorage.getItem('al_sayed_audit') || '[]');
    function logAction(action, details) {
        audit.push({ ts: Date.now(), user: sessionUser || '—', action: action, details: details || '' });
        if (audit.length > 300) audit = audit.slice(-300);
        try { localStorage.setItem('al_sayed_audit', JSON.stringify(audit)); } catch (e) {}
    }

    // ===== AUTO BACKUP (نسخة احتياطية تلقائية يومياً — آخر 7) =====
    function autoBackup() {
        const today = new Date().toDateString();
        if (localStorage.getItem('al_sayed_last_backup') === today) return;
        try {
            let backups = JSON.parse(localStorage.getItem('al_sayed_backups') || '[]');
            backups.push({ date: new Date().toISOString(), db: db, invoices: invoices });
            if (backups.length > 7) backups = backups.slice(-7);
            localStorage.setItem('al_sayed_backups', JSON.stringify(backups));
            localStorage.setItem('al_sayed_last_backup', today);
        } catch (e) { /* مساحة التخزين مش كفاية — يتجاهل */ }
    }

    // ===== VIEWS (مع home لاندنج + account) =====
    // 🏪 T4.2: يُملأ التذييل من الإعدادات الحقيقية — ما يظهر فقط ما نعرفه فعلًا
    // ═══ ⚖️ T4.3: المحتوى القانوني — مبني على ما يفعله النظام فعلًا ═══
    // قاعدة صارمة: لا نكتب وعدًا لا ينفّذه النظام. سياسة الإرجاع يحددها
    // المالك في الإعدادات؛ وإن لم يحددها نقول ذلك بصراحة.
    function legalReturnText() {
        const days = parseInt(settings.returnDays, 10) || 0;
        const note = String(settings.returnNote || '').trim();
        if (days <= 0 && !note) {
            return 'لم تُحدَّد سياسة إرجاع بعد. تواصل مع المتجر قبل الشراء لمعرفة الشروط.';
        }
        // صياغة عربية سليمة: «يوم واحد» · «يومان» · «7 أيام» · «14 يومًا»
        const word = days === 1 ? 'يوم واحد' : days === 2 ? 'يومان'
                   : (days >= 3 && days <= 10) ? days + ' أيام'
                   : (days >= 11 && days <= 99) ? days + ' يومًا' : days + ' يوم';
        const parts = [];
        // «ملاحظة المالك» تُدمج في الجملة نفسها بدل جملة مقتطعة بعد نقطة
        if (days > 0) return 'يمكن الإرجاع خلال ' + word + ' من تاريخ الفاتورة' + (note ? '، ' + note : '، بشرط أن يكون الصنف بحالته الأصلية.');
        return note;
    }

    function legalContent(kind) {
        const store = esc(settings.store || 'المتجر');
        const contact = settings.phone ? (' — للتواصل: ' + esc(settings.phone)) : '';
        if (kind === 'privacy') return {
            title: '🔒 الخصوصية — ما نجمعه فعلًا',
            html: '<p>نجمع الحد الأدنى فقط لتشغيل المتجر:</p>' +
                  '<ul style="line-height:2;padding-inline-start:20px">' +
                  '<li><b>بيانات الفواتير:</b> اسم العميل، الأصناف، الكميات، الأسعار، اسم البائع والوقت.</li>' +
                  '<li><b>حساب الدخول:</b> البريد الإلكتروني وكلمة مرور مشفّرة (للعاملين والمدير).</li>' +
                  '<li><b>محليًا على جهازك:</b> نسخة من البيانات تعمل بلا إنترنت، وتبقى عليه.</li>' +
                  '</ul>' +
                  '<p><b>أين تُحفظ:</b> في قاعدة بيانات المتجر السحابية (Supabase) ومن يستطيع قراءتها هم العاملون المسجّلون فقط بحسب صلاحياتهم — سياسات القراءة تُطبَّق على مستوى قاعدة البيانات لا على مستوى الواجهة.</p>' +
                  '<p><b>ما لا نفعله:</b> لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث، ولا نرسل تفاصيل فواتيرك إلى أي خدمة خارجية.</p>' +
                  '<p><b>جهازك:</b> يمكنك مسح البيانات المحلية من إعدادات المتصفح' + contact + '.</p>'
        };
        if (kind === 'terms') return {
            title: '📄 شروط الاستخدام',
            html: '<p>باستخدامك ' + store + ' فإنك توافق على ما يلي:</p>' +
                  '<ul style="line-height:2;padding-inline-start:20px">' +
                  '<li>الأسعار المعروضة هي أسعار البيع الحالية، وتشمل ما يظهر في السلة قبل التأكيد.</li>' +
                  '<li>مصاريف الشحن (إن وُجدت) تُحسب عند إتمام الطلب، والإعفاء حسب المبلغ المحدَّد في الإعدادات.</li>' +
                  '<li>الأرقام المعروضة (عدد الأصناف والمخزون) تتحدّث تلقائيًا من مخزن المتجر الفعلي.</li>' +
                  '<li>الطلب يُسجَّل باسمك وبيانات تواصلك، ويبقى محفوظًا لدى المتجر لمتابعة التسليم.</li>' +
                  '<li>لا يُسمح باستخدام النظام لغير أغراض البيع والشراء المشروعة.</li>' +
                  '</ul>' +
                  '<p>الأسعار والمخزون قد يتغيّران؛ يُعتمد ما يظهر لحظة تأكيد الطلب' + contact + '.</p>'
        };
        return {
            title: '↩️ سياسة الإرجاع والاستبدال',
            html: '<p>' + esc(legalReturnText()) + '</p>' +
                  '<p><b>كيف يُنفَّذ الإرجاع:</b> بعد إلغاء الفاتورة في النظام <b>يُرجَع المخزون تلقائيًا</b> إلى الرصيد المعروض — فلا تبقى الكميات المُرْجَعة ناقصة من الجرد.</p>' +
                  '<p><b>ما يُستثنى عادةً:</b> الأصناف المستخدمة أو التالفة، والأصناف المقطوعة أو المصنّعة حسب الطلب — إلا إن كان بها عيب.</p>' +
                  '<p>أي إرجاع يتم بالتواصل المباشر مع المتجر' + contact + '.</p>'
        };
    }

    /** نفس النص المستخدم في الصفحة القانونية — ليكون مصدرًا واحدًا للحقيقة */
    function properReturnText() { return legalReturnText(); }

    function showLegal(kind) {
        const c = legalContent(kind);
        const body = document.getElementById('modalBody');
        if (!body) return;
        body.innerHTML =
            '<h2>' + c.title + '</h2>' +
            '<div style="font-size:.92rem;line-height:1.9">' + c.html + '</div>' +
            '<div style="margin-top:14px;font-size:.78rem;opacity:.75">آخر تحديث: ' + new Date().toLocaleDateString('ar-EG') + '</div>' +
            '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">فهمت</button></div>';
        // 🐞 كان classList.add('open') بلا قاعدة CSS مقابلة ⇒ النافذة لا تظهر إطلاقًا.
        // بقية التطبيق يفتحها بـstyle.display='flex' — نوحّد على نفس الطريقة.
        document.getElementById('modal').style.display = 'flex';
    }

    function renderLanding() {
        const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        set('landing-desc', settings.desc || '');
        set('landing-copyright', '© ' + new Date().getFullYear() + ' ' + (settings.store || '2M-Stor') + '.');
        const c = document.getElementById('landing-contact');
        if (c) {
            const rows = [];
            if (settings.phone) rows.push('<p>📞 ' + esc(settings.phone) + '</p>');
            if (settings.address) rows.push('<p>📍 ' + esc(settings.address) + '</p>');
            c.innerHTML = rows.length ? rows.join('') : '<p style="opacity:.7">لم تُضَف بيانات تواصل بعد — أضفها من الإعدادات.</p>';
        }
    }

    function setView(v) {
        // 🔒 T-A5: صفحة المخزن للعاملين والمدير فقط — كان العميل يقدر يفتحها ويرى قيمة المخزن ويعدّل الأرقام
        if (v === 'stock' && !isStaff()) { if (typeof toast === 'function') toast('⛔ صفحة المخزن للعاملين والمدير فقط'); v = 'shop'; }
        currentView = v;
        animateNextRender = true;
        document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
        const bs=document.getElementById('burger-stock'); if(bs) bs.classList.toggle('active', v === 'stock');
        const bh=document.getElementById('burger-shop'); if(bh) bh.classList.toggle('active', v === 'shop');
        const bhm=document.getElementById('burger-home'); if(bhm) bhm.classList.toggle('active', v === 'home');
        const bacc=document.getElementById('burger-account'); if(bacc) bacc.classList.toggle('active', v === 'account');
        document.querySelectorAll('.nav-links-desktop a').forEach(a=>a.classList.toggle('active', a.dataset.route===v));
        document.body.classList.toggle('shop-mode', v === 'shop');
        const hv=document.getElementById('homeView'), ac=document.getElementById('appContent'), av=document.getElementById('accountView');
        if(hv&&ac&&av){
            if(v==='home'){ hv.style.display='block'; ac.style.display='none'; av.style.display='none'; renderHome(); }
            else if(v==='account'){ hv.style.display='none'; ac.style.display='none'; av.style.display='block'; renderAccount(); }
            else { hv.style.display='none'; av.style.display='none'; ac.style.display='block'; renderFilterRow(); renderAll(); }
        } else { renderFilterRow(); renderAll(); }
        closeBurger();
        window.scrollTo({top:0,behavior:'smooth'});
    }
    function renderFilterRow() {
        const row = document.getElementById('filterRow');
        if (!row) return;
        if (currentView === 'stock') {
            row.innerHTML = '<select id="stockFilter" onchange="renderAll()">' +
                '<option value="all">📋 الكل</option><option value="available">✅ متوفر</option>' +
                '<option value="low">⚠️ منخفض</option><option value="out">❌ نافذ</option></select>';
        } else if (currentView === 'shop') {
            row.innerHTML = '<div class="shop-controls" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
                + '<select id="stockFilter" onchange="renderAll()"><option value="all">📋 الكل</option><option value="available">✅ متوفر</option><option value="out">❌ غير متوفر</option></select>'
                + '<select id="sortSelect" onchange="shopSort=this.value;renderAll()"><option value="default">الترتيب الافتراضي</option><option value="qs-desc">المتاح: الأعلى</option><option value="price-asc">السعر: الأقل → الأعلى</option><option value="price-desc">السعر: الأعلى → الأقل</option><option value="name-asc">الاسم: أ→ي</option></select>'
                + '<label style="display:flex;gap:6px;align-items:center;font-weight:800;font-size:.82rem;cursor:pointer;margin-right:auto"><input type="checkbox" id="favOnly" '+(shopFavOnly?'checked':'')+' onchange="shopFavOnly=this.checked;renderAll()"> ❤️ المفضلة فقط</label>'
                + '</div>';
            const ss=document.getElementById('sortSelect'); if(ss) ss.value=shopSort;
        } else {
            row.innerHTML='';
        }
    }

    function selectCat(val) {
        currentCat = val;
        shopLimit = shopPageSize;
        animateNextRender = true;
        renderAll();
        closeBurger();
    }

    function getFilteredItems(search, catFilter) {
        let results = [];
        db.forEach((cat, ci) => {
            if (catFilter !== 'all' && ci !== catFilter) return;
            cat.items.forEach((item, ii) => {
                if (search && !item.n.toLowerCase().includes(search.toLowerCase())) return;
                results.push({ cat: cat, ci: ci, item: item, ii: ii });
            });
        });
        return results;
    }


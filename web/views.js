    // ===== RENDER ENGINE =====
    function renderAll() {
        updateStats();
        renderLanding();   // 🏪 T4.2: وصف المتجر وبيانات التواصل من الإعدادات
        renderCats();
        if(currentView==='home'){ renderHome(); return; }
        if(currentView==='account'){ renderAccount(); return; }
        const anim = animateNextRender;
        animateNextRender = false;
        if (anim) {
            const st = document.getElementById('sectionTitle');
            if (st) { st.classList.remove('view-swap'); void st.offsetWidth; st.classList.add('view-swap'); }
        }
        if (currentView === 'stock') renderStockView(anim);
        else renderShopView(anim);
    }
    function debouncedRenderAll() {
      if (searchDebounce) clearTimeout(searchDebounce);
      shopLimit = shopPageSize;
      searchDebounce = setTimeout(() => renderAll(), 250);
    }
    function loadMoreShop() { shopLimit += shopPageSize; renderShopView(false); }
    function renderHome(){
        const hv=document.getElementById('homeView'); if(!hv) return;
        // إحصائيات حية من المخزن
        let totalProducts=db.reduce((a,c)=>a+c.items.length,0);
        let totalCats=db.length;
        let avail=db.reduce((a,c)=>a+c.items.filter(it=>getQs(it)>0).length,0);
        // منتجات مميزة: أعلى qs أو عشوائي
        let allItems=[]; db.forEach((cat,ci)=>cat.items.forEach((it,ii)=>allItems.push({cat,ci,it,ii})));
        allItems.sort((a,b)=>getQs(b.it)-getQs(a.it));
        let featured=allItems.slice(0,4);
        let featHtml=featured.length?featured.map(({cat,ci,it,ii})=>{
            let img=it.img?'<img src="'+esc(it.img)+'" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:2.2rem">📦</span>';
            let qs=getQs(it);
            return '<div class="shop-card" style="cursor:pointer" onclick="setView(\'shop\'); setTimeout(()=>openProductDetail('+ci+','+ii+'),120)">'
                +'<div class="shop-img" style="height:150px">'+img+'</div>'
                +'<div class="shop-body"><div class="shop-name">'+esc(it.n)+'</div><div style="font-size:.82rem;color:var(--text-muted)">'+esc(cat.name)+'</div><div class="shop-price">'+esc(it.p)+' <span>ج.م</span></div>'+(qs>0?'<div class="shop-avail ok">'+availText(it)+'</div>':'<div class="shop-avail no">غير متوفر</div>')+'</div>'
                +'<button class="cart-add" onclick="event.stopPropagation();addToCart('+ci+','+ii+');toast(\'✅ أُضيف للسلة\')">🛒 أضف</button></div>';
        }).join(''):'<div class="empty-state"><div class="icon">📭</div>لا توجد منتجات بعد</div>';
        hv.innerHTML=`
        <section class="hero">
          <div class="hero-grid">
            <div>
              <!-- 🔒 T4.1: حُذفت شارة تفضيلية غير قابلة للإثبات (ادعاء تميّز بلا دليل) -->
              <h1>منصة <span class="grad">2M-Stor</span><br>كل ما تحتاجه في مكان واحد</h1>
              <!-- 🏪 T4.2: الوصف من الإعدادات — لا ادعاء نشاط غير موجود -->
              <p>${esc(settings.desc || '')} مع مزامنة فورية على كل أجهزتك.</p>
              <div class="hero-actions">
                <button class="btn" onclick="setView('shop')">تصفّح المتجر ←</button>
                ${(sessionUser || cloudProfile) ? '' : '<button class="btn btn-outline" onclick="showRegister()">➕ إنشاء حساب جديد</button>'}
                ${(sessionUser || cloudProfile) ? '' : '<button class="btn btn-ghost" onclick="showLogin()">🔓 تسجيل الدخول</button>'}
                <button class="btn btn-ghost" onclick="document.getElementById('landing-features').scrollIntoView({behavior:'smooth'})">من نحن</button>
              </div>
              <div class="hero-stats">
                <div class="stat"><h3 data-count="${totalProducts}">0</h3><span>منتج</span></div>
                <div class="stat"><h3 data-count="${totalCats}">0</h3><span>قسم</span></div>
                <div class="stat"><h3 data-count="${avail}">0</h3><span>متاح الآن</span></div>
              </div>
            </div>
            <div class="hero-visual">
              <div class="blob">📚</div>
              <div class="float-card fc1"><span class="ic">🚚</span><div><b>توصيل سريع</b><small>خلال 24 ساعة</small></div></div>
            <!-- 🔒 T4.1: حُذفت بطاقة تقييمات وعملاء بأرقام غير حقيقية.
                 الأرقام الحقيقية موجودة في hero-stats وهي محسوبة من بياناتك. -->

          </div>
        </section>
        <section class="landing-section" id="landing-features">
          <div class="landing-head"><span class="tag">لماذا نحن</span><h2>ما يميز 2M-Stor</h2><p>تجربة تسوّق سلسة من البداية حتى وصول طلبك</p></div>
          <div class="features">
            <div class="feature"><div class="icon">🚚</div><h3>توصيل سريع</h3><p>نوصل طلبك خلال 24 ساعة في جميع المناطق.</p></div>
            <div class="feature"><div class="icon">💰</div><h3>أسعار منافسة</h3><p>أفضل الأسعار مع عروض وخصومات مستمرة.</p></div>
            <div class="feature"><div class="icon">✅</div><h3>جودة مضمونة</h3><p>منتجات أصلية 100% من علامات موثوقة.</p></div>
            <div class="feature"><div class="icon">🔄</div><h3>إرجاع سهل</h3><p>سياسة إرجاع مرنة خلال 14 يوماً.</p></div>
          </div>
        </section>
        <section class="landing-section" style="padding-top:0">
          <div class="landing-head"><span class="tag">تشكيلتنا</span><h2>منتجات مميزة</h2><p>لمحة من أفضل منتجاتنا المتاحة الآن</p></div>
          <div class="shop-grid" style="max-width:1200px;margin:0 auto;padding:0 20px">${featHtml}</div>
          <div style="text-align:center;margin-top:28px"><button class="btn" onclick="setView('shop')">عرض كل المنتجات ←</button></div>
        </section>
        <!-- 🔒 T4.1 (2026-09-21): حُذف قسم «آراء العملاء» بالكامل — كان يحتوي آراء مفبركة
             بأسماء أشخاص لا وجود لهم، وهو مخالف لقوانين حماية المستهلك ويُفقد الثقة عند
             اكتشافه. لإعادته بشكل قانوني: اجمع آراء عملاء حقيقيين بإذنهم، ثم أعد بناءه بنفس
             البنية (class="testimonials" > class="testimonial" > .quote + p + .who). -->
`;
        // عدادات متحركة
        hv.querySelectorAll('[data-count]').forEach(el=>{const t=+el.dataset.count;let c=0;const step=Math.ceil(t/60)||1;const tick=()=>{c+=step;if(c>=t) el.textContent=t.toLocaleString('ar-EG')+'+'; else{el.textContent=c.toLocaleString('ar-EG'); requestAnimationFrame(tick);}}; requestAnimationFrame(tick);});
    }
    function renderAccount(){
        const av=document.getElementById('accountView'); if(!av) return;
        if(!sessionUser){
            av.innerHTML='<div class="empty-state"><div class="icon">🔒</div>سجّل دخولك لعرض حسابك<br><button class="btn btn-primary" style="margin-top:14px" onclick="showLogin()">🔓 تسجيل الدخول</button></div>';
            return;
        }
        const me=cloudProfile || {u:sessionUser, name:sessionUser, role:sessionRole};
        const roleNames={admin:'🛡️ مدير', worker:'👷 عامل', customer:'👤 عميل'};
        const myOrders=invoices.filter(o=> (o.user===sessionUser) || (o.email===sessionUser) || (o.customer===sessionUser));
        const favProducts=[]; favs.forEach(k=>{ const [ci,ii]=k.split(':').map(Number); const cat=db[ci]; const it=cat&&cat.items[ii]; if(it) favProducts.push({ci,ii,cat,it}); });
        let content='';
        if(accTab==='profile'){
            content='<div class="card-box" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow-sm)">'
                +'<div class="profile-head"><div class="big-avatar">'+esc((me.display_name||me.name||me.u||sessionUser).slice(0,2))+'</div><div><h2>'+esc(me.display_name||me.name||me.u||sessionUser)+'</h2><p style="color:var(--text-muted);font-weight:700">'+esc(me.username||me.u||sessionUser)+' · '+(roleNames[sessionRole]||sessionRole)+'</p></div></div>'
                +'<div class="ct-row"><span>نوع الحساب</span><span>'+(roleNames[sessionRole]||sessionRole)+'</span></div>'
                +'<div class="ct-row"><span>عدد الطلبات</span><span>'+myOrders.length+'</span></div>'
                +'<div class="ct-row"><span>المفضلة</span><span>'+favProducts.length+' منتج</span></div>'
                +'<div class="ct-row"><span>السلة</span><span>'+cartCount()+' قطعة</span></div>'
                +'</div>';
        } else if(accTab==='orders'){
            const isMgr=canManageOrders();
            const list=isMgr ? invoices : myOrders;
            if(!list.length) content='<div class="empty-state"><div class="icon">📦</div>'+w('ordersEmpty')+'<br><button class="btn btn-outline" style="margin-top:12px" onclick="setView(\'shop\')">🏪 تسوق الآن</button></div>';
            else content=list.slice().reverse().map(o=>{
                const idx=invoices.indexOf(o);
                const d=new Date(o.date);
                const st=o.status||'قيد المعالجة';
                const sc=statusClass(st);
                const canCancel = (o.user===sessionUser || o.customer===sessionUser) && st!=='تم التوصيل' && st!=='تم رفض الطلب' && st!=='ملغي';
                let actions='';
                if(isMgr){
                    actions='<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">'
                        +'<select onchange="updateOrderStatus('+idx+', this.value)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);font-weight:700">'
                        +ORDER_STATUSES.filter(s=>s!=='ملغي').map(s=>'<option value="'+s+'" '+(s===st?'selected':'')+'>'+s+'</option>').join('')
                        +'</select>'
                        +(st!=='ملغي'&&st!=='تم التوصيل'?'<button class="btn btn-outline" style="padding:6px 12px;font-size:.78rem;color:var(--danger);border-color:var(--danger)" onclick="cancelOrder('+idx+')">إلغاء</button>':'')
                        +'</div>';
                } else if(canCancel){
                    actions='<div style="margin-top:10px"><button class="btn btn-outline" style="padding:6px 12px;font-size:.78rem;color:var(--danger);border-color:var(--danger)" onclick="cancelOrder('+idx+')">❌ إلغاء الطلب</button></div>';
                }
                return '<div class="order-card"><div class="oc-head"><b>طلب #'+(o.no?String(o.no).padStart(4,'0'):o.id)+'</b><span class="status '+sc+'">'+esc(st)+'</span></div>'
                    +'<div class="oc-items">'+o.items.map(i=>esc(i.name)+' ×'+i.qty).join(' • ')+'</div>'
                    +'<div class="ct-row" style="margin-top:10px;font-weight:900"><span>'+d.toLocaleDateString('ar-EG')+' · '+(isMgr?esc(o.user||o.customer):'')+'</span><span style="color:var(--primary)">'+fmt(o.total)+' ج.م</span></div>'+actions+'</div>';
            }).join('');
        } else if(accTab==='fav'){
            if(!favProducts.length) content='<div class="empty-state"><div class="icon">❤️</div>قائمة المفضلة فارغة<br><button class="btn btn-outline" style="margin-top:12px" onclick="setView(\'shop\')">تصفح المنتجات</button></div>';
            else {
                content='<div class="shop-grid">'+favProducts.map(({cat,ci,it,ii})=>{
                    let img=it.img?'<img src="'+esc(it.img)+'" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">':'📦';
                    return '<div class="shop-card" onclick="openProductDetail('+ci+','+ii+')"><div class="shop-img" style="height:130px;position:relative"><button style="position:absolute;top:8px;left:8px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.95);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.1);z-index:1" onclick="event.stopPropagation();toggleFav('+ci+','+ii+');renderAccount()">❤️</button>'+img+'</div><div class="shop-body"><div class="shop-name">'+esc(it.n)+'</div><div class="shop-price">'+esc(it.p)+' ج.م</div></div></div>';
                }).join('')+'</div>';
            }
        }
        av.innerHTML='<div class="landing-head" style="margin-bottom:24px"><span class="tag">'+w('account')+'</span><h2>مرحباً '+esc(me.display_name||me.name||me.u||sessionUser)+'</h2></div>'
            +'<div class="account-grid"><div class="account-nav">'
            +'<button class="'+(accTab==='profile'?'active':'')+'" onclick="accTab=\'profile\';renderAccount()">👤 '+w('profile')+'</button>'
            +'<button class="'+(accTab==='orders'?'active':'')+'" onclick="accTab=\'orders\';renderAccount()">'+w('orders')+' ('+(canManageOrders()?invoices.length:myOrders.length)+')</button>'
            +'<button class="'+(accTab==='fav'?'active':'')+'" onclick="accTab=\'fav\';renderAccount()">'+w('fav')+' ('+favProducts.length+')</button>'
            +'<button onclick="logout()">🚪 خروج</button>'
            +'</div><div>'+content+'</div></div>';
    }

    function renderCats() {
        const bar = document.getElementById('catBar');
        if (!bar) return;
        let html = '<button class="cat-chip' + (currentCat === 'all' ? ' active' : '') + '" onclick="selectCat(\'all\')"><span class="cat-chip-name">📋 الكل</span><span class="cat-count">' + db.reduce((a, c) => a + c.items.length, 0) + '</span></button>';
        db.forEach((cat, i) => {
            html += '<button class="cat-chip' + (currentCat === i ? ' active' : '') + '" onclick="selectCat(' + i + ')"><span class="cat-chip-name">' + esc(cat.name) + '</span><span class="cat-count">' + cat.items.length + '</span></button>';
        });
        bar.innerHTML = html;
        const active = bar.querySelector('.cat-chip.active');
        if (active && active.scrollIntoView) { try { active.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }
    }

    function updateStats() {
        let total = 0, low = 0, out = 0;
        db.forEach(c => c.items.forEach(item => {
            total++;
            let q = getQ(item);
            if (q === 0) out++;
            else if (q <= getMin(item)) low++;
        }));
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-low').textContent = low;
        document.getElementById('stat-out').textContent = out;
        let today = new Date().toDateString();
        let salesTotal = invoices.filter(inv => new Date(inv.date).toDateString() === today).reduce((s, inv) => s + inv.total, 0);
        document.getElementById('stat-sales').textContent = salesTotal > 0 ? '💰' + fmt(salesTotal) : '💰0';
        // شريط تنبيه المخزون المنخفض
        const bar = document.getElementById('alertBar');
        if (bar) {
            if (low + out > 0 && can('add')) {
                bar.style.display = 'flex';
                document.getElementById('alertText').textContent = 'صناف تحت الحد الأدنى (منخفض ' + low + ' · نافذ ' + out + ') — اضغط للمراجعة';
                document.getElementById('alertCount').textContent = low + out;
            } else bar.style.display = 'none';
        }
    }

    // ===== LOW STOCK ALERTS (تنبيهات المخزون) =====
    function openAlertsModal() {
        if (!can('add')) return;
        const list = [];
        db.forEach((c, ci) => c.items.forEach((it, ii) => {
            if (getQ(it) <= getMin(it)) list.push({ ci, ii, item: it, cat: c.name });
        }));
        list.sort((a, b) => (getQ(a.item) - getMin(a.item)) - (getQ(b.item) - getMin(b.item)));
        const body = document.getElementById('modalBody');
        body.innerHTML =
            '<h2>⚠️ تنبيهات <span class="accent">المخزون</span> (' + list.length + ')</h2>' +
            (list.length ? '<div class="inv-history">' + list.map(x =>
                '<div class="inv-hist-item" style="cursor:default"><div class="inv-hi-top"><span>' + esc(x.item.n) + ' <span style="font-size:0.7rem;color:var(--text-muted)">· ' + esc(x.cat) + '</span></span>' +
                '<span style="color:' + (getQ(x.item) === 0 ? 'var(--danger)' : '#e17055') + ';font-weight:800;font-size:0.85rem">' + (getQ(x.item) === 0 ? 'نافذ ❌' : 'متبقي ' + getQ(x.item) + ' (الحد ' + getMin(x.item) + ')') + '</span></div></div>'
            ).join('') + '</div>' : '<div class="empty-state"><div class="icon">✅</div>كل الأصناف فوق الحد الأدنى</div>') +
            '<div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">إغلاق</button></div>';
        document.getElementById('modal').style.display = 'flex';
    }

    // ===== STOCK VIEW (المخزن) =====
    function renderStockView(anim) {
        let search = document.getElementById('searchInput').value.trim();
        let items = getFilteredItems(search, currentCat);
        let f = document.getElementById('stockFilter') ? document.getElementById('stockFilter').value : 'all';
        if (f === 'available') items = items.filter(({item}) => getQ(item) > 0);
        else if (f === 'low') items = items.filter(({item}) => getQ(item) > 0 && getQ(item) <= 5);
        else if (f === 'out') items = items.filter(({item}) => getQ(item) === 0);

        let title = currentCat === 'all' ? 'جميع المنتجات' : db[currentCat].name;
        let totalVal = 0;
        items.forEach(({item}) => totalVal += getQ(item) * itemPrice(item));
        document.getElementById('sectionTitle').innerHTML =
            '<span>📋 ' + esc(title) + ' <span class="cat-count">' + items.length + '</span></span>' +
            '<span class="total-val">💰 قيمة المخزن: ' + fmt(totalVal) + ' ج.م</span>';
        let container = document.getElementById('view-root');
        container.classList.toggle('no-anim', !anim);
        if (items.length === 0) {
            // ☁️ T-A4: نبني الحالة من مصدر البيانات — كان المستخدم يرى «لا توجد نتائج»
            // ولا يعرف أن السبب أن البيانات تُحمَّل من السحابة أو أن الاتصال انقطع.
            const noData = db.length === 0;
            const connecting = (typeof cloudStatus !== 'undefined') && cloudStatus !== 'on';
            const icon = noData ? (connecting ? '⏳' : '📡') : '🔍';
            const msg = noData
                ? (connecting ? 'جاري تحميل المنتجات من السحابة…' : 'تعذّر تحميل المنتجات — راجع اتصال الإنترنت وأعد المحاولة')
                : 'لا توجد نتائج';
            const btn = noData
                ? '<button class="btn btn-outline" style="margin-top:12px" onclick="location.reload()">🔄 إعادة المحاولة</button>'
                : '';
            container.innerHTML = '<div class="empty-state"><div class="icon">' + icon + '</div>' + msg + '<br>' + btn + '</div>';
            return;
        }
        let html = '<div class="product-grid">';
        items.forEach(({cat, ci, item, ii}, idx) => {
            let delay = anim ? ' style="animation-delay:' + Math.min(idx * 35, 320) + 'ms"' : '';
            let q = getQ(item), qs = getQs(item);
            let price = itemPrice(item);
            let cls = q <= 0 ? 'danger' : (q <= 5 ? 'warn' : '');
            let thumb = item.img
                ? '<img class="card-thumb" src="' + esc(item.img) + '" alt="" loading="lazy" decoding="async">'
                : '<div class="card-thumb card-thumb-fb">📦</div>';
            let bHtml = item.b ? '<span class="qr-badge">🔳 ' + esc(item.b) + '</span>' : '';
            html +=
                '<div class="product-card"' + delay + ' onclick="openModal(\'edit\',' + ci + ',' + ii + ')">' +
                    '<div class="stock-card-top">' +
                        thumb +
                        '<div class="stock-card-info">' +
                            '<div class="product-name">' + highlightName(item.n, search) + ' <span class="cat">' + esc(cat.name) + '</span>' + bHtml + '</div>' +
                            '<div class="product-price">' + esc(item.p) + ' <small>ج.م</small></div>' +
                            '<div class="stock-qs">🏪 معروض للبيع: ' + qs + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="qty-row">' +
                        '<div class="qty-box">' +
                            '<span>📦 في المخزن</span>' +
                            '<button class="qty-btn minus" onclick="event.stopPropagation();adjustQty(' + ci + ',' + ii + ',\'q\',-1)">−</button>' +
                            '<span class="val ' + cls + '">' + q + '</span>' +
                            '<button class="qty-btn plus" onclick="event.stopPropagation();adjustQty(' + ci + ',' + ii + ',\'q\',1)">+</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="total-row"><span>قيمة المخزن</span><span class="num">' + fmt(q * price) + ' ج.م</span></div>' +
                '</div>';
        });
        container.innerHTML = html + '</div>';
    }

    function adjustQty(ci, ii, field, delta) {
        let item = db[ci] && db[ci].items[ii];
        if (!item) return;
        if (field === 'q') {
            item.q = Math.max(0, (item.q || 0) + delta);
        } else {
            item.qs = Math.max(0, (item.qs || 0) + delta);
        }
        queue({ t: 'item-upd', lid: item.lid, catLid: db[ci].lid });
        save();
    }

    // ===== SHOP VIEW (العرض) — مع pagination وlazy وتلقائي السحابة =====
    function renderShopView(anim) {
        let search = document.getElementById('searchInput').value.trim();
        let items = getFilteredItems(search, currentCat);
        let f = document.getElementById('stockFilter') ? document.getElementById('stockFilter').value : 'all';
        if (f === 'available') items = items.filter(({item}) => getQs(item) > 0);
        else if (f === 'out') items = items.filter(({item}) => getQs(item) === 0);

        let title = currentCat === 'all' ? 'جميع المنتجات' : db[currentCat].name;
        let availSum = 0;
        items.forEach(({item}) => availSum += getQs(item));
        document.getElementById('sectionTitle').innerHTML =
            '<span>🏪 ' + esc(title) + ' <span class="cat-count">' + items.length + '</span></span>' +
            (isStaff()
                ? '<span class="total-val">🛒 متاح: ' + fmt(availSum) + ' قطعة</span>'
                : '<span class="total-val">🛒 ' + fmt(items.filter(x => getQs(x.item) > 0).length) + ' منتج متاح</span>');
        // فلتر المفضلة
        if(shopFavOnly){
            items = items.filter(({ci,ii})=> isFav(ci,ii));
            if(items.length===0){
                let container2=document.getElementById('view-root');
                if(container2) container2.classList.toggle('no-anim', !anim);
                document.getElementById('sectionTitle').innerHTML='<span>❤️ المفضلة <span class="cat-count">0</span></span><span class="total-val">—</span>';
                const cont=document.getElementById('view-root');
                cont.innerHTML='<div class="empty-state"><div class="icon">❤️</div>لا توجد منتجات في المفضلة<br><button class="btn btn-outline" style="margin-top:12px" onclick="shopFavOnly=false;const cb=document.getElementById(\'favOnly\'); if(cb) cb.checked=false; renderAll()">عرض الكل</button></div>';
                return;
            }
        }
        // ترتيب حسب اختيار المستخدم
        if(shopSort==='price-asc') items.sort((a,b)=> itemPrice(a.item)-itemPrice(b.item));
        else if(shopSort==='price-desc') items.sort((a,b)=> itemPrice(b.item)-itemPrice(a.item));
        else if(shopSort==='name-asc') items.sort((a,b)=> a.item.n.localeCompare(b.item.n,'ar'));
        else if(shopSort==='qs-desc') items.sort((a,b)=> getQs(b.item)-getQs(a.item));
        else items.sort((a,b)=> getQs(b.item)-getQs(a.item));
        if(shopFavOnly){
            document.getElementById('sectionTitle').innerHTML='<span>❤️ المفضلة <span class="cat-count">'+items.length+'</span></span>' + (isStaff() ? '<span class="total-val">🛒 متاح: '+fmt(items.reduce((s,{item})=>s+getQs(item),0))+' قطعة</span>' : '<span class="total-val">❤️ '+items.length+' منتج</span>');
        }
        let container = document.getElementById('view-root');
        container.classList.toggle('no-anim', !anim);
        if (items.length === 0) {
            // ☁️ T-A4: نبني الحالة من مصدر البيانات — كان المستخدم يرى «لا توجد نتائج»
            // ولا يعرف أن السبب أن البيانات تُحمَّل من السحابة أو أن الاتصال انقطع.
            const noData = db.length === 0;
            const connecting = (typeof cloudStatus !== 'undefined') && cloudStatus !== 'on';
            const icon = noData ? (connecting ? '⏳' : '📡') : '🔍';
            const msg = noData
                ? (connecting ? 'جاري تحميل المنتجات من السحابة…' : 'تعذّر تحميل المنتجات — راجع اتصال الإنترنت وأعد المحاولة')
                : 'لا توجد نتائج';
            const btn = noData
                ? '<button class="btn btn-outline" style="margin-top:12px" onclick="location.reload()">🔄 إعادة المحاولة</button>'
                : '';
            container.innerHTML = '<div class="empty-state"><div class="icon">' + icon + '</div>' + msg + '<br>' + btn + '</div>';
            return;
        }
        let total = items.length;
        let display = items.slice(0, shopLimit);
        let html = '<div class="shop-grid">';
        display.forEach(({cat, ci, item, ii}, idx) => {
            let delay = anim ? ' style="animation-delay:' + Math.min(idx * 35, 320) + 'ms"' : '';
            let qs = getQs(item);
            let favActive=isFav(ci,ii);
            let favBtnHtml='<button class="fav-btn '+(favActive?'active':'')+'" style="position:absolute;top:8px;left:8px;width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.95);cursor:pointer;font-size:1rem;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:1;transition:transform .2s" onclick="event.stopPropagation();toggleFav('+ci+','+ii+')">'+(favActive?'❤️':'🤍')+'</button>';
            // 🔒 T1.1: esc() تمنع كسر خاصية src (XSS). ملاحظة مهمة: لا نقيّد بالـ https فقط
            // لأن التطبيق يستخدم data: URLs للمعاينة قبل رفع الصورة إلى Storage.
            let imgHtml = item.img ? '<img src="' + esc(item.img) + '" alt="" loading="lazy" decoding="async">' : '<span>📦</span>';
            let avail = '<div class="shop-avail ' + (qs > 0 ? 'ok' : 'no') + '">' + availText(item) + '</div>';
            let ex = invoiceCart.find(x => x.ci === ci && x.ii === ii);
            let cartBtn;
            if (ex) {
                cartBtn =
                    '<div class="shop-cartbar">' +
                        '<button class="cart-step" onclick="event.stopPropagation();decCart(' + ci + ',' + ii + ')">−</button>' +
                        '<span class="cart-badge-icon">🛒 ' + ex.qty + '</span>' +
                        '<button class="cart-step" onclick="event.stopPropagation();incCart(' + ci + ',' + ii + ')">+</button>' +
                    '</div>';
            } else {
                cartBtn = '<button class="cart-add' + (qs <= 0 ? ' disabled' : '') + '" onclick="event.stopPropagation();addToCart(' + ci + ',' + ii + ')">🛒 + إضافة للسلة</button>';
            }
            html +=
                '<div class="shop-card"' + delay + ' onclick="openProductDetail(' + ci + ',' + ii + ')">' +
                    '<div class="shop-img" style="position:relative;overflow:hidden">' + favBtnHtml + imgHtml + '</div>' +
                    '<div class="shop-body">' +
                        '<div class="shop-name">' + highlightName(item.n, search) + '</div>' +
                        '<div class="shop-price">' + esc(item.p) + ' <span>ج.م</span></div>' +
                        avail +
                    '</div>' +
                    cartBtn +
                '</div>';
        });
        html += '</div>';
        if (total > shopLimit) html += '<div style="text-align:center;margin-top:16px"><button class="btn btn-outline" onclick="loadMoreShop()">عرض المزيد (' + shopLimit + '/' + total + ')</button></div>';
        container.innerHTML = html;
    }

    // ===== PRODUCT DETAIL — أمازون: صور يسار | تفاصيل وسط | شراء يمين =====
    // 🔒 T1.1: صور المنتج الحالية (تُملأ عند الرسم) — تُستخدم في amzSetMain بدل
    // تمرير رابط الصورة كنص داخل onclick (كان يسمح بحقن جافاسكربت عبر الصورة)
    let amzThumbs = [];
    function amzSetMain(idx) {
        try {
            const t = amzThumbs[idx];
            if (!t || !t.img) return;
            const el = document.getElementById('amzMainImg');
            if (el) el.src = t.img;
            document.querySelectorAll('.amz-thumb').forEach((x, i) => x.classList.toggle('active', i === idx));
        } catch (e) {}
    }
    function openProductDetail(ci, ii) {
      const cat = db[ci], item = cat && cat.items[ii];
      if (!item) return;
      let qs = getQs(item), q = getQ(item), price = itemPrice(item), isAvail = qs>0;
      let availBadge = isAvail ? '<span style="color:#067D62;font-weight:800">\u2705 متوفر</span>' : '<span style="color:var(--danger);font-weight:800">\u274C غير متوفر</span>';
      // 🔴 T4.1: كان هنا تقييم «4.3» مبنيًا على (q+qs+7) — رقم مخترع يتغيّر
      // مع تغيّر المخزون. النظام لا يجمع تقييمات، فنقول ذلك بدل تلفيق رقم.
      const ratingNote = '<span style="color:var(--text-muted);font-size:0.82rem">💬 لا تُعرض تقييمات — النظام لا يجمعها</span>';
      // 🏪 T4.2: الشحن والضريبة من الإعدادات (كانا «500 ج.م» و«يشمل الضريبة» ثابتين)
      const shipFee = parseFloat(settings.shipping) || 0;
      const freeOver = parseFloat(settings.freeShip) || 0;
      const taxPct = parseFloat(settings.tax) || 0;
      const shipLine = freeOver > 0
        ? '🚚 شحن مجاني فوق ' + fmt(freeOver) + ' ج.م' + (shipFee > 0 ? ' — وإلا ' + fmt(shipFee) + ' ج.م' : '')
        : (shipFee > 0 ? '🚚 مصاريف الشحن ' + fmt(shipFee) + ' ج.م' : '🚚 بلا مصاريف شحن');
      const taxLine = taxPct > 0 ? '🧾 تُضاف ضريبة ' + taxPct + '% عند إتمام الطلب' : '🧾 لا ضريبة مضافة';
      // ⚖️ T4.3: نفس نص سياسة الإرجاع المعروض في الصفحات القانونية
      const returnLine = properReturnText();
      let mainImg = item.img ? '<img src="'+esc(item.img)+'" alt="" loading="eager" decoding="async" id="amzMainImg">' : '<span style="font-size:4rem">\uD83D\uDCE6</span>';
      // thumbnails من نفس الصنف + الصورة الرئيسية
      let thumbs = [item].concat(cat.items.filter((_,idx)=>idx!==ii).slice(0,4));
       // 🔒 T1.1 (2026-09-21): كان هذا الموضع الأخطر — رابط الصورة يُحقن داخل جافاسكربت
       // في السمة onclick، أي أن صورة ضارة = تنفيذ كود تعسّفي. الآن: نداء دالة بالفهرس فقط،
       // والصورة تُقرأ من البيانات مباشرة (لا نص يُبنى داخل سياق تنفيذي)، ومهربة في src.
       amzThumbs = thumbs;
       let thumbsHtml = thumbs.map((t,idx)=>'<div class="amz-thumb'+(idx===0?' active':'')+'" onclick="amzSetMain('+idx+')">'+(t.img?'<img src="'+esc(t.img)+'" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">':'\uD83D\uDCE6')+'</div>').join('');
      // 🔒 T-A5: بنود المخزون/القيمة للعامل والمدير فقط — العميل يرى السعر والتوفر
      let bullets = isStaff()
        ? '<ul class="amz-bullets"><li>الصنف: <b>'+esc(cat.name)+'</b> — كود #'+(item.cid||'—')+'</li><li>السعر الرقمي: <b>'+price+' ج.م</b> — النص: '+esc(item.p)+'</li><li>المخزن: <b>'+q+'</b> · المعروض: <b>'+qs+'</b> · تنبيه عند <b>'+getMin(item)+'</b></li>'+(item.b?'<li>باركود: <b>'+esc(item.b)+'</b></li>':'')+'<li>قيمة المخزن: <b>'+fmt(q*price)+' ج.م</b> · المعروض: <b>'+fmt(qs*price)+' ج.م</b></li></ul>'
        : '<ul class="amz-bullets"><li>الصنف: <b>'+esc(cat.name)+'</b></li><li>السعر: <b>'+esc(item.p)+' ج.م</b></li><li>الحالة: <b>'+availText(item)+'</b></li></ul>';
      const availLine = isStaff() ? ('✅ متاح — '+qs+' قطعة جاهزة للشحن') : '✅ متوفر وجاهز للشحن';
      const qtyHint = isStaff() ? ('المتاح '+qs) : (qs <= 3 ? ('آخر '+qs+' قطع') : '');
      const metaExtra = isStaff() ? (' · 🔢 #'+(item.cid||'—')+(item.b?' · 🔳 '+esc(item.b):'')) : '';
      const availDetail = isStaff() ? ('📦 المتوفر الآن: '+qs+' قطعة · إجمالي المخزن: '+q) : ('📦 الحالة: '+(qs>0?'متوفر ✅':'غير متوفر ❌'));
      let qtyOpts = Array.from({length: Math.min(isStaff()?10:5, Math.max(1,qs))}, (_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join('');
      let buyBox = '<div class="amz-buybox"><div class="amz-buy-price">'+esc(item.p)+' <small>ج.م</small></div><div style="font-size:0.78rem;color:var(--text-muted)">+ مصاريف الشحن</div><div class="amz-buy-avail '+(isAvail?'ok':'no')+'">'+(isAvail?availLine:'❌ غير متوفر حالياً')+'</div><div class="amz-secure">🧾 يُحسب الإجمالي والشحن في السلة قبل التأكيد — بلا دفع إلكتروني في النظام</div><div class="amz-qty">الكمية: <select id="amzQty">'+qtyOpts+'</select> <span style="font-size:0.75rem;color:var(--text-muted)">'+qtyHint+'</span></div><button class="amz-btn-cart" onclick="let q=parseInt(document.getElementById(\'amzQty\').value)||1; for(let i=0;i<q;i++) addToCart('+ci+','+ii+'); closeProductDetail(); openCart()" '+(isAvail?'':'disabled style="opacity:0.5"')+'>🛒 إضافة إلى السلة</button><button class="amz-btn-buy" onclick="let q=parseInt(document.getElementById(\'amzQty\').value)||1; for(let i=0;i<q;i++) addToCart('+ci+','+ii+'); closeProductDetail(); openCart()" '+(isAvail?'':'disabled')+'>⚡ شراء الآن</button><div style="display:flex; gap:8px; margin-top:10px"><button class="btn btn-outline" style="flex:1;'+(isStaff()?'':'display:none')+'" onclick="closeProductDetail();openModal(\'edit\','+ci+','+ii+')">✏️ تعديل</button><button class="btn btn-ghost" style="flex:1" onclick="if(navigator.share) navigator.share({title:\''+esc(item.n).replace(/'/g,"\\'")+'\', text:\''+esc(item.p).replace(/'/g,"\\'")+'\'}).catch(()=>{})">🔗 مشاركة</button></div></div>';
      let related = cat.items.filter((_,idx)=> idx!==ii).slice(0,6);
       let relatedHtml = related.length ? '<div class="product-related-title">📦 منتجات من نفس الصنف — '+esc(cat.name)+'</div><div class="product-related">'+related.map(r=>{ let rIdx=cat.items.indexOf(r); let rImg=r.img?'<img src="'+r.img+'" loading="lazy" decoding="async">':'📦'; let rQs=getQs(r); return '<div class="related-card" onclick="openProductDetail('+ci+','+rIdx+')"><div class="related-card-img">'+rImg+'</div><div class="related-card-body"><div class="related-card-name">'+esc(r.n)+'</div><div class="related-card-price">'+esc(r.p)+' ج.م</div><div style="font-size:0.72rem;font-weight:700;color:'+(rQs>0?'#00c9a7':'#e5484d')+'">'+availText(r)+'</div></div></div>'; }).join('')+'</div>' : '';
      document.getElementById('productDetailCard').innerHTML =
        '<div style="padding:12px 18px; display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg-card); z-index:2"><button onclick="closeProductDetail()" style="background:var(--bg-soft); border:1px solid var(--border); width:40px; height:40px; border-radius:50%; cursor:pointer">←</button><span style="font-weight:800">تفاصيل المنتج</span><span style="margin-right:auto; font-size:0.75rem; color:var(--text-muted)">'+esc(cat.name)+'</span></div>' +
        '<div class="breadcrumb" style="padding:10px 18px;color:var(--text-muted);font-size:.88rem;background:var(--bg-soft);border-bottom:1px solid var(--border)"><a onclick="setView(\'home\');closeProductDetail()" style="cursor:pointer;color:var(--primary)">الرئيسية</a> / <a onclick="setView(\'shop\');closeProductDetail()" style="cursor:pointer;color:var(--primary)">المتجر</a> / '+esc(item.n)+'</div>' +
        '<div class="amz-layout">' +
          '<div class="amz-gallery"><div class="amz-main-img" id="amzMainWrap">'+mainImg+'</div><div class="amz-thumbs">'+thumbsHtml+'</div></div>' +
          '<div><div class="amz-title">'+esc(item.n)+'</div><div class="amz-meta">📂 '+esc(cat.name)+metaExtra+'</div><div class="amz-rating">'+ratingNote+'</div><div class="amz-price">'+esc(item.p)+' <small>ج.م</small></div><div style="font-size:0.8rem; color:var(--text-muted)">'+shipLine+' · '+taxLine+'</div>'+bullets+'<div class="pd-meta" style="display:flex;flex-direction:column;gap:8px;margin:14px 0;padding:12px;background:var(--bg-soft);border-radius:12px;border:1px solid var(--border);font-size:.88rem;font-weight:700">'+shipLine+'<div>'+availDetail+'</div><div>↩️ '+esc(returnLine)+' <a onclick="closeProductDetail();showLegal(\'returns\')" style="color:var(--primary);cursor:pointer;text-decoration:underline">التفاصيل</a></div></div><div class="amz-secure">ℹ️ الطلب يُسجَّل داخل نظام المتجر — وبعد إلغاء أي فاتورة يُرجَع المخزون تلقائيًا</div></div>' +
          buyBox +
          '<div class="amz-details"><div style="background:var(--bg-soft); padding:14px; border-radius:12px; font-size:0.85rem; line-height:1.8"><b>تفاصيل إضافية:</b><br>🏷️ الفئة: '+esc(cat.name)+'<br>💰 السعر: '+esc(item.p)+' ج.م<br>📦 الحالة: '+availText(item)+'</div>'+relatedHtml+'</div>' +
        '</div>';
      document.getElementById('productDetailOverlay').classList.add('open');
      window.scrollTo(0,0);
    }
    function closeProductDetail() { document.getElementById('productDetailOverlay').classList.remove('open'); }

    // ===== CART =====
    function addToCart(ci, ii) { incCart(ci, ii); }
    function incCart(ci, ii) {
        const item = db[ci] && db[ci].items[ii];
        if (!item) return;
        const max = getQs(item);
        const ex = invoiceCart.find(x => x.ci === ci && x.ii === ii);
        if (ex) {
            if (ex.qty >= max) return toast('⚠️ الكمية المتاحة: ' + max);
            ex.qty++;
        } else {
            if (max <= 0) return toast('⚠️ الصنف غير متوفر حالياً');
            invoiceCart.push({ ci, ii, qty: 1 });
        }
        afterCartChange();
    }
    function decCart(ci, ii) {
        const ex = invoiceCart.find(x => x.ci === ci && x.ii === ii);
        if (!ex) return;
        ex.qty--;
        if (ex.qty <= 0) invoiceCart.splice(invoiceCart.indexOf(ex), 1);
        afterCartChange();
    }
    function removeFromCart(i) {
        invoiceCart.splice(i, 1);
        afterCartChange();
    }
    function afterCartChange() {
        renderAll();
        updateCartBadge();
        if (document.getElementById('cartOverlay').classList.contains('open')) renderCart();
    }
    function cartCount() { return invoiceCart.reduce((s, x) => s + x.qty, 0); }
    function cartSubtotal() {
        return invoiceCart.reduce((s, x) => {
            const it = db[x.ci] && db[x.ci].items[x.ii];
            return it ? s + itemPrice(it) * x.qty : s;
        }, 0);
    }
    function applyCoupon(){
        const inp=document.getElementById('couponCode');
        const v=inp?inp.value.trim():'';
        const dEl=document.getElementById('cart-discount');
        const _cc = String(settings.couponCode || '').trim().toUpperCase();
        if(_cc && v === _cc){
            localStorage.setItem('al_sayed_coupon', _cc);
            if(dEl) dEl.value='10%';
            toast('✅ كوبون 10% تم تطبيقه');
        } else if(v===''){
            localStorage.removeItem('al_sayed_coupon');
            if(dEl) dEl.value='';
            toast('تم إزالة الكوبون');
        } else {
            toast(_cc ? ('⚠️ كود غير صحيح — جرب ' + _cc) : '⚠️ لا يوجد كوبون مُفعّل حاليًا');
            return;
        }
        recalcCart();
    }
    function cartTotals() {
        const subtotal = cartSubtotal();
        const dEl = document.getElementById('cart-discount');
        let discount = 0;
        if (dEl && dEl.value && dEl.value.trim()) {
            const dv = dEl.value.trim();
            if (dv.endsWith('%')) discount = subtotal * (parseFloat(dv) || 0) / 100;
            else discount = parseFloat(dv) || 0;
        }
        // 🔧 T3.5: الكوبون ونسبته من الإعدادات (كانا مكتوبين في الكود)
        const cCode = String(settings.couponCode || '').trim().toUpperCase();
        const cPct = parseFloat(settings.couponPct) || 0;
        const coupon = document.getElementById('couponCode');
        const usedCoupon = !!cCode && cPct > 0 && (
            (coupon && coupon.value.trim().toUpperCase() === cCode) ||
            (localStorage.getItem('al_sayed_coupon') || '').toUpperCase() === cCode
        );
        if (usedCoupon && (!dEl || !dEl.value.trim())) discount = subtotal * cPct / 100;
        discount = Math.max(0, Math.min(discount, subtotal));
        const tax = (subtotal - discount) * (settings.tax || 0) / 100;
        // 🔧 T3.5: الشحن من الإعدادات بدل 200/20 المكتوبتين
        const shipFee = (parseFloat(settings.shipping) || 0);
        const freeOver = (parseFloat(settings.freeShip) || 0);
        const shipping = subtotal <= 0 ? 0 : (freeOver > 0 && subtotal >= freeOver ? 0 : shipFee);
        return { subtotal: subtotal, discount: discount, tax: tax, shipping: shipping, total: subtotal - discount + tax + shipping };
    }
    function recalcCart() {
        const t = cartTotals();
        const sub = document.getElementById('cart-subtotal');
        const dis = document.getElementById('cart-discount-val');
        const tax = document.getElementById('cart-tax-val');
        const tot = document.getElementById('cart-total-val');
        const ship = document.getElementById('cart-shipping');
        if (sub) sub.textContent = fmt(t.subtotal) + ' ج.م';
        if (dis) dis.textContent = t.discount > 0 ? '−' + fmt(t.discount) + ' ج.م' : '—';
        if (tax) tax.textContent = t.tax > 0 ? fmt(t.tax) + ' ج.م' : '—';
        if (ship) ship.textContent = t.shipping ? fmt(t.shipping) + ' ج.م' : 'مجاني';
        if (tot) tot.textContent = fmt(t.total) + ' ج.م';
        document.getElementById('cartFabTotal').textContent = cartCount() ? fmt(cartTotals().total) + ' ج.م' : 'السلة';
    }
    function updateCartBadge() {
        const badge = document.getElementById('cartBadge');
        const n = cartCount();
        const grew = n > (badge._last || 0);
        badge._last = n;
        badge.style.display = n ? 'flex' : 'none';
        badge.textContent = n;
        if (n && grew) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
        if (document.getElementById('cart-total-val')) recalcCart();
    }

    function openCart() {
        renderCart();
        document.getElementById('cartOverlay').classList.add('open');
    }
    function closeCart() { document.getElementById('cartOverlay').classList.remove('open'); }
    function renderCart() {
        const body = document.getElementById('cartBody');
        const prevCustomer = document.getElementById('cart-customer') ? document.getElementById('cart-customer').value : '';
        if (invoiceCart.length === 0) {
            body.innerHTML =
                '<div class="empty-state" style="padding:50px 20px">' +
                    '<div class="icon">🛒</div>' +
                    'السلة فارغة<br>اذهب لصفحة العرض واضغط 🛒 على أي منتج' +
                '</div>' +
                '<div class="modal-actions" style="justify-content:center">' +
                    '<button class="btn btn-primary" onclick="closeCart();setView(\'shop\')">🏪 الذهاب لصفحة العرض</button>' +
                '</div>';
            return;
        }
        let html = '';
        let total = 0;
        invoiceCart.forEach((c, i) => {
            const cat = db[c.ci];
            const item = cat && cat.items[c.ii];
            if (!item) return;
            const price = itemPrice(item);
            const sub = price * c.qty;
            total += sub;
            const thumb = item.img ? '<img src="' + esc(item.img) + '" alt="" loading="lazy" decoding="async">' : '📦';
            html +=
                '<div class="cart-item">' +
                    '<div class="cart-thumb">' + thumb + '</div>' +
                    '<div class="cart-info">' +
                        '<div class="cart-name">' + esc(item.n) + '</div>' +
                        '<div class="cart-meta">' + esc(cat.name) + ' · ' + fmt(price) + ' ج.م / للقطعة</div>' +
                    '</div>' +
                    '<div class="qty-ctrl">' +
                        '<button class="q-minus" onclick="decCart(' + c.ci + ',' + c.ii + ')">−</button>' +
                        '<span>' + c.qty + '</span>' +
                        '<button class="q-plus" onclick="incCart(' + c.ci + ',' + c.ii + ')">+</button>' +
                    '</div>' +
                    '<div class="cart-sub">' + fmt(sub) + '</div>' +
                    '<button class="cart-remove" onclick="removeFromCart(' + i + ')">✕</button>' +
                '</div>';
        });
        // 🔧 T3.5: من الإعدادات
        const _shipFee = (parseFloat(settings.shipping) || 0);
        const _freeOver = (parseFloat(settings.freeShip) || 0);
        let shipping = (total > 0 && !(_freeOver > 0 && total >= _freeOver)) ? _shipFee : 0;
        let _couponApplied = !!settings.couponCode && (localStorage.getItem('al_sayed_coupon') || '').toUpperCase() === String(settings.couponCode).toUpperCase();
        let linesHtml = html;
        // نبني ملخص الطلب مع شحن وكوبون
        let summaryHtml='';
        if (can('invoice')) {
            summaryHtml =
                '<div class="summary">' +
                    '<h3>ملخص الطلب</h3>' +
                    '<div class="form-group" style="margin-top:6px"><label>👤 اسم العميل</label>' +
                        '<input type="text" id="cart-customer" placeholder="نقدي" value="' + esc(prevCustomer || '') + '">' +
                    '</div>' +
                    '<div class="coupon"><input id="couponCode" placeholder="'+(settings.couponCode?('كود الخصم (جرب '+esc(String(settings.couponCode))+')'):'لا يوجد كوبون مُفعّل')+'" value="'+(_couponApplied?esc(String(settings.couponCode)):'')+'"><button class="btn btn-outline" style="padding:11px 16px;white-space:nowrap" onclick="applyCoupon()">تطبيق</button></div>' +
                    '<div class="cart-totals">' +
                        '<div class="ct-row"><span>المجموع الفرعي</span><span id="cart-subtotal">—</span></div>' +
                        '<div class="ct-row"><span>الخصم</span><span id="cart-discount-val">—</span></div>' +
                        '<div class="ct-row"><span>الشحن</span><span id="cart-shipping">'+(shipping ? fmt(shipping)+' ج.م' : 'مجاني')+'</span></div>' +
                        '<div class="ct-row' + (settings.tax > 0 ? '' : ' style="display:none"') + '"><span>الضريبة' + (settings.tax > 0 ? ' (' + settings.tax + '%)' : '') + '</span><span id="cart-tax-val">—</span></div>' +
                    '</div>' +
                    '<div class="form-group" style="margin-top:10px"><label>🏷️ خصم إضافي (ج.م أو %)</label><input type="text" id="cart-discount" placeholder="0" oninput="recalcCart()"></div>' +
                    '<div class="cart-total-row" style="margin-top:0;border:none;padding-top:6px"><span>الإجمالي النهائي</span><span id="cart-total-val">—</span></div>' +
                    '<div class="modal-actions" style="justify-content:space-between;margin-top:10px">' +
                        '<button class="btn btn-outline" onclick="clearCart()">🗑️ إفراغ</button>' +
                        '<button class="btn btn-primary" onclick="createInvoiceFromCart()">🧾 إنشاء الفاتورة</button>' +
                    '</div>' +
                '</div>';
        } else {
            summaryHtml =
                '<div class="summary"><h3>ملخص الطلب</h3>' +
                '<div class="ct-row"><span>المجموع الفرعي</span><span>'+fmt(total)+' ج.م</span></div>' +
                '<div class="ct-row"><span>الشحن</span><span>'+(shipping ? fmt(shipping)+' ج.م' : 'مجاني')+'</span></div>' +
                '<div class="ct-row" style="font-weight:900;color:var(--primary)"><span>الإجمالي</span><span>'+fmt(total+shipping)+' ج.م</span></div>' +
                '<div style="text-align:center;margin-top:14px;font-size:0.85rem;font-weight:800;color:var(--text-muted)">👷 أكمل عملية الشراء عند العامل لطباعة الفاتورة</div>' +
                '<div class="modal-actions" style="justify-content:center;margin-top:12px"><button class="btn btn-outline" onclick="clearCart()">🗑️ تفريغ السلة</button></div>' +
                '</div>';
        }
        html = '<div class="cart-layout"><div class="cart-lines">'+linesHtml+'</div>'+summaryHtml+'</div>';
        body.innerHTML = html;
        if (can('invoice')) recalcCart();
    }
    function clearCart() {
        if (!confirm('إفراغ السلة بالكامل؟')) return;
        invoiceCart = [];
        afterCartChange();
        renderCart();
    }

    // ===== INVOICE =====
    function saveInvoices() {
        const s=JSON.stringify(invoices);
        try{ localStorage.setItem('al_sayed_invoices', s); }catch(e){ idbSet('al_sayed_invoices', s); }
        idbSet('al_sayed_invoices', s);
    }
    // ═══════════════════════════════════════════════════════════════
    //  📦 T3.3 — خصم المخزون الفعلي عند البيع واسترجاعه عند الإلغاء
    //  القاعدة: كل بيعة تُخصم من المخزون، وكل إلغاء يُرجّعها — وإلا الجرد وهمي.
    // ═══════════════════════════════════════════════════════════════
    function findItemForLine(line) {
        // الأدق: المعرّف المحلي (mutabile لو حُذف الصنف وأُعيد إنشاؤه)
        if (line.lid) {
            for (const c of db) {
                const hit = (c.items || []).find(it => it.lid === line.lid);
                if (hit) return { cat: c, item: hit };
            }
        }
        // ثم المعرّف السحابي
        if (line.itemCid) {
            for (const c of db) {
                const hit = (c.items || []).find(it => it.cid === line.itemCid);
                if (hit) return { cat: c, item: hit };
            }
        }
        // ثم الاسم داخل نفس القسم (للفواتير القديمة)
        for (const c of db) {
            if (line.cat && c.name !== line.cat) continue;
            const hit = (c.items || []).find(it => it.n === line.name);
            if (hit) return { cat: c, item: hit };
        }
        return null;
    }

    // يعيد عدد الأصناف التي تغيّر مخزونها. dir: +1 خصم · -1 استرجاع
    function applyStockForInvoice(inv, dir) {
        const mode = settings.stockMode || 'both';
        if (mode === 'off') return 0;
        let n = 0;
        (inv.items || []).forEach(line => {
            const hit = findItemForLine(line);
            if (!hit) return;
            const { cat, item } = hit;
            const qty = Math.abs(Number(line.qty) || 0);
            if (!qty) return;

            // المعروض للبيع دائمًا يتأثر (mode: both أو display)
            item.qs = Math.max(0, getQs(item) - dir * qty);
            // إجمالي المخزن — فقط في وضع «both» (البيع يخرج من المحل)
            if (mode === 'both') item.q = Math.max(0, getQ(item) - dir * qty);

            queue({ t: 'item-upd', lid: item.lid, catLid: cat.lid });
            n++;
        });
        if (n) save();
        return n;
    }

    // الحالات التي تعتبر «بيعة قائمة» (المخزون مخصوم فيها)
    const STOCK_HELD_STATUSES = ['قيد المعالجة', 'في الطريق', 'تم التوصيل'];
    function isStockHeld(status) { return STOCK_HELD_STATUSES.includes(status); }

    // يُطبَّق عند تغيّر حالة الفاتورة — يمنع الخصم/الاسترجاع المزدوج
    function syncStockForStatus(inv, prevStatus, newStatus) {
        const was = isStockHeld(prevStatus), now = isStockHeld(newStatus);
        if (was && !now) {
            // إلغاء أو رفض → استرجاع ما خُصم فعليًا
            const back = applyStockForInvoice(inv, -1);
            if (back) { inv.stockApplied = false; logAction('استرجاع مخزون', '#' + String(inv.no).padStart(4, '0') + ' — ' + back + ' صنف'); }
        } else if (!was && now) {
            // إعادة تنشيط طلب ملغي → خصم مرة أخرى
            const took = applyStockForInvoice(inv, +1);
            if (took) { inv.stockApplied = (settings.stockMode || 'both'); logAction('خصم مخزون', '#' + String(inv.no).padStart(4, '0') + ' — ' + took + ' صنف'); }
        }
    }

    function createInvoiceFromCart() {
        if (!can('invoice')) return toast('⚠️ لا تملك صلاحية إنشاء الفواتير');
        if (invoiceCart.length === 0) return toast('⚠️ السلة فارغة');
        const items = [];
        let total = 0;
        const shortage = [];
        for (const c of invoiceCart) {
            const cat = db[c.ci];
            const item = cat && cat.items[c.ii];
            if (!item) continue;
            const price = itemPrice(item);
            // 📦 T3.3: نحفظ معرّف الصنف مع السطر — بالاسم وحده كان الخصم يضيع
            items.push({ name: item.n, cat: cat.name, qty: c.qty, price: price,
                         lid: item.lid, itemCid: item.cid || null });
            total += price * c.qty;
            // فحص الرصيد المتاح (المعروض للبيع)
            const avail = getQs(item);
            if (c.qty > avail) shortage.push({ name: item.n, want: c.qty, avail: avail });
        }
        if (!items.length) return toast('⚠️ السلة فارغة');
        // 📦 T3.3: بيع أكثر من الرصيد — منع أو تنبيه حسب الإعداد
        if (shortage.length) {
            const txt = shortage.map(x => '«' + x.name + '»: مطلوب ' + x.want + ' والمتاح ' + x.avail).join(' · ');
            if ((settings.oversell || 'warn') === 'block') {
                return toast('⛔ لا يمكن البيع — الرصيد غير كافٍ: ' + txt, 6000);
            }
            logAction('⚠️ بيع بلا رصيد كافٍ', txt);
            toast('⚠️ تنبيه: ' + txt, 5000);
        }
        const customerEl = document.getElementById('cart-customer');
        const customer = customerEl && customerEl.value.trim() ? customerEl.value.trim() : 'نقدي';
        const t = cartTotals();
        invCounter++;
        localStorage.setItem('al_sayed_invno', String(invCounter));
        // 🔢 T3.1: الرقم هنا مؤقّت — يُستبدل بالرقم الرسمي عند الحفظ
        pendingInvoice = { id: Date.now(), date: new Date().toISOString(), customer: customer, items: items, total: t.total, subtotal: t.subtotal, discount: t.discount, tax: t.tax, user: sessionUser || '—', no: invCounter, noTemp: true, lid: genLid(), status: 'قيد المعالجة' };
        showReceiptPreview(pendingInvoice, true);
    }
    // ── 🔢 T3.1: الرقم الرسمي للفاتورة من السيرفر ─────────────────────
    // الثغرة D1: كان الرقم يُولَّد محليًا في كل جهاز، فجهازان يُنتجان
    // «فاتورة #7» مرتين. الآن التسلسل مركزي في القاعدة.
    // إن تعذّر الوصول (بلا شبكة) نكمل برقم مؤقت، والسيرفر يُثبّته عند الرفع.
    async function fetchOfficialInvoiceNo() {
        try {
            if (!sb || !navigator.onLine) return null;
            const call = sb.rpc('next_invoice_no');
            // مهلة قصيرة: الكاشير لا ينتظر 30 ثانية أمام العميل
            const timeout = new Promise(res => setTimeout(() => res({ error: 'timeout' }), 2500));
            const { data, error } = await Promise.race([call, timeout]);
            if (error) return null;
            const no = parseInt(data, 10);
            return (Number.isFinite(no) && no > 0) ? no : null;
        } catch (e) { return null; }
    }

    function showReceiptPreview(inv, backToCart) {
        const body = document.getElementById('modalBody');
        const rows = inv.items.map(it =>
            '<tr><td>' + esc(it.name) + '</td><td style="text-align:center">' + it.qty + '</td><td>' + fmt(it.price) + '</td><td style="font-weight:800;color:var(--primary);text-align:left">' + fmt(it.qty * it.price) + '</td></tr>'
        ).join('');
        const backBtn = backToCart
            ? '<button class="btn btn-outline" onclick="closeModal();openCart()">🔙 تعديل السلة</button>'
            : '<button class="btn btn-outline" onclick="showInvoiceHistory()">🔙 السجل</button>';
        const saveBtn = backToCart ? '<button class="btn btn-primary" onclick="confirmSaveInvoice()">💾 حفظ</button>' : '';
        const invNo = inv.no ? '#' + String(inv.no).padStart(4, '0') : '';
        const subTotal = inv.subtotal !== undefined ? inv.subtotal : inv.total;
        const qrData = JSON.stringify({no:inv.no||inv.id, total:inv.total, date:inv.date, customer:inv.customer, seller:inv.user, count:inv.items.length});
        const dtFull = fmtDateTime(inv.date);
        const receiptCore = (copyLabel)=>
                '<div class="receipt-copy" style="padding:10px 0">' +
                    '<div style="text-align:center;margin-bottom:10px"><div style="font-size:1.6rem;margin-bottom:2px">🧾</div><h2 style="font-size:1.3rem;margin:0">' + esc(settings.store) + '</h2>' +
                    (settings.address ? '<div style="color:var(--text-muted);font-size:0.75rem;margin-top:2px">' + esc(settings.address) + '</div>' : '') +
                    (settings.phone ? '<div style="color:var(--text-muted);font-size:0.75rem;margin-top:1px">📞 ' + esc(settings.phone) + '</div>' : '') +
                    '<div style="color:var(--text-muted);font-size:.78rem;margin-top:6px"><b>'+copyLabel+'</b> • فاتورة ' + invNo + '</div>' +
                    '<div style="color:var(--text-muted);font-size:.75rem;margin-top:2px" title="'+esc(inv.date)+'">📅 ' + esc(dtFull) + ' • 👤 ' + esc(inv.customer) + '</div>' +
                    '<div style="color:var(--text-muted);font-size:.72rem;margin-top:1px">البائع: ' + esc(inv.user || '—') + ' • ' + esc(inv.status||'قيد المعالجة') + '</div></div>' +
                    '<table><tr><th>الصنف</th><th style="text-align:center">الكمية</th><th>السعر</th><th style="text-align:left">الإجمالي</th></tr>' + rows + '</table>' +
                    '<div class="receipt-totals"><div class="rt-row"><span>الإجمالي الفرعي (' + inv.items.length + ' صنف)</span><span>' + fmt(subTotal) + '</span></div>' + (inv.discount > 0 ? '<div class="rt-row"><span>الخصم</span><span>−' + fmt(inv.discount) + '</span></div>' : '') + (inv.tax > 0 ? '<div class="rt-row"><span>الضريبة</span><span>' + fmt(inv.tax) + '</span></div>' : '') + '<div class="rt-row rt-grand"><span>الإجمالي</span><span>' + fmt(inv.total) + ' ج.م</span></div></div>' +
                    '<div style="text-align:center;margin-top:12px"><div id="qrcode-'+esc(String(inv.no||'0'))+'" style="display:inline-block;min-width:126px;min-height:126px;padding:8px;background:#fff;border:1px solid var(--border);border-radius:12px"></div><div style="font-size:.68rem;color:var(--text-muted);margin-top:4px">امسح للتحقق • '+invNo+' • '+esc(dtFull)+'</div></div>' +
                    (settings.footer ? '<div style="text-align:center;color:var(--text-muted);font-size:.75rem;margin-top:8px;font-weight:700">' + esc(settings.footer) + '</div>' : '') +
                '</div>';
        body.innerHTML =
            '<div class="receipt" style="padding:10px 0">' +
                receiptCore('نسخة العميل') +
                '<div style="border-top:2px dashed var(--border);margin:18px 0;position:relative"><span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--bg-card);padding:0 10px;font-size:.7rem;color:var(--text-muted)">✂️ قص</span></div>' +
                receiptCore('نسخة المحل — '+esc(settings.store)) +
                '<div class="modal-actions no-print" style="margin-top:22px">' + backBtn + '<div style="display:flex;gap:8px"><button class="btn btn-outline" onclick="printReceipt()">🖨️ طباعة نسختين</button><button class="btn btn-outline" onclick="if(navigator.share) navigator.share({title:\'فاتورة '+invNo+'\', text:qrData}).catch(()=>{})">📤 مشاركة</button>' + saveBtn + '</div></div>' +
            '</div>';
        document.getElementById('modal').style.display = 'flex';
        setTimeout(()=>{
          // 🐞 T-B1 (2026-09-22): كان المحدِّد هنا مكتوبًا بعلامات اقتباس مهروبة
          // querySelectorAll('[id^=\"qrcode-\"]') ⇒ يطابق صفر عنصر (أثبتناه في متصفح معزول)،
          // فكانت نسخة المحل تُطبع بمربع أبيض فارغ بلا رمز. الآن: نستهدف كل نسخ الإيصال،
          // ونرسم لكل نسخة، ونتحقق أن الرمز ظهر فعلًا — وإن فشل نُظهر تنبيهًا صريحًا
          // (بلا أي إرسال لبيانات العميل لخدمة خارجية — التوليد محلي فقط).
          try{
            const boxes = Array.from(document.querySelectorAll('.receipt-copy [id^="qrcode-"]'));
            if (!boxes.length) {
              const only = document.getElementById('qrcode-' + String(inv.no||'0'));
              if (only) boxes.push(only);
            }
            const failNote = '<div style="width:110px;height:110px;display:grid;place-items:center;border:1px dashed var(--border);border-radius:8px;font-size:.62rem;color:var(--text-muted);text-align:center;padding:6px">تعذّر توليد QR<br>أعد فتح الإيصال</div>';
            // المكتبة ترسم في وضعين: canvas مباشرة، أو صورة data:URL (تختفي الـ canvas).
            // لذلك نعتبر الرسم ناجحًا بوجود أحدهما — ونمنح الرسم وقتًا كافيًا (المكتبة غير متزامنة).
            const rendered = (e) => {
              const im = e.querySelector('img');
              if (im && im.src && im.src.indexOf('data:') === 0 && im.src.length > 200) return true;
              const cv = e.querySelector('canvas');
              if (!cv) return false;
              try {
                const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
                for (let i=0;i<d.length;i+=4) { if (d[i+3] > 10 && d[i] < 128) return true; }
              } catch (err) {}
              return false;
            };
            // 🐞 السبب الجذري (مُثبت بقياس): مكتبة qrcodejs تحسب طول النص بالحروف لا بالبايتات،
            // وبيانات الفاتورة تحتوي اسم العميل (عربي = بايتان للحرف) ⇒ كانت ترمي
            // «code length overflow. (1268>1120)» داخل try{} بلا أي رسالة ⇒ مربع أبيض.
            // الحل: سلّم محاولات (H ثم M ثم نص مختصر ASCII + L) — ويظهر تنبيه صريح لو فشل الكل.
            const safeData = (() => {
              try {
                const o = JSON.parse(qrData);
                return '2M|' + (o.no || '') + '|' + (o.total || '') + '|' + String(o.date || '').replace(/[^0-9T:\-]/g, '') + '|' + (o.count || '');
              } catch (e) { return String(qrData).replace(/[^\x20-\x7E]/g, ''); }
            })();
            const CL = (window.QRCode && QRCode.CorrectLevel) || { L: 1, M: 0, Q: 3, H: 2 };
            const attempts = [
              { text: qrData,     level: CL.H },
              { text: qrData,     level: CL.M },
              { text: safeData,   level: CL.M },
              { text: safeData,   level: CL.L }
            ];
            const tryDraw = (e, i) => {
              if (!e) return;
              if (!window.QRCode) { e.innerHTML = failNote; return; }
              if (i >= attempts.length) { e.dataset.qrErr = 'all-attempts-failed'; e.innerHTML = failNote; return; }
              try {
                e.innerHTML = '';
                new QRCode(e, {text: attempts[i].text, width: 110, height: 110, correctLevel: attempts[i].level});
              } catch (err) {
                e.dataset.qrErr = 'a' + i + ':' + ((err && err.message) ? err.message : err);
                tryDraw(e, i + 1);
                return;
              }
              let tries = 8;
              const check = () => {
                if (rendered(e)) { delete e.dataset.qrErr; return; }
                if (tries-- > 0) { setTimeout(check, 250); return; }
                tryDraw(e, i + 1);
              };
              setTimeout(check, 250);
            };
            boxes.forEach(e => tryDraw(e, 0));
          }catch(e){}
        }, 120);
    }
    async function confirmSaveInvoice() {
        if (!pendingInvoice) return;
        const inv = pendingInvoice;
        // 🔢 T3.1: نطلب الرقم الرسمي قبل الحفظ — فيُطبع على ورق العميل
        // رقم صحيح لا يتكرّر مع أي جهاز آخر.
        if (inv.noTemp) {
            const saveBtn = document.querySelector('#modalBody .btn-primary');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ جاري تثبيت الرقم…'; }
            const official = await fetchOfficialInvoiceNo();
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 حفظ'; }
            if (official) {
                inv.no = official; inv.noTemp = false;
                if (official > invCounter) { invCounter = official; localStorage.setItem('al_sayed_invno', String(invCounter)); }
            } else {
                inv.noTemp = true;
                toast('⚠️ رقم مؤقت (تعذّر الاتصال) — سيُثبَّت الرقم الرسمي عند المزامنة', 4500);
            }
        }
        // 📦 T3.3: خصم المخزون الفعلي (كان يُخصم «المعروض» فقط ويبقى
        // «إجمالي المخزن» ثابتًا للأبد → جرد وهمي).
        inv.stockApplied = (settings.stockMode || 'both') === 'off' ? false : (settings.stockMode || 'both');
        const changed = applyStockForInvoice(inv, +1);
        if (changed) logAction('خصم مخزون البيع', '#' + String(inv.no).padStart(4, '0') + ' — ' + changed + ' صنف');
        invoices.push(inv);
        queue({ t: 'inv-ins', lid: inv.lid });
        saveInvoices();
        invoiceCart = [];
        pendingInvoice = null;
        save();
        closeModal();
        closeCart();
        logAction('حفظ فاتورة', '#' + String(inv.no).padStart(4, '0') + ' — ' + fmt(inv.total) + ' ج.م');
        toast('✅ تم حفظ الفاتورة #' + String(inv.no).padStart(4, '0') + '! الإجمالي: ' + fmt(inv.total) + ' ج.م', 3500);
    }
    function printReceipt() { window.print(); }

    function showInvoiceHistory() {
        if (!can('history')) return toast('⛔ سجل الفواتير للعامل والمدير فقط');
        const modal = document.getElementById('modal');
        const body = document.getElementById('modalBody');
        if (invoices.length === 0) {
            body.innerHTML =
                '<h2>📋 سجل <span class="accent">الفواتير</span></h2>' +
                '<div class="empty-state"><div class="icon">📭</div>لا توجد فواتير بعد</div>' +
                '<div class="modal-actions">' +
                    '<button class="btn btn-outline" onclick="closeModal();setView(\'shop\');openCart()">🧧 فاتورة جديدة</button>' +
                    '<button class="btn btn-outline" onclick="closeModal()">إغلاق</button>' +
                '</div>';
        } else {
            let html = '<h2>📋 سجل <span class="accent">الفواتير</span> (' + invoices.length + ')</h2><div class="inv-history">';
            let sorted = [...invoices].reverse();
            sorted.forEach((inv, i) => {
                let dateStr = fmtDateTime(inv.date);
                const invNo = inv.no ? '#' + String(inv.no).padStart(4, '0') : '#' + String(invoices.length - i).padStart(4, '0');
                const st=inv.status||'قيد المعالجة';
                html +=
                    '<div class="inv-hist-item" onclick="toggleInvoiceDetail(this)">' +
                        '<div class="inv-hi-top">' +
                            '<span><strong>' + invNo + '</strong> · <span title="'+esc(inv.date)+'">'+esc(dateStr)+'</span> · ' + esc(inv.customer) + (inv.user ? ' · 👷 ' + esc(inv.user) : '') + ' <span class="status '+statusClass(st)+'" style="font-size:.68rem;padding:2px 8px">'+esc(st)+'</span></span>' +
                            '<span style="font-weight:800;color:var(--primary)">' + fmt(inv.total) + ' ج.م</span>' +
                        '</div>' +
                        '<div class="inv-hi-items" style="display:none">' +
                            inv.items.map(item => '<div><span>' + esc(item.name) + ' × ' + item.qty + '</span><span>' + fmt(item.qty * item.price) + ' ج.م</span></div>').join('') +
                            '<div class="inv-actions">' +
                                '<button class="btn btn-outline" style="padding:6px 12px;font-size:0.75rem" onclick="event.stopPropagation();previewInvoice(' + (invoices.length - 1 - i) + ')">🖨️ طباعة</button>' +
                                '<button class="btn btn-danger" style="padding:6px 12px;font-size:0.75rem" onclick="event.stopPropagation();deleteInvoice(' + (invoices.length - 1 - i) + ')">🗑️ حذف</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            });
            html += '</div>';
            body.innerHTML = html +
                '<div class="modal-actions">' +
                    '<button class="btn btn-outline" onclick="closeModal();setView(\'shop\');openCart()">🧧 فاتورة جديدة</button>' +
                    '<button class="btn btn-outline" onclick="closeModal()">إغلاق</button>' +
                '</div>';
        }
        modal.style.display = 'flex';
    }
    function previewInvoice(idx) {
        const inv = invoices[idx];
        if (!inv) return;
        showReceiptPreview(inv, false);
    }
    function toggleInvoiceDetail(el) {
        let items = el.querySelector('.inv-hi-items');
        items.style.display = items.style.display === 'none' ? 'block' : 'none';
    }
    function deleteInvoice(idx) {
        if (!can('dash')) return;
        const removed = invoices.splice(idx, 1)[0];
        if (!removed) return;
        // 📦 T3.3: حذف فاتورة = إلغاء البيعة → ترجع الكميات للمخزون
        const restored = isStockHeld(removed.status) ? applyStockForInvoice(removed, -1) : 0;
        queue({ t: 'inv-del', lid: removed.lid, cid: removed.cid });
        saveInvoices();
        logAction('حذف فاتورة', (removed.no ? '#' + String(removed.no).padStart(4, '0') : idx) + (restored ? ' — استُرجعت ' + restored + ' كمية' : ''));
        showInvoiceHistory();
        updateStats();
        toastUndo('تم حذف الفاتورة' + (restored ? ' واسترجاع الكميات للمخزون' : ''), () => {
            invoices.splice(Math.min(idx, invoices.length), 0, removed);
            // إعادة البيعة عند التراجع عن الحذف
            applyStockForInvoice(removed, +1);
            saveInvoices();
            updateStats();
            showInvoiceHistory();
        });
    }

    function updateOrderStatus(idx, newStatus){
        const inv=invoices[idx]; if(!inv) return;
        if(!canManageOrders()) return toast('⚠️ فقط المدير/العامل يمكنه تغيير الحالة');
        if(!ORDER_STATUSES.includes(newStatus)) return;
        if(inv.status===newStatus) return;
        const prevStatus = inv.status;
        inv.status=newStatus;
        inv.updated_at=new Date().toISOString();
        // 📦 T3.3: إلغاء/رفض = استرجاع الكميات · إعادة تنشيط = خصمها مرة أخرى
        syncStockForStatus(inv, prevStatus, newStatus);
        saveInvoices();
        queue({ t:'inv-status', lid: inv.lid, cid: inv.cid, status: newStatus });
        logAction('تحديث حالة طلب', '#'+String(inv.no).padStart(4,'0')+' → '+newStatus);
        toast('✅ تم تحديث الطلب إلى: '+newStatus);
        renderAccount();
        try{ if(document.getElementById('dashOverlay').classList.contains('open')) renderDashboard(); }catch(e){}
        if(cloudReady()) pullAll().catch(()=>{});
    }
    function cancelOrder(idx){
        const inv=invoices[idx]; if(!inv) return;
        const isOwner = inv.user===sessionUser || inv.customer===sessionUser || (cloudProfile && inv.user===cloudProfile.username);
        const isManage = canManageOrders();
        if(!isOwner && !isManage) return toast('⚠️ لا يمكنك إلغاء هذا الطلب');
        if(inv.status==='تم التوصيل' || inv.status==='تم رفض الطلب' || inv.status==='ملغي'){
            return toast('⚠️ لا يمكن إلغاء طلب '+inv.status);
        }
        if(!confirm('هل أنت متأكد من إلغاء الطلب #'+String(inv.no).padStart(4,'0')+'؟')) return;
        const prevStatus = inv.status;
        inv.status='ملغي';
        inv.updated_at=new Date().toISOString();
        // 📦 T3.3: الإلغاء يُرجّع الكميات — قبل الإصلاح كانت تضيع للأبد
        syncStockForStatus(inv, prevStatus, 'ملغي');
        saveInvoices();
        queue({ t:'inv-status', lid: inv.lid, cid: inv.cid, status: 'ملغي' });
        logAction('إلغاء طلب', '#'+String(inv.no).padStart(4,'0'));
        toast('✅ تم إلغاء الطلب');
        renderAccount();
        try{ if(document.getElementById('dashOverlay').classList.contains('open')) renderDashboard(); }catch(e){}
    }

    // ===== DASHBOARD =====
    function toggleDashboard() {
        if (!can('dash')) return toast('⛔ لوحة التحكم للمدير فقط');
        let overlay = document.getElementById('dashOverlay');
        let open = overlay.classList.toggle('open');
        if (open) renderDashboard();
        closeBurger();
    }
    function renderDashboard() {
        let body = document.getElementById('dashBody');
        let totalItems = 0, totalStock = 0, lowCount = 0, outCount = 0, totalValue = 0;
        let catData = [];
        db.forEach(c => {
            let catVal = 0, catQty = 0;
            c.items.forEach(item => {
                totalItems++;
                let q = getQ(item), qs = getQs(item);
                let p = itemPrice(item);
                totalStock += q + qs;
                catQty += q + qs;
                catVal += (q + qs) * p;
                totalValue += (q + qs) * p;
                if (q === 0) outCount++;
                else if (q <= 5) lowCount++;
            });
            catData.push({ name: c.name, qty: catQty, val: catVal });
        });
        let today = new Date().toDateString();
        let todaySales = invoices.filter(inv => new Date(inv.date).toDateString() === today).reduce((s, inv) => s + inv.total, 0);
        let todayInvCount = invoices.filter(inv => new Date(inv.date).toDateString() === today).length;
        let totalRevenue = invoices.reduce((s, inv) => s + inv.total, 0);
        let productSales = {};
        invoices.forEach(inv => inv.items.forEach(item => {
            productSales[item.name] = (productSales[item.name] || 0) + item.qty;
        }));
        let topProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
        let sellerStats = {};
        invoices.forEach(inv => {
            const k = inv.user || 'غير معروف';
            if (!sellerStats[k]) sellerStats[k] = { total: 0, count: 0 };
            sellerStats[k].total += inv.total;
            sellerStats[k].count++;
        });
        let topSellers = Object.entries(sellerStats).sort((a, b) => b[1].total - a[1].total).slice(0, 5);

        body.innerHTML =
            '<div class="dash-stat-row">' +
                '<div class="dash-stat"><div class="num">' + totalItems + '</div><div class="lbl">📦 إجمالي المنتجات</div></div>' +
                '<div class="dash-stat"><div class="num">' + fmt(totalStock) + '</div><div class="lbl">🧮 إجمالي القطع</div></div>' +
                '<div class="dash-stat"><div class="num">' + fmt(totalValue) + '</div><div class="lbl">💰 قيمة المخزون (ج.م)</div></div>' +
            '</div>' +
            '<div class="dash-stat-row" style="margin-top:12px">' +
                '<div class="dash-stat"><div class="num">' + fmt(todaySales) + '</div><div class="lbl">💵 دخل اليوم (ج.م)</div></div>' +
                '<div class="dash-stat"><div class="num">' + todayInvCount + '</div><div class="lbl">🧾 فواتير اليوم</div></div>' +
                '<div class="dash-stat"><div class="num">' + invoices.length + '</div><div class="lbl"> إجمالي الفواتير</div></div>' +
                '<div class="dash-stat"><div class="num">' + fmt(totalRevenue) + '</div><div class="lbl">🏦 إجمالي الدخل (ج.م)</div></div>' +
            '</div>' +
            '<div class="table-wrap"><table><thead><tr><th>المنتج</th><th>القسم</th><th>السعر</th><th>المخزون</th><th>إجراءات</th></tr></thead><tbody>'
            + db.flatMap((cat,ci)=>cat.items.slice(0,12).map((it,ii)=>'<tr><td>'+esc(it.n)+'</td><td>'+esc(cat.name)+'</td><td>'+fmt(itemPrice(it))+' ج.م</td><td>'+getQ(it)+(getQ(it)<=getMin(it)?' ⚠️':'')+'</td><td><div class="mini-actions"><button class="mini-btn" onclick="toggleDashboard();setTimeout(()=>openModal(\'edit\','+ci+','+ii+'),200)">✏️</button></div></td></tr>')).join('') + '</tbody></table></div>' +
            '<div class="dash-card"><h3>📑 التقارير والتصدير</h3>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button class="btn btn-primary" style="padding:10px 16px;font-size:0.85rem" onclick="dailyReport()">🖨️ تقرير نهاية اليوم</button>' +
                    '<button class="btn btn-outline" style="padding:10px 16px;font-size:0.85rem" onclick="downloadCsv(makeCsvInvoices(),\'invoices.csv\')">📊 فواتير CSV</button>' +
                    '<button class="btn btn-outline" style="padding:10px 16px;font-size:0.85rem" onclick="downloadCsv(makeCsvStock(),\'stock.csv\')">📦 مخزون CSV</button>' +
                '</div></div>' +
            '<div class="dash-card"><h3>📊 توزيع المخزون حسب الأقسام</h3><canvas id="chartStock"></canvas></div>' +
            '<div class="dash-card"><h3>📈 مبيعات آخر 7 أيام</h3><canvas id="chartSales"></canvas></div>' +
            '<div class="dash-card"><h3>📊 حالة الطلبات</h3><canvas id="chartStatus"></canvas></div>' +
            (topSellers.length > 0 ?
            '<div class="dash-card"><h3>👷 مبيعات البائعين</h3><div class="dash-top-list">' +
                topSellers.map(([name, s], i) =>
                    '<div class="dash-top-item"><div class="rank">' + (i + 1) + '</div><span class="name">' + esc(name) + '</span><span class="val">' + fmt(s.total) + ' ج.م · ' + s.count + ' فاتورة</span></div>'
                ).join('') +
            '</div></div>' : '') +
            (topProducts.length > 0 ?
            '<div class="dash-card"><h3>🏆 أفضل المنتجات مبيعاً</h3><div class="dash-top-list">' +
                topProducts.map(([name, qty], i) =>
                    '<div class="dash-top-item"><div class="rank">' + (i + 1) + '</div><span class="name">' + esc(name) + '</span><span class="val">' + qty + ' قطعة</span></div>'
                ).join('') +
            '</div></div>' : '') +
            (outCount > 0 ?
            '<div class="dash-card"><h3>⚠️ منتجات نافدة (تحتاج إعادة طلب)</h3>' +
                db.flatMap(c => c.items.filter(item => getQ(item) === 0)).slice(0, 10).map(item =>
                    '<div class="dash-alert-item"><span class="icon">❌</span> ' + esc(item.n) + '</div>'
                ).join('') +
            '</div>' : '') +
            '<div class="dash-card"><h3>🕘 آخر النشاط (سجل العمليات)</h3><div class="dash-top-list">' +
                audit.slice(-12).reverse().map(a =>
                    '<div class="dash-top-item"><span class="name">' + esc(a.action) + (a.details ? ' <span style="color:var(--text-muted);font-size:0.75rem">— ' + esc(a.details) + '</span>' : '') + '</span><span class="val" style="font-size:0.7rem">' + esc(a.user) + ' · ' + new Date(a.ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) + '</span></div>'
                ).join('') +
            '</div></div>';
        drawStockChart(catData);
        drawSalesChart();
        drawStatusChart();
    }
    function drawStockChart(catData) {
        let canvas = document.getElementById('chartStock');
        if (!canvas) return;
        let ctx = canvas.getContext('2d');
        let w = canvas.width = canvas.parentElement.clientWidth - 40;
        let h = canvas.height = 180;
        let muted = cssVar('--text-muted', '#889096');
        let main = cssVar('--text-main', '#1a1d23');
        let colors = ['#0ca678','#20c997','#fbbf24','#f87171','#5c7cfa','#e599f7','#f06595','#9775fa'];
        let barW = Math.min(40, (w - 40) / Math.max(catData.length, 1) - 8);
        let maxVal = Math.max(...catData.map(d => d.qty), 1);
        ctx.clearRect(0, 0, w, h);
        catData.forEach((d, i) => {
            let x = 20 + i * (barW + 8);
            let bh = (d.qty / maxVal) * (h - 40);
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, h - 20 - bh, barW, bh, 4);
            else ctx.rect(x, h - 20 - bh, barW, bh);
            ctx.fill();
            ctx.fillStyle = muted;
            ctx.font = '10px Tajawal';
            ctx.textAlign = 'center';
            ctx.fillText(d.name.length > 6 ? d.name.slice(0, 6) + '..' : d.name, x + barW / 2, h - 4);
            ctx.fillStyle = main;
            ctx.font = 'bold 11px Tajawal';
            ctx.fillText(d.qty, x + barW / 2, h - 24 - bh);
        });
    }
    function drawSalesChart() {
        let canvas = document.getElementById('chartSales');
        if (!canvas) return;
        let ctx = canvas.getContext('2d');
        let w = canvas.width = canvas.parentElement.clientWidth - 40;
        let h = canvas.height = 180;
        let muted = cssVar('--text-muted', '#889096');
        let main = cssVar('--text-main', '#1a1d23');
        let primary = cssVar('--primary', '#0ca678');
        let days = [];
        for (let i = 6; i >= 0; i--) {
            let d = new Date(); d.setDate(d.getDate() - i);
            let key = d.toDateString();
            let total = invoices.filter(inv => new Date(inv.date).toDateString() === key).reduce((s, inv) => s + inv.total, 0);
            days.push({ label: d.toLocaleDateString('ar-EG', { weekday: 'short' }), val: total });
        }
        let maxVal = Math.max(...days.map(d => d.val), 1);
        ctx.clearRect(0, 0, w, h);
        let padL = 10, padR = 10, padT = 20, padB = 20;
        let chartW = w - padL - padR;
        let chartH = h - padT - padB;
        if (days.length < 2) return;
        ctx.strokeStyle = primary;
        ctx.lineWidth = 3;
        ctx.beginPath();
        days.forEach((d, i) => {
            let x = padL + (i / (days.length - 1)) * chartW;
            let y = padT + chartH - (d.val / maxVal) * chartH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        let grad = ctx.createLinearGradient(0, padT, 0, h - padB);
        grad.addColorStop(0, 'rgba(12,166,120,0.3)');
        grad.addColorStop(1, 'rgba(12,166,120,0)');
        ctx.lineTo(padL + chartW, h - padB);
        ctx.lineTo(padL, h - padB);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.fillStyle = muted;
        ctx.font = '10px Tajawal';
        ctx.textAlign = 'center';
        days.forEach((d, i) => {
            let x = padL + (i / (days.length - 1)) * chartW;
            ctx.fillText(d.label, x, h - 2);
            if (d.val > 0) {
                ctx.fillStyle = main;
                ctx.font = 'bold 10px Tajawal';
                ctx.fillText(d.val, x, padT + chartH - (d.val / maxVal) * chartH - 6);
                ctx.fillStyle = muted;
                ctx.font = '10px Tajawal';
            }
        });
    }
    function drawStatusChart(){
        const c=document.getElementById('chartStatus'); if(!c) return;
        if(window.Chart){
            try{
                const counts={}; ORDER_STATUSES.forEach(s=>counts[s]=0); invoices.forEach(inv=>{ const s=inv.status||'قيد المعالجة'; counts[s]=(counts[s]||0)+1; });
                const labels=Object.keys(counts).filter(k=>counts[k]>0); const data=labels.map(k=>counts[k]);
                if(!labels.length){ const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.fillStyle='#9fb3bd'; ctx.textAlign='center'; ctx.font='14px Tajawal'; ctx.fillText('لا توجد طلبات بعد', c.width/2, 90); return; }
                const colors={'قيد المعالجة':'#f5b62c','في الطريق':'#1a7fa0','تم التوصيل':'#00c9a7','تم رفض الطلب':'#e5484d','ملغي':'#9fb3bd'};
                if(c._chart) try{c._chart.destroy();}catch{}
                c._chart=new Chart(c, {type:'doughnut', data:{labels, datasets:[{data, backgroundColor:labels.map(l=>colors[l]||'#63757f'), borderWidth:2, borderColor:'#fff'}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{font:{family:'Tajawal'}, padding:12, usePointStyle:true}}}}});
                c.style.height='200px';
                return;
            }catch(e){}
        }
        // fallback: نص بسيط
        const ctx=c.getContext('2d'); const w=c.width=c.parentElement.clientWidth-40, h=c.height=120; ctx.clearRect(0,0,w,h);
        const counts={}; ORDER_STATUSES.forEach(s=>counts[s]=0); invoices.forEach(inv=>{ counts[inv.status||'قيد المعالجة']++; });
        ctx.fillStyle='#63757f'; ctx.textAlign='center'; ctx.font='12px Tajawal';
        let x=20; Object.entries(counts).filter(([,v])=>v>0).forEach(([k,v])=>{ ctx.fillText(k+':'+v, x, 60); x+=90; });
    }

    // ===== هجرة البيانات من الإصدار القديم =====
    (function migrate() {
        let oldData = localStorage.getItem('al_sayed_premium_db');
        if (oldData && !localStorage.getItem('al_sayed_db')) {
            try {
                let parsed = JSON.parse(oldData);
                parsed.forEach(c => c.items.forEach(item => { if (item.qs === undefined) item.qs = 0; }));
                db = parsed;
                localStorage.setItem('al_sayed_db', JSON.stringify(db));
            } catch(e) {}
        }
    })();

    // ===== ROLES & ACCOUNTS =====
    const ROLE_PERMS = {
        admin:    { stock: true,  add: true,  edit: true,  del: true,  cats: true,  dash: true,  exp: true,  invoice: true,  history: true,  users: true },
        worker:   { stock: false, add: true,  edit: false, del: false, cats: true,  dash: false, exp: false, invoice: true,  history: true,  users: false },
        customer: { stock: false, add: false, edit: false, del: false, cats: false, dash: false, exp: false, invoice: true,  history: false, users: false }
    };

    // 🚫 T-A3/F4 (2026-09-22): حُذفت تجزئة djb2 (hashPass) وطبقة PBKDF2 المحلية
    // (b64/pbkdf2/verifyPass/upgradeHash) بالكامل — كانت تخدم الحسابات المحلية فقط،
    // وقد أُلغيت الحسابات المحلية (كل الحسابات سحابية عبر Supabase Auth).
    // ⇒ لم تبقَ في الصفحة أي تجزئة ضعيفة، ولا مسار محلي للتحقق من كلمة المرور.

    // ===== LOGIN LOCK =====
    // 🔒 F2 (2026-09-21): القفل صار **على السيرفر** (login_gate · login_fail ·
    // login_ok في ترحيل 20260921070000). القديم كان في localStorage وحده:
    // من يمسح بيانات المتصفح أو يفتح نافذة خاصة يعود كأن شيئًا لم يكن.
    // ما هنا الآن طبقة احتياطية بلا إنترنت وبمدة متصاعدة (1 · 5 · 15 · 60 دقيقة).
    const DEVICE_ID = (() => {
        try {
            let d = localStorage.getItem('al_sayed_device');
            if (!d) { d = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36).slice(-4); localStorage.setItem('al_sayed_device', d); }
            return d;
        } catch (e) { return 'dev-unknown'; }
    })();
    function lockInfo() { return JSON.parse(localStorage.getItem('al_sayed_lock') || 'null'); }
    function lockedMinutes() {
        const l = lockInfo();
        return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 60000) : 0;
    }
    function failLogin() {
        const l = lockInfo() || { count: 0, strikes: 0 };
        l.count++;
        if (l.count >= 5) {
            l.strikes = (l.strikes || 0) + 1;
            const mins = [1, 5, 15, 60][Math.min(l.strikes - 1, 3)];
            l.until = Date.now() + mins * 60 * 1000;
            l.count = 0;
        }
        try { localStorage.setItem('al_sayed_lock', JSON.stringify(l)); } catch (e) {}
    }
    function clearLock() { try { localStorage.removeItem('al_sayed_lock'); } catch (e) {} }

    /** القفل السيرفري — تُرجِع null لو لا اتصال أو لم يُنفَّذ الترحيل بعد */
    async function serverGate(username, fn) {
        if (!username || !cloudReady() || !isOnline() || !sb) return null;
        try {
            const { data, error } = await sb.rpc(fn || 'login_gate', { p_username: username, p_device: DEVICE_ID });
            if (error) return null;
            const row = Array.isArray(data) ? data[0] : data;
            if (!row) return null;
            return { allowed: !!row.allowed, seconds: row.locked_seconds | 0, left: row.attempts_left | 0, scope: row.scope || 'none', online: true };
        } catch (e) { return null; }
    }
    const serverFail = (u) => serverGate(u, 'login_fail');
    async function serverOk(username) {
        if (!username || !cloudReady() || !isOnline() || !sb) return;
        try { await sb.rpc('login_ok', { p_username: username, p_device: DEVICE_ID }); } catch (e) {}
    }
    /** رسالة القفل الموحّدة */
    function lockMessage(seconds, scope) {
        const mins = Math.max(1, Math.ceil((seconds || 0) / 60));
        const why = scope === 'device' ? 'هذا الجهاز' : scope === 'ip' ? 'هذه الشبكة' : 'هذا الحساب';
        return '🔒 قُفل الدخول على ' + why + ' بسبب محاولات فاشلة متكررة — حاول بعد ' + mins + ' دقيقة';
    }
    /** فحص قبل المحاولة: سيرفري إن أمكن، وإلا محلي (مع بيان الفرق بصراحة) */
    async function gateBeforeLogin(username) {
        const g = await serverGate(username);
        if (g && !g.allowed) return { block: true, message: lockMessage(g.seconds, g.scope), left: 0, online: true };
        if (g) return { block: false, left: g.left, online: true };
        const m = lockedMinutes();
        if (m > 0) return { block: true, message: '🔒 قفل محلي (بلا اتصال) — حاول بعد ' + m + ' دقيقة', left: 0, online: false };
        return { block: false, left: null, online: false };
    }
    // 🚫 T-A3 (2026-09-22): لا مصفوفة مستخدمين محلية إطلاقًا — الحسابات سحابية فقط.
    // كان هنا: users[] + saveUsers() + currentUser() + seed محلية بكلمات مرور معروفة
    // + دوال الإضافة/الحذف/تصفير كلمة المرور المحلية — أُلغيت كلها (F4).
    let sessionUser = localStorage.getItem('al_sayed_session_user') || '';
    let sessionRole = '';
    let lastActivity = Date.now();

    // ── صلاحيات قابلة للتعديل من المدير (تخزين محلي + مزامنة سحابية) ──
    let customPerms = JSON.parse(localStorage.getItem('al_sayed_role_perms') || 'null');
    if (!customPerms || typeof customPerms !== 'object') customPerms = {};
    function perms() {
      const base = ROLE_PERMS[sessionRole] || ROLE_PERMS.customer;
      const custom = customPerms[sessionRole] || {};
      return Object.assign({}, base, custom);
    }
    function can(p) { return !!perms()[p]; }

    function setUser(u) {
        sessionUser = u.u;
        sessionRole = u.role;
        localStorage.setItem('al_sayed_session_user', u.u);
        lastActivity = Date.now();
    }

    // ===== LOGIN / REGISTER =====
    function switchLoginTab(tab) {
        document.getElementById('paneLogin').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('paneRegister').style.display = tab === 'register' ? 'block' : 'none';
        document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
        document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
        if (typeof hideLoginNote === 'function') hideLoginNote();
        const first = document.querySelector('#pane' + (tab === 'login' ? 'Login' : 'Register') + ' input');
        if (first) setTimeout(() => { try { first.focus(); } catch (e) {} }, 120);
    }
    // 🏠 T-A1 (2026-09-22): البداية صفحة ترحيب — لا حاجب تسجيل إجباري
    function showLanding() {
        updateAuthBtn();
        if (sessionUser || cloudProfile) return; // مسجَّل: يكمّل من حيث كان
        sessionRole = '';
        currentView = 'home';
        try { applyRoleUI(); } catch (e) {}   // يضبط القائمة والصلاحيات لواجهة الزائر
        try { setView('home'); } catch (e) {}
    }
    function updateAuthBtn() {
        const b = document.getElementById('authHeaderBtn');
        if (!b) return;
        b.style.display = (sessionUser || cloudProfile) ? 'none' : 'inline-flex';
    }
    function showRegister() { showLogin(); switchLoginTab('register'); }
    function showLogin() {
        document.getElementById('loginOverlay').style.display = 'flex';
        hideLoginNote();
        const err = document.getElementById('loginError');
        err.style.display = 'none';
        err.textContent = '';
        const lu = document.getElementById('login-user'); if (lu) lu.value = '';
        const lp = document.getElementById('login-pass'); if (lp) lp.value = '';
        switchLoginTab('login');
    }
    function hideLogin() { document.getElementById('loginOverlay').style.display = 'none'; }
    function loginShake() {
        const card = document.getElementById('loginCard');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
    }
    function afterLogin() {
        hideLogin();
        updateAuthBtn();
        applyRoleUI();
    }
    function setItemDisplay(id, val) {
        const el = document.getElementById(id);
        if (el) el.style.display = val;
    }
    let _measureRaf = 0;
    function measureHeader() {
        if (_measureRaf) cancelAnimationFrame(_measureRaf);
        _measureRaf = requestAnimationFrame(() => {
            const h = document.getElementById('appHeader');
            if (h && h.offsetHeight) document.documentElement.style.setProperty('--header-h', h.offsetHeight + 'px');
        });
    }
    // مراقب حجم الهيدر تلقائياً (أداء أفضل من resize فقط)
    if (window.ResizeObserver) {
        const _hdr = document.getElementById('appHeader');
        if (_hdr) new ResizeObserver(measureHeader).observe(_hdr);
    }
    function applyRoleUI() {
        const p = perms();
        const icons = { admin: '🛡️', worker: '👷', customer: '👤' };
        const roleLabels = { admin: 'مدير النظام', worker: 'عامل', customer: 'عميل' };
        const me = (cloudReady() && cloudProfile) ? cloudProfile : {u:sessionUser, name:sessionUser, role:sessionRole};
        const signedIn = !!(sessionUser || cloudProfile);
        const chip = document.getElementById('roleChip');
        if (chip) {
            chip.textContent = (icons[sessionRole] || '') + ' ' + (sessionUser || '');
            chip.style.display = signedIn ? 'inline-flex' : 'none';
        }
        // 🏠 T-A1: الزائر يرى واجهة عميل مبسطة — لا بنود إدارية ولا خروج قبل الدخول
        setItemDisplay('burger-pass', signedIn ? 'flex' : 'none');
        setItemDisplay('burger-logout', signedIn ? 'flex' : 'none');
        setItemDisplay('burger-quicklock', signedIn ? 'flex' : 'none');
        const av = document.getElementById('sideAvatar'); if (av) av.textContent = icons[sessionRole] || '👤';
        const sn = document.getElementById('sideName'); if (sn) sn.textContent = me ? (me.display_name || me.name || me.u || '') : (sessionUser || '—');
        const sr = document.getElementById('sideRole'); if (sr) sr.textContent = roleLabels[sessionRole] || '';
        setItemDisplay('viewTabs', p.stock ? 'grid' : 'none');
        updateAuthBtn();
        // 🔒 T-A5: العميل لا يُدفع لصفحة العرض قسرًا — نُبقيه على الرئيسية/المتجر/حسابه
        if (!p.stock && !['shop', 'home', 'account'].includes(currentView)) setView('home');
        // إحصائيات الهيدر: للمدير فقط (مميزات ادارية)
        setItemDisplay('statRow', sessionRole === 'admin' ? 'flex' : 'none');
        setItemDisplay('fabWrap', p.add ? 'flex' : 'none');
        setItemDisplay('burger-stock', p.stock ? 'flex' : 'none');
        setItemDisplay('burger-dash', p.dash ? 'flex' : 'none');
        setItemDisplay('burger-invoices', p.history ? 'flex' : 'none');
        setItemDisplay('burger-export', p.exp ? 'flex' : 'none');
        setItemDisplay('burger-import', p.exp ? 'flex' : 'none');
        setItemDisplay('burger-settings', p.dash ? 'flex' : 'none');
        setItemDisplay('burger-users', p.users ? 'flex' : 'none');
        const bacc=document.getElementById('burger-account'); if(bacc) bacc.textContent = (sessionRole==='admin'?'📦 الطلبات': sessionRole==='worker'?'📋 طلبات اليوم':'👤 حسابي');
        const navAcc=document.querySelector('.nav-links-desktop a[data-route="account"]'); if(navAcc) navAcc.textContent = (sessionRole==='admin'?'الطلبات': sessionRole==='worker'?'طلبات اليوم':'حسابي');
        setCloudStatus(cloudStatus);
        measureHeader();
        setView(currentView);
    }
    function logout(force) {
        if (!force && !confirm('تسجيل الخروج؟')) return;
        if (sessionUser) logAction('تسجيل خروج', sessionUser);
        cloudLogout();
        sessionUser = '';
        sessionRole = '';
        localStorage.removeItem('al_sayed_session_user');
        pendingInvoice = null;
        // السلة بتفضل زي ما هي عشان العميل يقدر يضيف والعامل يخلص الفاتورة
        updateCartBadge();
        closeBurger();
        showLanding();   // 🏠 بعد الخروج نرجع لصفحة الترحيب لا لشاشة تسجيل إجبارية
    }

    // ===== AUTO LOCK (قفل تلقائي بعد 30 دقيقة بدون نشاط) =====
    ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, true));
    setInterval(() => {
        if (sessionUser && Date.now() - lastActivity > 30 * 60 * 1000) logout(true);
    }, 60 * 1000);

    // ===== USER MANAGEMENT (إدارة الحسابات - مدير) =====
    async function renderCloudUsers() {
        const body = document.getElementById('modalBody');
        body.innerHTML = '<h2>👥 إدارة <span class="accent">الحسابات</span> (سحابي)</h2><div style="font-size:0.8rem;color:var(--text-muted);font-weight:700;padding:10px">⏳ جاري التحميل...</div>';
        document.getElementById('modal').style.display = 'flex';
        const { data, error } = await sb.from('profiles').select('*').order('created_at');
        if (error) { body.innerHTML = '<h2>👥 الحسابات</h2><p style="color:var(--danger);font-weight:700">' + esc(error.message || '') + '</p>'; return; }
        const roleNames = { admin: '🛡️ مدير', worker: '👷 عامل', customer: '👤 عميل' };
        let rows = (data || []).map(p =>
            '<div class="user-row"><div><div class="user-name">' + esc(p.display_name || p.username) + '</div><div class="user-meta">@' + esc(p.username) + '</div></div>' +
            '<select onchange="changeUserRole(\'' + p.id + '\', this.value)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-main);font-weight:700;font-size:0.8rem">' +
            ['admin', 'worker', 'customer'].map(r => '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + roleNames[r] + '</option>').join('') +
            '</select></div>'
        ).join('');
        body.innerHTML =
            '<h2>👥 إدارة <span class="accent">الحسابات</span> (' + (data || []).length + ')</h2>' +
            '<div class="user-list">' + (rows || '<div style="font-size:0.8rem;color:var(--text-muted);font-weight:700;padding:10px">مفيش حسابات</div>') + '</div>' +
            '<p style="font-size:0.75rem;color:var(--text-muted);font-weight:700;margin-top:10px">☁️ الحسابات على Supabase — المدير حساب ثابت محمي. الحذف يتم من لوحة Supabase.</p>' +
            '<div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">إغلاق</button></div>';
    }
    function openUsersModal() {
        if (!can('users')) return;
        // ☁️ T-A3/F4: لا إدارة حسابات محلية — كل الحسابات على Supabase.
        if (!cloudReady()) return toast('☁️ إدارة الحسابات تحتاج اتصالًا بالإنترنت');
        renderCloudUsers();
    }

    // ===== CHANGE MY PASSWORD (تغيير كلمة المرور) =====
    function openPassModal() {
        const cloud = !!(typeof cloudReady === 'function' && cloudReady() && cloudProfile && sb);
        if (!cloud) return toast('☁️ تغيير كلمة المرور متاح للحسابات السحابية — اتصل بالإنترنت أولًا');
        const body = document.getElementById('modalBody');
        body.innerHTML =
            '<h2>🔒 تغيير <span class="accent">كلمة المرور</span></h2>' +
            (cloud ? '<p style="font-size:.8rem;color:var(--text-muted);font-weight:700;margin-bottom:10px">حسابك سحابي — التغيير يسري على كل أجهزتك.</p>' +
                     '<p style="font-size:.8rem;color:var(--text-muted);font-weight:700;margin-bottom:10px">ملاحظة: رمز PIN الخاص بالكاونتر يُدار من الإعدادات ← الأمان.</p>' : '') +
            '<div class="form-group"><label>كلمة المرور الحالية</label><input type="password" id="pass-cur" placeholder="••••••" autocomplete="current-password"></div>' +
            '<div class="form-group"><label>الجديدة (6 أحرف على الأقل)</label><input type="password" id="pass-new" placeholder="••••••" autocomplete="new-password"></div>' +
            '<div class="form-group"><label>تأكيد الجديدة</label><input type="password" id="pass-conf" placeholder="••••••" autocomplete="new-password" onkeydown="if(event.key===\'Enter\')savePass()"></div>' +
            '<div class="modal-actions">' +
                '<button class="btn btn-outline" onclick="closeModal()">إلغاء</button>' +
                '<button class="btn btn-primary" id="btnSavePass" onclick="savePass()">💾 حفظ</button>' +
            '</div>';
        document.getElementById('modal').style.display = 'flex';
    }
    async function savePass() {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const cur = val('pass-cur'), nw = val('pass-new'), cf = val('pass-conf');
        if (nw.length < 6) return toast('🔑 كلمة المرور الجديدة 6 أحرف على الأقل');
        if (nw !== cf) return toast('❌ تأكيد كلمة المرور غير مطابق');
        // ☁️ T-A6 (2026-09-22): الحسابات السحابية كانت لا تستطيع تغيير كلمة المرور إطلاقًا
        // (الدالة كانت تعتمد على حساب محلي غير موجود) ⇒ الآن تتحدّث على السحابة فعلًا.
        if (typeof cloudReady === 'function' && cloudReady() && cloudProfile && sb) {
            const btn = document.getElementById('btnSavePass');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }
            try {
                const { data: u } = await sb.auth.getUser();
                const email = u && u.user ? u.user.email : '';
                if (!email) { if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ'; } return toast('❌ تعذّر قراءة بيانات حسابك — أعد تسجيل الدخول'); }
                const { error: vErr } = await sb.auth.signInWithPassword({ email, password: cur });
                if (vErr) { if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ'; } return toast('❌ كلمة المرور الحالية غير صحيحة'); }
                const { error } = await sb.auth.updateUser({ password: nw });
                if (error) { if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ'; } return toast('❌ ' + (error.message || 'تعذّر التحديث')); }
                logAction('تغيير كلمة المرور (سحابي)', sessionUser);
                closeModal();
                toast('✅ تم تغيير كلمة المرور على السحابة — استخدمها في دخولك القادم');
            } catch (e) {
                if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ'; }
                toast('❌ ' + ((e && e.message) ? e.message : 'خطأ غير متوقع'));
            }
            return;
        }
        // 🚫 T-A3/F4: لا مسار محلي — الحسابات سحابية فقط (المسار أعلاه يعالجها).
        toast('☁️ تغيير كلمة المرور يحتاج اتصالًا بالسحابة');
    }


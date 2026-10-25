// ═══════════════════════════════════════════════════════════════════════════
//  🖥️ pro-admin.js — لوحة تحكم احترافية كاملة (شريط جانبي + 8 شاشات)
//
//  لماذا ملف جديد بدل تعديل dashOverlay القديمة؟
//   • القديمة نافذة منبثقة تعرض أول 12 صنفًا من كل قسم بلا بحث ولا ترقيم.
//   • الجديدة واجهة كاملة مستقلة: رئيسية · طلبات + تفاصيل طلب · منتجات
//     (بحث/فلترة/صور متعددة/سعر قبل الخصم/وصف) · أقسام (ترتيب وصور) ·
//     بنرات · عملاء وصلاحيات · إعدادات وهوية المتجر.
//
//  ⚠️ مبدأ الأمان: لا تُكتب أي كتابة على السحابة في «وضع المعاينة» (?preview).
//  ⚠️ مبدأ التوافق: تعمل كاملة أوفلاين على البيانات المحلية، وتتزامن عند الاتصال.
// ═══════════════════════════════════════════════════════════════════════════

let proAdminState = {
    view: 'overview',
    orderFilter: 'all',
    orderQ: '',
    openOrder: null,
    prodQ: '',
    prodCat: 'all',
    editing: null,       // { ci, ii } للمنتج · { idx } للقسم · { idx } للبنر
    form: null,          // مسودة التحرير
    loadingOrders: false
};
let proCloudOrders = [];
let proPreview = false;
let proAdminSidebarCollapsed = false;

function proIsManager() {
    return proPreview || (typeof can === 'function' && (can('dash') || can('del')));
}
function proQueueSafe(entry) {
    if (proPreview) return;                 // وضع المعاينة: لا كتابة على السحابة
    if (typeof queue === 'function') queue(entry);
}

// ═══════════════════════════════════════════════════════════════════════════
//  1) هيكل اللوحة (يُنشأ مرة واحدة ويُعاد استخدامه)
// ═══════════════════════════════════════════════════════════════════════════
function proAdminEnsureShell() {
    let el = document.getElementById('proAdmin');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'proAdmin';
    el.className = 'pro-admin-overlay';
    el.innerHTML =
        '<aside class="pro-admin-sidebar desktop-only" id="proAdminSidebar">' +
            '<div class="pro-admin-brand">' +
                '<span class="pro-admin-logo" id="proAdminLogo">2M</span>' +
                '<div id="proAdminBrandTxt" style="min-width:0">' +
                    '<div style="font-weight:900;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="proAdminStoreName">المتجر</div>' +
                    '<div style="font-size:.68rem;opacity:.6;font-weight:700">لوحة التحكم</div>' +
                '</div>' +
            '</div>' +
            '<nav class="pro-admin-nav" id="proAdminNav"></nav>' +
            '<div class="pro-admin-foot" id="proAdminFoot"></div>' +
        '</aside>' +
        '<div class="pro-admin-main">' +
            '<div class="pro-admin-topbar">' +
                '<button class="pro-admin-iconbtn pro-admin-menu-btn" onclick="proAdminOpenDrawer()" aria-label="القائمة">☰</button>' +
                '<button class="pro-admin-iconbtn pro-admin-collapse-btn" onclick="proAdminToggleSidebar()" aria-label="طي القائمة">⟨</button>' +
                '<div style="flex:1;min-width:0"><div id="proAdminTitle" style="font-weight:900;font-size:.98rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
                '<div id="proAdminSub" style="font-size:.7rem;color:var(--text-muted);font-weight:700"></div></div>' +
                '<button class="pro-admin-iconbtn" onclick="proAdminRefresh()" title="تحديث البيانات">🔄</button>' +
                '<button class="pro-admin-iconbtn" onclick="proCloseAdmin()" title="إغلاق">✕</button>' +
            '</div>' +
            '<div class="pro-admin-scroll"><div class="pro-admin-container" id="proAdminContent"></div></div>' +
        '</div>' +
        '<div class="pro-admin-drawer-bg" id="proAdminDrawerBg" onclick="proAdminCloseDrawer()"></div>' +
        '<aside class="pro-admin-drawer" id="proAdminDrawer">' +
            '<div class="pro-admin-brand"><span class="pro-admin-logo">2M</span>' +
            '<div><div style="font-weight:900;font-size:.9rem">لوحة التحكم</div><div style="font-size:.68rem;opacity:.6;font-weight:700">' + esc(settings.store || '') + '</div></div></div>' +
            '<nav class="pro-admin-nav" id="proAdminNavMobile"></nav>' +
        '</aside>';
    document.body.appendChild(el);
    return el;
}

function proAdminNavItems() {
    return [
        { v: 'overview', ic: '🏠', l: 'الرئيسية' },
        { v: 'orders', ic: '🧾', l: 'الطلبات', badge: true },
        { v: 'products', ic: '📦', l: 'المنتجات والمخزون' },
        { v: 'categories', ic: '📂', l: 'الأقسام' },
        { v: 'banners', ic: '🖼️', l: 'البنرات والعروض' },
        { v: 'customers', ic: '👥', l: 'العملاء والصلاحيات' },
        { v: 'settings', ic: '⚙️', l: 'إعدادات المتجر' }
    ];
}
function proAdminNavHtml() {
    const n = proNewOrdersCount();
    const items = proAdminNavItems();
    const link = (it) =>
        '<button class="pro-admin-link' + (proAdminState.view === it.v || (proAdminState.view === 'order' && it.v === 'orders') ? ' active' : '') + '"' +
        ' data-view="' + it.v + '" onclick="proAdminGo(\'' + it.v + '\')">' +
        '<span class="pro-admin-ic">' + it.ic + '</span>' +
        '<span class="pro-admin-txt">' + it.l + '</span>' +
        (it.badge ? '<span class="pro-admin-badge" style="display:' + (n > 0 ? 'grid' : 'none') + '">' + n + '</span>' : '') +
        '</button>';
    const bottom =
        '<button class="pro-admin-link" onclick="proCloseAdmin();setView(\'shop\')"><span class="pro-admin-ic">🏪</span><span class="pro-admin-txt">معاينة المتجر</span></button>' +
        '<button class="pro-admin-link" onclick="proCloseAdmin();toggleDashboard()"><span class="pro-admin-ic">📊</span><span class="pro-admin-txt">التقارير المتقدمة</span></button>' +
        (sessionUser ? '<button class="pro-admin-link" onclick="proCloseAdmin();logout()"><span class="pro-admin-ic">🚪</span><span class="pro-admin-txt">تسجيل الخروج</span></button>' : '');
    return items.map(link).join('');
}

function proOpenAdmin(view) {
    if (!proIsManager()) return toast('⛔ لوحة التحكم للمدير فقط');
    const el = proAdminEnsureShell();
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    proAdminState.view = view || 'overview';
    proAdminRender();
    proLoadCloudOrders();
}
function proCloseAdmin() {
    const el = document.getElementById('proAdmin');
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
    if (currentView === 'home') renderHome(); else renderAll();
    proSyncHeaderAdminBtn();
}
function proAdminGo(view) {
    proAdminState.view = view;
    proAdminState.editing = null;
    proAdminState.form = null;
    proAdminCloseDrawer();
    proAdminRender();
    const sc = document.querySelector('.pro-admin-scroll');
    if (sc) sc.scrollTop = 0;
}
function proAdminToggleSidebar() {
    proAdminSidebarCollapsed = !proAdminSidebarCollapsed;
    const sb = document.getElementById('proAdminSidebar');
    if (sb) sb.classList.toggle('collapsed', proAdminSidebarCollapsed);
    try { localStorage.setItem('al_sayed_admin_collapsed', proAdminSidebarCollapsed ? '1' : '0'); } catch (e) {}
}
function proAdminOpenDrawer() {
    const d = document.getElementById('proAdminDrawer'), bg = document.getElementById('proAdminDrawerBg');
    if (d) d.classList.add('open');
    if (bg) bg.classList.add('open');
}
function proAdminCloseDrawer() {
    const d = document.getElementById('proAdminDrawer'), bg = document.getElementById('proAdminDrawerBg');
    if (d) d.classList.remove('open');
    if (bg) bg.classList.remove('open');
}
function proAdminRefresh() {
    toast('🔄 جاري التحديث...');
    const p = (typeof cloudReady === 'function' && cloudReady() && !proPreview)
        ? pullAll().catch(() => {})
        : Promise.resolve();
    p.then(() => proLoadCloudOrders()).then(() => { proAdminRender(); toast('✅ تم التحديث'); });
}

/** طلب تجريبي للمعاينة فقط — لا يُكتب على السحابة ولا يمس المخزون الحقيقي */
function proCreateDemoOrder() {
    if (!proPreview) return;
    const picks = [];
    (db || []).slice(0, 2).forEach((c, ci) => {
        const ii = (c.items || []).findIndex(it => getQs(it) > 0);
        if (ii >= 0) picks.push({ ci: ci, ii: ii });
    });
    if (!picks.length) return toast('⚠️ لا توجد منتجات متاحة لبناء طلب تجريبي');
    const lines = picks.map(p => {
        const it = db[p.ci].items[p.ii];
        return { name: it.n, cat: db[p.ci].name, qty: 2, price: itemPrice(it), lid: it.lid };
    });
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const shipping = proNum(settings.shipping);
    invCounter = (invCounter || 0) + 1;
    const demo = {
        id: Date.now(), lid: genLid(), cid: null, no: invCounter, date: new Date().toISOString(),
        customer: 'أحمد السيد (طلب تجريبي)', user: 'متجر', phone: '01012345678',
        city: 'الدقهلية', area: 'المشاية السفلية', address: 'شارع الجيش — عمارة 12، الدور الثالث',
        notes: 'اتصل قبل الوصول', payment: 'cod', paymentStatus: 'unpaid', receipt: '',
        fulfillment: 'delivery', source: 'web', token: 'DEMO' + Date.now().toString(36).toUpperCase(),
        items: lines, subtotal: subtotal, discount: 0, tax: 0, shipping: shipping,
        total: subtotal + shipping, status: 'قيد المعالجة', updated_at: new Date().toISOString(),
        stockApplied: false, demo: true
    };
    invoices.push(demo);
    proAdminState.view = 'orders';
    proAdminRender();
    toast('✅ تم إنشاء طلب تجريبي (محلي فقط — لن يُرفع للسحابة)');
}

// ═══════════════════════════════════════════════════════════════════════════
//  2) الرسم العام
// ═══════════════════════════════════════════════════════════════════════════
function proAdminRender() {
    const content = document.getElementById('proAdminContent');
    if (!content) return;
    const navHtml = proAdminNavHtml();
    const nav = document.getElementById('proAdminNav'); if (nav) nav.innerHTML = navHtml;
    const navM = document.getElementById('proAdminNavMobile'); if (navM) navM.innerHTML = navHtml;
    const foot = document.getElementById('proAdminFoot');
    if (foot) foot.innerHTML =
        '<button class="pro-admin-link" onclick="proCloseAdmin();setView(\'shop\')"><span class="pro-admin-ic">🏪</span><span class="pro-admin-txt">معاينة المتجر</span></button>' +
        '<button class="pro-admin-link" onclick="proCloseAdmin();toggleDashboard()"><span class="pro-admin-ic">📊</span><span class="pro-admin-txt">التقارير المتقدمة</span></button>';

    const storeName = settings.store || 'متجرك';
    const sn = document.getElementById('proAdminStoreName'); if (sn) sn.textContent = storeName;
    const logo = document.getElementById('proAdminLogo');
    if (logo) logo.innerHTML = settings.logo ? '<img src="' + esc(settings.logo) + '" alt="">' : esc((storeName || '2M').slice(0, 2));

    const titles = {
        overview: ['🏠 نظرة عامة', 'كل ما يهمك في شاشة واحدة'],
        orders: ['🧾 إدارة الطلبات', 'تابع كل طلب من الاستلام حتى التسليم'],
        order: ['📄 تفاصيل الطلب', 'بيانات العميل والأصناف والإجراءات'],
        products: ['📦 المنتجات والمخزون', 'بحث وتعديل وتوفر فوري'],
        productForm: ['✏️ تحرير منتج', 'الصور والوصف والسعر قبل الخصم'],
        categories: ['📂 الأقسام', 'إضافة وترتيب وتصوير الأقسام'],
        banners: ['🖼️ البنرات والعروض', 'سلايدر الصفحة الرئيسية'],
        customers: ['👥 العملاء والصلاحيات', 'الأدوار وما يستطيعه كل دور'],
        settings: ['⚙️ إعدادات المتجر', 'الهوية والدفع والشحن']
    };
    const t = titles[proAdminState.view] || titles.overview;
    const tt = document.getElementById('proAdminTitle'); if (tt) tt.textContent = t[0];
    const ts = document.getElementById('proAdminSub'); if (ts) ts.textContent = t[1];

    let html = '';
    if (proPreview) {
        html += '<div style="background:#fff7e6;border:1px solid #f5b62c;color:#7a5200;border-radius:14px;padding:11px 14px;margin-bottom:16px;font-size:.82rem;font-weight:800;line-height:1.7">' +
            '🔍 <b>وضع المعاينة</b> — أنت تستعرض اللوحة على البيانات الحقيقية. أي تعديل هنا <b>لا يُحفظ على السحابة</b>. ' +
            'للعمل الفعلي: سجّل دخولك بحساب المدير من الموقع.</div>';
    }

    switch (proAdminState.view) {
        case 'orders': html += proViewOrders(); break;
        case 'order': html += proViewOrderDetail(); break;
        case 'products': html += proViewProducts(); break;
        case 'productForm': html += proViewProductForm(); break;
        case 'categories': html += proViewCategories(); break;
        case 'banners': html += proViewBanners(); break;
        case 'customers': html += proViewCustomers(); break;
        case 'settings': html += proViewSettings(); break;
        default: html += proViewOverview();
    }
    content.innerHTML = html;
    if (proAdminState.view === 'customers') proLoadCustomers();
    if (proAdminState.view === 'banners') proLoadBanners().then(() => {
        const c = document.getElementById('proAdminContent');
        if (c && proAdminState.view === 'banners') c.innerHTML = (proPreview ? '' : '') + proViewBanners();
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  3) البيانات: الطلبات (محلي + سحابي)
// ═══════════════════════════════════════════════════════════════════════════
async function proLoadCloudOrders() {
    if (proPreview || typeof cloudReady !== 'function' || !cloudReady() || sessionRole !== 'admin') return;
    if (proAdminState.loadingOrders) return;
    proAdminState.loadingOrders = true;
    try {
        const { data, error } = await sb.from('invoices')
            .select('*, invoice_items(*), profiles(username)')
            .order('created_at', { ascending: false })
            .limit(300);
        if (!error && Array.isArray(data)) proCloudOrders = data;
    } catch (e) {}
    proAdminState.loadingOrders = false;
    if (proAdminState.view === 'orders' || proAdminState.view === 'overview') proAdminRender();
}

function proNormalizeCloudOrder(r) {
    return {
        key: 'c' + r.id,
        cid: r.id,
        lid: null,
        no: r.invoice_no,
        date: r.created_at,
        status: r.status || 'قيد المعالجة',
        customer: r.customer_name || 'عميل',
        seller: (r.profiles && r.profiles.username) || '—',
        phone: r.customer_phone || '',
        city: r.customer_city || '',
        area: r.customer_area || '',
        address: r.customer_address || '',
        notes: r.notes || '',
        payment: r.payment_method || 'cash',
        paymentStatus: r.payment_status || 'unpaid',
        receipt: r.receipt_url || '',
        fulfillment: r.fulfillment || 'delivery',
        source: r.source || 'pos',
        token: r.order_token || '',
        items: (r.invoice_items || []).map(x => ({ name: x.item_name, cat: x.category_name, qty: x.qty, price: x.price })),
        subtotal: r.subtotal || 0, discount: r.discount || 0, tax: r.tax || 0,
        total: r.total || 0, cloud: true
    };
}
function proNormalizeLocalOrder(inv) {
    return {
        key: inv.lid || ('l' + inv.no),
        cid: inv.cid || null,
        lid: inv.lid || null,
        no: inv.no,
        date: inv.date,
        status: inv.status || 'قيد المعالجة',
        customer: inv.customer || 'عميل',
        seller: inv.user || '—',
        phone: inv.phone || '',
        city: inv.city || '',
        area: inv.area || '',
        address: inv.address || '',
        notes: inv.notes || '',
        payment: inv.payment || 'cash',
        paymentStatus: inv.paymentStatus || 'unpaid',
        receipt: inv.receipt || '',
        fulfillment: inv.fulfillment || 'delivery',
        source: inv.source || 'pos',
        token: inv.token || '',
        items: (inv.items || []).map(x => ({ name: x.name, cat: x.cat, qty: x.qty, price: x.price })),
        subtotal: inv.subtotal || 0, discount: inv.discount || 0, tax: inv.tax || 0,
        total: inv.total || 0, cloud: false
    };
}
function proAllOrders() {
    const byCid = {};
    const out = [];
    (invoices || []).forEach(inv => {
        const o = proNormalizeLocalOrder(inv);
        if (o.cid) byCid[String(o.cid)] = o;
        out.push(o);
    });
    proCloudOrders.forEach(r => {
        const c = proNormalizeCloudOrder(r);
        const local = byCid[String(c.cid)];
        if (local) {
            // نكمّل بيانات الطلب المحلي (الأغنى عادة) بما لا يوجد فيه
            ['phone', 'city', 'area', 'address', 'notes', 'receipt', 'token'].forEach(k => {
                if (!local[k] && c[k]) local[k] = c[k];
            });
            if (!local.items.length && c.items.length) local.items = c.items;
            return;
        }
        out.push(c);
    });
    out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return out;
}
function proOrderByKey(key) {
    return proAllOrders().filter(o => o.key === key)[0] || null;
}
const PRO_STATUS_GROUPS = {
    all: () => true,
    new: o => o.status === 'قيد المعالجة',
    confirmed: o => o.status === 'مؤكد',
    shipping: o => o.status === 'في الطريق',
    delivered: o => o.status === 'تم التوصيل',
    cancelled: o => o.status === 'ملغي' || o.status === 'تم رفض الطلب'
};
function proStatusLabel(s) {
    const m = { 'قيد المعالجة': '🆕 جديد', 'مؤكد': '✅ مؤكد', 'في الطريق': '🚚 في الطريق', 'تم التوصيل': '📦 تم التوصيل', 'تم رفض الطلب': '❌ مرفوض', 'ملغي': '🚫 ملغي' };
    return m[s] || s;
}
function proSourceLabel(s) {
    const m = { web: ['🌐', 'الموقع'], telegram: ['✈️', 'تيليجرام'], pos: ['🧾', 'الكاشير'], whatsapp: ['💬', 'واتساب'] };
    const v = m[s] || m.pos;
    return '<span class="pro-src-ic" title="' + v[1] + '">' + v[0] + '</span>';
}
function proPayLabel(p) {
    const m = { cod: '💵 عند الاستلام', cash: '💵 نقدي', vodafone: '📱 فودافون كاش', instapay: '⚡ إنستاباي', bank: '🏦 تحويل بنكي' };
    return m[p] || p;
}

// ═══════════════════════════════════════════════════════════════════════════
//  4) الشاشة الرئيسية
// ═══════════════════════════════════════════════════════════════════════════
function proViewOverview() {
    const orders = proAllOrders();
    const today = new Date().toDateString();
    const todayOrders = orders.filter(o => new Date(o.date || 0).toDateString() === today);
    const todaySales = todayOrders.filter(o => o.status !== 'ملغي' && o.status !== 'تم رفض الطلب')
        .reduce((s, o) => s + proNum(o.total), 0);
    const newCount = orders.filter(o => o.status === 'قيد المعالجة').length;
    let totalItems = 0, outCount = 0, lowCount = 0, stockValue = 0;
    (db || []).forEach(c => (c.items || []).forEach(it => {
        totalItems++;
        const q = getQ(it);
        stockValue += q * itemPrice(it);
        if (q === 0) outCount++; else if (q <= getMin(it)) lowCount++;
    }));
    // مبيعات آخر 7 أيام
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toDateString();
        const sum = orders.filter(o => new Date(o.date || 0).toDateString() === key && o.status !== 'ملغي' && o.status !== 'تم رفض الطلب')
            .reduce((s, o) => s + proNum(o.total), 0);
        days.push({ label: d.toLocaleDateString('ar-EG', { weekday: 'short' }), sum: sum });
    }
    const maxDay = Math.max.apply(null, days.map(d => d.sum).concat([1]));
    const chart = days.map(d =>
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0">' +
            '<div style="width:100%;height:70px;display:flex;align-items:flex-end"><div style="width:100%;height:' + Math.max(3, Math.round(d.sum / maxDay * 100)) + '%;background:linear-gradient(180deg,var(--accent),var(--primary));border-radius:6px 6px 3px 3px;min-height:3px"></div></div>' +
            '<div style="font-size:.66rem;font-weight:800;color:var(--text-muted)">' + d.label + '</div>' +
        '</div>').join('');

    const recent = orders.slice(0, 6).map(o =>
        '<div class="pro-order-row" onclick="proOrderOpen(\'' + o.key + '\')">' +
            proSourceLabel(o.source) +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#' + String(o.no || '').padStart(4, '0') + ' · ' + esc(o.customer) + '</div>' +
            '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + (o.items || []).length + ' صنف · ' + proPayLabel(o.payment) + '</div></div>' +
            '<div style="text-align:left"><div style="font-weight:900;font-size:.86rem">' + fmt(proNum(o.total)) + ' ج</div>' +
            '<div style="font-size:.7rem;font-weight:800;color:var(--text-muted)">' + proStatusLabel(o.status) + '</div></div>' +
        '</div>').join('') || '<div style="padding:18px;text-align:center;color:var(--text-muted);font-weight:700;font-size:.85rem">لا توجد طلبات بعد</div>';

    const lowList = (db || []).flatMap(c => (c.items || []).filter(it => getQ(it) <= getMin(it)).map(it => ({ c: c, it: it })))
        .slice(0, 6).map(x =>
            '<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<span style="font-size:1rem">' + (getQ(x.it) === 0 ? '❌' : '⚠️') + '</span>' +
                '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(x.it.n) + '</div>' +
                '<div style="font-size:.7rem;color:var(--text-muted);font-weight:700">' + esc(x.c.name) + '</div></div>' +
                '<span style="font-weight:900;font-size:.8rem;color:' + (getQ(x.it) === 0 ? 'var(--danger)' : 'var(--gold)') + '">' + getQ(x.it) + '</span>' +
            '</div>').join('') || '<div style="padding:16px;text-align:center;color:var(--text-muted);font-weight:700;font-size:.82rem">كل المنتجات بمخزون كافٍ ✅</div>';

    return '' +
    '<div class="pro-kpi-grid">' +
        '<button class="pro-kpi-card accent" onclick="proAdminGo(\'orders\')">' +
            '<div class="pro-kpi-lbl">طلبات جديدة بانتظار التأكيد</div>' +
            '<div class="pro-kpi-val">' + newCount + '</div>' +
            '<div class="pro-kpi-note">اضغط لإدارتها فورًا ←</div>' +
        '</button>' +
        '<button class="pro-kpi-card" onclick="proAdminGo(\'orders\')">' +
            '<div class="pro-kpi-lbl">💵 مبيعات اليوم</div>' +
            '<div class="pro-kpi-val">' + fmt(todaySales) + '</div>' +
            '<div class="pro-kpi-note">' + todayOrders.length + ' طلب اليوم</div>' +
        '</button>' +
        '<button class="pro-kpi-card" onclick="proAdminGo(\'products\')">' +
            '<div class="pro-kpi-lbl">📦 المنتجات</div>' +
            '<div class="pro-kpi-val">' + totalItems + '</div>' +
            '<div class="pro-kpi-note">قيمة المخزون ' + fmt(stockValue) + ' ج</div>' +
        '</button>' +
        '<button class="pro-kpi-card" onclick="proAdminGo(\'products\')">' +
            '<div class="pro-kpi-lbl">⚠️ تنبيهات المخزون</div>' +
            '<div class="pro-kpi-val">' + (outCount + lowCount) + '</div>' +
            '<div class="pro-kpi-note">' + outCount + ' نافد · ' + lowCount + ' منخفض</div>' +
        '</button>' +
    '</div>' +

    '<div class="pro-quick-grid">' +
        '<button class="pro-quick-btn" onclick="proProductNew()"><span class="pro-quick-ic">➕</span> إضافة منتج</button>' +
        '<button class="pro-quick-btn" onclick="proAdminGo(\'banners\')"><span class="pro-quick-ic">🖼️</span> إضافة بنر إعلاني</button>' +
        '<button class="pro-quick-btn" onclick="proAdminGo(\'settings\')"><span class="pro-quick-ic">⚙️</span> إعدادات المتجر</button>' +
        '<button class="pro-quick-btn" onclick="proCloseAdmin();showInvoiceHistory()"><span class="pro-quick-ic">📊</span> سجل الفواتير</button>' +
    '</div>' +

    '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>📈 مبيعات آخر 7 أيام</h3>' +
        '<span style="font-size:.8rem;font-weight:900;color:var(--primary)">' + fmt(days.reduce((s, d) => s + d.sum, 0)) + ' ج.م</span></div>' +
        '<div style="display:flex;gap:8px;align-items:flex-end">' + chart + '</div>' +
    '</div>' +

    '<div class="pro-detail-grid">' +
        '<div class="pro-card" style="margin:0">' +
            '<div class="pro-card-head"><h3>🧾 أحدث الطلبات</h3>' +
            '<button class="pro-sec-more" onclick="proAdminGo(\'orders\')">الكل ←</button></div>' +
            recent +
        '</div>' +
        '<div class="pro-card" style="margin:0">' +
            '<div class="pro-card-head"><h3>⚠️ تحتاج إعادة طلب</h3>' +
            '<button class="pro-sec-more" onclick="proAdminGo(\'products\')">المخزون ←</button></div>' +
            lowList +
        '</div>' +
    '</div>' +

    (proIsOpen() ? '' : '<div class="pro-card" style="border-color:var(--gold);background:#fffbf0">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:1.4rem">🌙</span>' +
        '<div style="flex:1;font-size:.85rem;font-weight:800">المتجر <b>مغلق حاليًا</b> — الزوار لا يستطيعون إتمام طلبات جديدة.</div>' +
        '<button class="btn btn-primary" style="padding:8px 16px" onclick="proToggleStoreOpen()">🔓 فتح المتجر الآن</button></div></div>');
}

// ═══════════════════════════════════════════════════════════════════════════
//  5) إدارة الطلبات
// ═══════════════════════════════════════════════════════════════════════════
function proViewOrders() {
    const all = proAllOrders();
    const counts = {};
    Object.keys(PRO_STATUS_GROUPS).forEach(k => { counts[k] = all.filter(PRO_STATUS_GROUPS[k]).length; });
    const tabs = [
        ['all', 'الكل'], ['new', '🆕 جديدة'], ['confirmed', '✅ مؤكدة'],
        ['shipping', '🚚 في الطريق'], ['delivered', '📦 تم التوصيل'], ['cancelled', '🚫 ملغية']
    ];
    const pills = tabs.map(t =>
        '<button class="pro-pill' + (proAdminState.orderFilter === t[0] ? ' active' : '') + '" onclick="proOrderFilter(\'' + t[0] + '\')">' +
        t[1] + '<span class="pro-pill-cnt">' + (counts[t[0]] || 0) + '</span></button>').join('');

    const q = (proAdminState.orderQ || '').trim().toLowerCase();
    let list = all.filter(PRO_STATUS_GROUPS[proAdminState.orderFilter] || PRO_STATUS_GROUPS.all);
    if (q) {
        list = list.filter(o =>
            String(o.no || '').indexOf(q) !== -1 ||
            String(o.customer || '').toLowerCase().indexOf(q) !== -1 ||
            String(o.phone || '').indexOf(q) !== -1 ||
            String(o.city || '').toLowerCase().indexOf(q) !== -1);
    }

    const rows = list.map(o => {
        const st = o.status;
        return '<div class="pro-order-row" onclick="proOrderOpen(\'' + o.key + '\')">' +
            proSourceLabel(o.source) +
            '<div style="flex:1;min-width:0">' +
                '<div style="font-weight:900;font-size:.86rem">#' + String(o.no || '').padStart(4, '0') + ' · ' + esc(o.customer) + '</div>' +
                '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                    (o.phone ? '📞 ' + esc(o.phone) + ' · ' : '') +
                    (o.fulfillment === 'pickup' ? '🏬 استلام من المحل' : ('🚚 ' + esc(o.city || o.address || 'توصيل'))) +
                '</div>' +
            '</div>' +
            '<div style="text-align:center"><div style="font-weight:900;font-size:.86rem;white-space:nowrap">' + fmt(proNum(o.total)) + ' ج</div>' +
            '<div style="font-size:.68rem;font-weight:800;color:var(--text-muted);white-space:nowrap">' + new Date(o.date || 0).toLocaleDateString('ar-EG') + '</div></div>' +
            '<span class="status ' + statusClass(st) + '" style="white-space:nowrap;font-size:.7rem">' + proStatusLabel(st) + '</span>' +
        '</div>';
    }).join('') || '<div style="padding:34px 16px;text-align:center;color:var(--text-muted);font-weight:700;font-size:.88rem">لا توجد طلبات في هذا التصنيف' +
        (proPreview ? '<br><button class="btn btn-outline" style="margin-top:12px;padding:9px 16px;font-size:.82rem" onclick="proCreateDemoOrder()">➕ إنشاء طلب تجريبي لتجربة الشاشة</button>' : '') +
        '</div>';

    return '<div class="pro-card">' +
        '<div class="pro-card-head">' +
            '<h3>🧾 ' + list.length + ' طلب</h3>' +
            '<button class="btn btn-outline" style="padding:8px 14px;font-size:.8rem" onclick="proAdminRefresh()">🔄 تحديث</button>' +
        '</div>' +
        '<input type="search" placeholder="🔍 ابحث برقم الطلب أو الاسم أو الهاتف..." value="' + esc(proAdminState.orderQ) + '" ' +
            'oninput="proAdminState.orderQ=this.value;clearTimeout(window.__proOq);window.__proOq=setTimeout(proAdminRender,260)" ' +
            'style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:700;margin-bottom:12px">' +
        '<div class="pro-pills">' + pills + '</div>' +
        '<div style="margin:0 -4px">' + rows + '</div>' +
    '</div>';
}
function proOrderFilter(f) {
    proAdminState.orderFilter = f;
    proAdminRender();
}
function proOrderOpen(key) {
    proAdminState.openOrder = key;
    proAdminState.view = 'order';
    proAdminRender();
    const sc = document.querySelector('.pro-admin-scroll'); if (sc) sc.scrollTop = 0;
}
function proOrderBack() {
    proAdminState.view = 'orders';
    proAdminState.openOrder = null;
    proAdminRender();
}

function proViewOrderDetail() {
    const o = proOrderByKey(proAdminState.openOrder);
    if (!o) return '<div class="pro-card"><div style="padding:30px;text-align:center;font-weight:800">الطلب غير موجود — <a onclick="proOrderBack()" style="color:var(--primary);cursor:pointer">رجوع</a></div></div>';
    const lines = (o.items || []).map(it =>
        '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.85rem">' + esc(it.name) + '</div>' +
            '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + esc(it.cat || '') + ' · ' + fmt(proNum(it.price)) + ' ج × ' + it.qty + '</div></div>' +
            '<div style="font-weight:900;font-size:.85rem;white-space:nowrap">' + fmt(proNum(it.price) * it.qty) + ' ج</div>' +
        '</div>').join('');

    const timeline = ['قيد المعالجة', 'مؤكد', 'في الطريق', 'تم التوصيل'];
    const idx = timeline.indexOf(o.status);
    const steps = timeline.map((s, i) =>
        '<div class="pro-track-node' + (i < idx ? ' done' : i === idx ? ' current' : '') + '">' +
            '<div class="pro-track-dot">' + (i < idx ? '✓' : ['🆕', '✅', '🚚', '📦'][i]) + '</div>' +
            '<div style="font-size:.7rem">' + s + '</div>' +
        '</div>').join('');

    const cancelled = o.status === 'ملغي' || o.status === 'تم رفض الطلب';
    const nextBtn = (label, status, color) =>
        '<button class="btn" style="background:' + color + ';color:#fff;border:none;padding:10px 15px;font-size:.82rem" onclick="proOrderSetStatus(\'' + o.key + '\',\'' + status + '\')">' + label + '</button>';

    let actions = '';
    if (!cancelled && o.status !== 'تم التوصيل') {
        if (o.status === 'قيد المعالجة') actions += nextBtn('✅ تأكيد الطلب', 'مؤكد', 'var(--primary)');
        if (o.status === 'مؤكد') actions += nextBtn('🚚 خرج للتوصيل', 'في الطريق', '#20a4c9');
        if (o.status === 'في الطريق') actions += nextBtn('📦 تم التسليم', 'تم التوصيل', 'var(--success)');
    }
    if (!cancelled && o.status !== 'تم التوصيل') {
        actions += '<button class="btn btn-outline" style="padding:10px 15px;font-size:.82rem;color:#c0392b;border-color:#c0392b" onclick="proOrderSetStatus(\'' + o.key + '\',\'ملغي\')">🚫 إلغاء الطلب</button>';
    } else if (cancelled) {
        actions += '<span style="font-size:.82rem;font-weight:800;color:var(--pro-sale)">هذا الطلب ' + proStatusLabel(o.status) + ' — والمخزون أُعيد تلقائيًا.</span>';
    }

    const waPhone = waNumber(o.phone);
    const contactBtns =
        (o.phone ? '<a class="btn btn-primary" style="padding:10px 14px;font-size:.82rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px" href="tel:' + esc(o.phone) + '">📞 اتصال</a>' : '') +
        (waPhone ? '<a class="btn" style="padding:10px 14px;font-size:.82rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px;background:var(--pro-whatsapp);color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + waPhone + '?text=' + encodeURIComponent('مرحبًا ' + (o.customer || '') + '، بخصوص طلبك رقم #' + String(o.no || '').padStart(4, '0') + ' من ' + (settings.store || 'المتجر')) + '">💬 واتساب</a>' : '') +
        (o.token ? '<button class="btn btn-outline" style="padding:10px 14px;font-size:.82rem" onclick="proCopyTrackLink(\'' + esc(o.token) + '\')">🔗 رابط التتبّع</button>' : '');

    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
        '<button class="btn btn-outline" style="padding:8px 14px;font-size:.82rem" onclick="proOrderBack()">← كل الطلبات</button>' +
        '<button class="btn btn-outline" style="padding:8px 14px;font-size:.82rem" onclick="proPrintOrder(\'' + o.key + '\')">🖨️ طباعة</button>' +
    '</div>' +
    '<div class="pro-detail-grid">' +
        '<div>' +
            '<div class="pro-card">' +
                '<div class="pro-card-head"><h3>#' + String(o.no || '').padStart(4, '0') + '</h3>' +
                '<span class="status ' + statusClass(o.status) + '" style="font-size:.74rem">' + proStatusLabel(o.status) + '</span></div>' +
                '<div class="pro-track-steps">' + steps + '</div>' +
                '<div style="font-size:.76rem;color:var(--text-muted);font-weight:700;text-align:center">' +
                    'أُنشئ في ' + (o.date ? new Date(o.date).toLocaleString('ar-EG') : '—') + ' · المصدر: ' + (o.source === 'pos' ? 'الكاشير' : o.source === 'telegram' ? 'تيليجرام' : 'الموقع') +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' + actions + '</div>' +
            '</div>' +
            '<div class="pro-card">' +
                '<div class="pro-card-head"><h3>🛍️ الأصناف (' + (o.items || []).length + ')</h3></div>' +
                lines +
                '<div style="margin-top:12px">' +
                    '<div class="ct-row" style="display:flex;justify-content:space-between;font-size:.83rem;font-weight:700;padding:5px 0"><span>المجموع الفرعي</span><span>' + fmt(proNum(o.subtotal)) + ' ج</span></div>' +
                    (proNum(o.discount) > 0 ? '<div class="ct-row" style="display:flex;justify-content:space-between;font-size:.83rem;font-weight:700;padding:5px 0;color:var(--success)"><span>الخصم</span><span>−' + fmt(proNum(o.discount)) + ' ج</span></div>' : '') +
                    (proNum(o.tax) > 0 ? '<div class="ct-row" style="display:flex;justify-content:space-between;font-size:.83rem;font-weight:700;padding:5px 0"><span>الضريبة</span><span>' + fmt(proNum(o.tax)) + ' ج</span></div>' : '') +
                    '<div class="ct-row" style="display:flex;justify-content:space-between;font-size:.95rem;font-weight:900;padding:9px 0;border-top:1px solid var(--border);margin-top:6px"><span>الإجمالي</span><span>' + fmt(proNum(o.total)) + ' ج.م</span></div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div>' +
            '<div class="pro-card">' +
                '<div class="pro-card-head"><h3>👤 بيانات العميل</h3></div>' +
                '<div style="font-size:.86rem;font-weight:800;margin-bottom:8px">' + esc(o.customer) + '</div>' +
                (o.phone ? '<div style="font-size:.84rem;font-weight:700;margin-bottom:6px;direction:ltr;text-align:right">📞 ' + esc(o.phone) + '</div>' : '<div style="font-size:.8rem;color:var(--muted);font-weight:700;margin-bottom:6px">📞 لا يوجد رقم مسجّل</div>') +
                '<div style="font-size:.84rem;font-weight:700;margin-bottom:6px">🚚 ' + (o.fulfillment === 'pickup' ? 'استلام من المحل' : 'توصيل') + '</div>' +
                (o.city || o.area ? '<div style="font-size:.84rem;font-weight:700;margin-bottom:6px">📍 ' + esc((o.city || '') + (o.area ? ' · ' + o.area : '')) + '</div>' : '') +
                (o.address ? '<div style="font-size:.82rem;font-weight:700;background:var(--bg-soft);padding:9px 11px;border-radius:10px;margin:8px 0;line-height:1.7">' + esc(o.address) + '</div>' : '') +
                (o.notes ? '<div style="font-size:.8rem;font-weight:700;color:var(--text-muted);background:var(--bg-soft);padding:9px 11px;border-radius:10px;margin:8px 0">📝 ' + esc(o.notes) + '</div>' : '') +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' + contactBtns + '</div>' +
            '</div>' +
            '<div class="pro-card">' +
                '<div class="pro-card-head"><h3>💳 الدفع</h3></div>' +
                '<div style="font-size:.86rem;font-weight:800">' + proPayLabel(o.payment) + '</div>' +
                '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-top:4px">' +
                    ({ unpaid: 'غير مدفوع', review: 'بانتظار مراجعة التحويل', paid: 'مدفوع' }[o.paymentStatus] || o.paymentStatus) + '</div>' +
                (o.receipt ? '<div style="margin-top:10px"><div style="font-size:.76rem;font-weight:800;margin-bottom:6px">🧾 إيصال التحويل</div>' +
                    '<a href="' + esc(o.receipt) + '" target="_blank" rel="noopener"><img src="' + esc(o.receipt) + '" alt="" style="width:100%;max-height:240px;object-fit:contain;border-radius:12px;border:1px solid var(--border);background:var(--bg-soft)"></a></div>' : '') +
                (o.phone && o.payment !== 'cod' ? '<button class="btn btn-outline" style="margin-top:10px;width:100%;padding:8px;font-size:.8rem" onclick="proOrderSetStatus(\'' + o.key + '\',\'' + o.status + '\')">✅ تأكيد استلام المبلغ</button>' : '') +
            '</div>' +
        '</div>' +
    '</div>';
}

async function proOrderSetStatus(key, status) {
    const o = proOrderByKey(key);
    if (!o) return;
    if (status === 'ملغي' && !confirm('إلغاء الطلب #' + String(o.no || '').padStart(4, '0') + '؟ سيُرجَع المخزون تلقائيًا.')) return;
    // (أ) محليًا عبر المسار الموجود (يحافظ على خصم/استرجاع المخزون)
    const idx = (invoices || []).findIndex(inv => (inv.lid && inv.lid === o.lid) || (inv.cid && String(inv.cid) === String(o.cid)));
    if (idx >= 0 && typeof updateOrderStatus === 'function') {
        updateOrderStatus(idx, status);
    } else if (o.cloud && !proPreview) {
        // (ب) سحابيًا لطلب لم يُسحب محليًا
        try {
            const up = { status: status, updated_at: new Date().toISOString() };
            const { error } = await sb.from('invoices').update(up).eq('id', o.cid);
            if (error) throw error;
            const row = proCloudOrders.filter(r => String(r.id) === String(o.cid))[0];
            if (row) row.status = status;
            toast('✅ تم تحديث الطلب إلى: ' + status);
        } catch (e) {
            toast('❌ تعذّر تحديث الطلب: ' + ((e && e.message) || ''));
            return;
        }
    }
    proHaptic('success');
    proAdminRender();
}

function proCopyTrackLink(token) {
    const url = location.origin + location.pathname + '?order=' + token;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('🔗 تم نسخ رابط تتبّع الطلب')).catch(() => toast(url, 6000));
    else toast(url, 6000);
}
function proPrintOrder(key) {
    const o = proOrderByKey(key);
    if (!o) return;
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) return toast('⚠️ اسمح بالنوافذ المنبثقة للطباعة');
    const rows = (o.items || []).map(i =>
        '<tr><td>' + esc(i.name) + '</td><td>' + i.qty + '</td><td>' + fmt(proNum(i.price) * i.qty) + '</td></tr>').join('');
    w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>طلب #' + o.no + '</title>' +
        '<style>body{font-family:Tahoma,Arial;padding:14px;font-size:12px}h2{text-align:center;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px dashed #ccc;padding:5px;text-align:right}th{background:#f2f2f2}.tot{font-weight:900;font-size:14px;margin-top:8px;text-align:left}</style>' +
        '</head><body><h2>' + esc(settings.store || '') + '</h2><div style="text-align:center">طلب #' + String(o.no || '').padStart(4, '0') + '</div>' +
        '<div>👤 ' + esc(o.customer) + '</div><div>📞 ' + esc(o.phone || '—') + '</div><div>📍 ' + esc(o.address || '—') + '</div>' +
        '<table><thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="tot">الإجمالي: ' + fmt(proNum(o.total)) + ' ج.م</div>' +
        '<div style="text-align:center;margin-top:14px;font-size:10px">' + esc(settings.footer || '') + '</div>' +
        '<script>window.onload=function(){window.print()}<\/script></body></html>');
    w.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
//  6) المنتجات
// ═══════════════════════════════════════════════════════════════════════════
function proViewProducts() {
    const q = (proAdminState.prodQ || '').trim().toLowerCase();
    const catF = proAdminState.prodCat;
    const rows = [];
    (db || []).forEach((c, ci) => (c.items || []).forEach((it, ii) => {
        if (catF !== 'all' && String(ci) !== String(catF)) return;
        if (q && String(it.n).toLowerCase().indexOf(q) === -1 && String(it.b || '').indexOf(q) === -1) return;
        rows.push({ c: c, ci: ci, it: it, ii: ii });
    }));
    const catOpts = ['<option value="all">كل الأقسام (' + (db || []).length + ')</option>']
        .concat((db || []).map((c, i) => '<option value="' + i + '"' + (String(catF) === String(i) ? ' selected' : '') + '>' + esc(c.name) + '</option>')).join('');

    const table = rows.map(r => {
        const it = r.it, imgs = proItemImages(it), pct = proDiscountPct(it);
        const qs = getQs(it);
        return '<tr>' +
            '<td style="min-width:190px"><div style="display:flex;align-items:center;gap:9px">' +
                '<div style="width:42px;height:42px;border-radius:10px;overflow:hidden;background:var(--bg-soft);display:grid;place-items:center;flex-shrink:0;font-size:1.1rem">' +
                    (imgs.length ? '<img src="' + esc(imgs[0]) + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">' : '📦') + '</div>' +
                '<div style="min-width:0"><div style="font-weight:800;font-size:.84rem">' + esc(it.n) + '</div>' +
                '<div style="font-size:.7rem;color:var(--text-muted);font-weight:700">' + esc(r.c.name) + (imgs.length > 1 ? ' · 🖼️ ' + imgs.length : '') + (String(it.desc || '').trim() ? ' · 📝' : '') + '</div></div>' +
            '</div></td>' +
            '<td style="white-space:nowrap"><div style="font-weight:900;font-size:.84rem">' + fmt(itemPrice(it)) + ' ج</div>' +
                (proOldPrice(it) > itemPrice(it) ? '<div style="font-size:.7rem"><span class="pro-old-price">' + fmt(proOldPrice(it)) + '</span> <span style="color:var(--pro-sale);font-weight:900">-' + pct + '%</span></div>' : '') + '</td>' +
            '<td><div style="font-weight:900;font-size:.84rem;color:' + (qs === 0 ? 'var(--danger)' : qs <= getMin(it) ? 'var(--gold)' : 'var(--success)') + '">' + qs + '</div>' +
                '<div style="font-size:.68rem;color:var(--text-muted);font-weight:700">مخزن ' + getQ(it) + '</div></td>' +
            '<td><label class="pro-switch"><input type="checkbox" ' + (qs > 0 ? 'checked' : '') + ' onchange="proProductToggle(' + r.ci + ',' + r.ii + ',this.checked)"><span class="pro-switch-track"></span></label></td>' +
            '<td><div class="mini-actions"><button class="mini-btn" title="تعديل" onclick="proProductEdit(' + r.ci + ',' + r.ii + ')">✏️</button>' +
                '<button class="mini-btn" title="حذف" onclick="proProductDelete(' + r.ci + ',' + r.ii + ')" style="color:var(--danger)">🗑️</button></div></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);font-weight:700">لا توجد منتجات مطابقة</td></tr>';

    return '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>📦 ' + rows.length + ' منتج</h3>' +
            '<button class="btn btn-primary" style="padding:8px 15px;font-size:.82rem" onclick="proProductNew()">➕ منتج جديد</button></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
            '<input type="search" placeholder="🔍 ابحث بالاسم أو الباركود..." value="' + esc(proAdminState.prodQ) + '" ' +
                'oninput="proAdminState.prodQ=this.value;clearTimeout(window.__proPq);window.__proPq=setTimeout(proAdminRender,240)" ' +
                'style="flex:1;min-width:180px;padding:10px 13px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:700">' +
            '<select onchange="proAdminState.prodCat=this.value;proAdminRender()" style="padding:10px 13px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:800">' + catOpts + '</select>' +
        '</div>' +
        '<div class="table-wrap" style="margin:0"><table><thead><tr><th>المنتج</th><th>السعر</th><th>المتاح</th><th>متوفر</th><th>إجراءات</th></tr></thead><tbody>' + table + '</tbody></table></div>' +
    '</div>';
}
function proProductToggle(ci, ii, on) {
    const it = db[ci] && db[ci].items[ii];
    if (!it) return;
    const target = on ? Math.max(getQ(it), 1) : 0;
    it.qs = target;
    if (on && getQ(it) < target) it.q = target;
    save();
    proQueueSafe({ t: 'item-upd', lid: it.lid, catLid: db[ci].lid });
    toast(on ? '✅ صار المنتج متاحًا للبيع' : '⏸️ أُوقف عرض المنتج');
    proAdminRender();
}
function proProductNew() {
    if (!db || !db.length) return toast('⚠️ أضف قسمًا أولًا');
    proAdminState.view = 'productForm';
    proAdminState.editing = { ci: 0, ii: -1 };
    proAdminState.form = { n: '', p: '', pn: '', oldP: '', q: 0, qs: 0, min: 5, b: '', desc: '', catCi: 0, imgs: [] };
    proAdminRender();
}
function proProductEdit(ci, ii) {
    const it = db[ci] && db[ci].items[ii];
    if (!it) return;
    proAdminState.view = 'productForm';
    proAdminState.editing = { ci: ci, ii: ii };
    proAdminState.form = {
        n: it.n || '', p: it.p || '', pn: it.pn !== undefined ? it.pn : itemPrice(it),
        oldP: proOldPrice(it) || '', q: getQ(it), qs: getQs(it), min: getMin(it),
        b: it.b || '', desc: it.desc || '', catCi: ci, imgs: proItemImages(it).slice(0, 8)
    };
    proAdminRender();
}
function proProductFormSet(k, v) {
    if (!proAdminState.form) return;
    proAdminState.form[k] = v;
}
function proViewProductForm() {
    const f = proAdminState.form;
    if (!f) return '';
    const isNew = proAdminState.editing.ii === -1;
    const catOpts = (db || []).map((c, i) => '<option value="' + i + '"' + (String(f.catCi) === String(i) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const tiles = f.imgs.map((u, k) =>
        '<div class="pro-img-tile">' +
            '<img src="' + esc(u) + '" alt="">' +
            '<button class="pro-img-del" onclick="proProductImgRemove(' + k + ')" title="حذف">✕</button>' +
            '<button class="pro-img-cover" onclick="proProductImgCover(' + k + ')">' + (k === 0 ? '✓ الغلاف' : 'اجعله غلافًا') + '</button>' +
        '</div>').join('');

    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
        '<button class="btn btn-outline" style="padding:8px 14px;font-size:.82rem" onclick="proAdminGo(\'products\')">← رجوع للمنتجات</button></div>' +
    '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>' + (isNew ? '➕ منتج جديد' : '✏️ تعديل: ' + esc(f.n)) + '</h3></div>' +
        '<div class="pro-choice-grid" style="grid-template-columns:1fr 1fr">' +
            '<div class="form-group"><label>اسم المنتج *</label><input type="text" value="' + esc(f.n) + '" oninput="proProductFormSet(\'n\',this.value)" placeholder="مثال: كراسة 60 ورقة"></div>' +
            '<div class="form-group"><label>القسم</label><select onchange="proProductFormSet(\'catCi\',this.value)">' + catOpts + '</select></div>' +
        '</div>' +
        '<div class="pro-choice-grid" style="grid-template-columns:1fr 1fr 1fr">' +
            '<div class="form-group"><label>السعر (يظهر للعميل) *</label><input type="text" value="' + esc(f.p) + '" oninput="proProductFormSet(\'p\',this.value)" placeholder="25"></div>' +
            '<div class="form-group"><label>السعر قبل الخصم</label><input type="number" value="' + esc(f.oldP) + '" oninput="proProductFormSet(\'oldP\',this.value)" placeholder="35" min="0" step="0.5"></div>' +
            '<div class="form-group"><label>حد التنبيه</label><input type="number" value="' + esc(f.min) + '" oninput="proProductFormSet(\'min\',this.value)" min="0"></div>' +
        '</div>' +
        '<div class="pro-choice-grid" style="grid-template-columns:1fr 1fr 1fr">' +
            '<div class="form-group"><label>إجمالي المخزن</label><input type="number" value="' + esc(f.q) + '" oninput="proProductFormSet(\'q\',this.value)" min="0"></div>' +
            '<div class="form-group"><label>المتاح للبيع (المعروض)</label><input type="number" value="' + esc(f.qs) + '" oninput="proProductFormSet(\'qs\',this.value)" min="0"></div>' +
            '<div class="form-group"><label>الباركود</label><input type="text" value="' + esc(f.b) + '" oninput="proProductFormSet(\'b\',this.value)" style="direction:ltr;text-align:left"></div>' +
        '</div>' +
        '<div class="form-group"><label>📝 وصف المنتج (يظهر في صفحة المنتج)</label>' +
            '<textarea rows="4" oninput="proProductFormSet(\'desc\',this.value)" placeholder="اكتب وصفًا يوضّح المقاس والمادة والاستخدام..." style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:600;resize:vertical">' + esc(f.desc) + '</textarea></div>' +
        '<div class="form-group"><label>🖼️ صور المنتج (حتى 8 — الأولى هي الغلاف)</label>' +
            '<div class="pro-imgs-grid">' + tiles +
                '<label class="pro-img-add"><input type="file" accept="image/*" multiple style="display:none" onchange="proProductImgPick(event)">' +
                '<span style="font-size:1.4rem">＋</span><span>إضافة صورة</span></label>' +
            '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">' +
            '<button class="btn btn-primary" style="padding:12px 24px" onclick="proProductSave()">💾 حفظ المنتج</button>' +
            '<button class="btn btn-outline" style="padding:12px 18px" onclick="proAdminGo(\'products\')">إلغاء</button>' +
            (isNew ? '' : '<button class="btn btn-outline" style="padding:12px 18px;color:var(--danger);border-color:var(--danger);margin-inline-start:auto" onclick="proProductDelete(' + proAdminState.editing.ci + ',' + proAdminState.editing.ii + ')">🗑️ حذف</button>') +
        '</div>' +
    '</div>';
}
function proProductImgPick(ev) {
    const files = Array.prototype.slice.call(ev.target.files || []);
    if (!files.length) return;
    const f = proAdminState.form;
    const room = 8 - f.imgs.length;
    files.slice(0, Math.max(0, room)).forEach(file => {
        if (file.size > 12 * 1024 * 1024) { toast('⚠️ صورة كبيرة جدًا: ' + file.name); return; }
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const max = 900;
                const scale = Math.min(max / img.width, max / img.height, 1);
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                const data = c.toDataURL('image/jpeg', 0.78);
                proAdminState.form.imgs.push(data);
                proAdminRender();
            };
            img.onerror = function () { toast('⚠️ تعذّر قراءة الصورة'); };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
    ev.target.value = '';
}
function proProductImgRemove(k) {
    proAdminState.form.imgs.splice(k, 1);
    proAdminRender();
}
function proProductImgCover(k) {
    const f = proAdminState.form;
    const im = f.imgs.splice(k, 1)[0];
    f.imgs.unshift(im);
    proAdminRender();
}
async function proUploadImage(dataUrl, key) {
    if (proPreview || !dataUrl || dataUrl.indexOf('data:image') !== 0) return dataUrl;
    if (typeof cloudReady !== 'function' || !cloudReady()) return dataUrl;
    try {
        const blob = await (await fetch(dataUrl)).blob();
        const path = 'p_' + key + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg';
        const { error } = await sb.storage.from('products').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) return dataUrl;
        return sb.storage.from('products').getPublicUrl(path).data.publicUrl || dataUrl;
    } catch (e) { return dataUrl; }
}
async function proProductSave() {
    const f = proAdminState.form;
    if (!f) return;
    if (!String(f.n).trim()) return toast('✍️ اكتب اسم المنتج');
    if (!String(f.p).trim()) return toast('✍️ اكتب سعر المنتج');
    const ci = parseInt(f.catCi, 10) || 0;
    const isNew = proAdminState.editing.ii === -1;
    toast('⏳ جاري الحفظ...');
    // رفع الصور الجديدة (data:) إلى Storage — مع إبقائها كما هي أوفلاين
    const key = isNew ? ('new' + Date.now()) : (db[ci].items[proAdminState.editing.ii] || {}).lid || 'p';
    const finalImgs = [];
    for (let i = 0; i < f.imgs.length; i++) finalImgs.push(await proUploadImage(f.imgs[i], key + '_' + i));

    const pn = proNum(f.pn !== '' && f.pn !== undefined ? f.pn : firstNum(f.p));
    let it;
    if (isNew) {
        it = { n: String(f.n).trim(), p: String(f.p).trim(), pn: firstNum(String(f.p)) || pn, q: proNum(f.q), qs: proNum(f.qs), min: proNum(f.min), b: String(f.b).trim(), img: finalImgs[0] || '', imgUrl: '', lid: genLid() };
        db[ci].items.push(it);
        proAdminState.editing = { ci: ci, ii: db[ci].items.length - 1 };
    } else {
        it = db[proAdminState.editing.ci].items[proAdminState.editing.ii];
        it.n = String(f.n).trim();
        it.p = String(f.p).trim();
        it.pn = firstNum(String(f.p)) || pn;
        it.q = proNum(f.q);
        it.qs = proNum(f.qs);
        it.min = proNum(f.min);
        it.b = String(f.b).trim();
    }
    it.oldP = proNum(f.oldP) > 0 ? proNum(f.oldP) : 0;
    it.desc = String(f.desc || '').trim();
    it.imgs = finalImgs.slice(1);
    it.img = finalImgs[0] || it.img || '';
    save();
    proQueueSafe({ t: isNew ? 'item-ins' : 'item-upd', lid: it.lid, catLid: db[ci].lid });
    toast('✅ تم حفظ المنتج');
    proAdminState.view = 'products';
    proAdminState.form = null;
    proAdminRender();
}
function proProductDelete(ci, ii) {
    const it = db[ci] && db[ci].items[ii];
    if (!it) return;
    if (!confirm('حذف «' + it.n + '»؟ يمكن استعادته من سلة المحذوفات.')) return;
    const removed = db[ci].items.splice(ii, 1)[0];
    trashPush({ type: 'item', lid: removed.lid, cid: removed.cid || null, name: removed.n, catName: db[ci].name, catLid: db[ci].lid, snapshot: removed });
    proQueueSafe({ t: 'item-del', lid: removed.lid, cid: removed.cid });
    logAction('حذف صنف', removed.n);
    save();
    toast('🗑️ تم الحذف — يمكنك استعادته من سلة المحذوفات');
    proAdminState.view = 'products';
    proAdminState.form = null;
    proAdminRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  7) الأقسام
// ═══════════════════════════════════════════════════════════════════════════
function proViewCategories() {
    const rows = (db || []).map((c, ci) => {
        const n = (c.items || []).length;
        const avail = (c.items || []).filter(it => getQs(it) > 0).length;
        return '<div style="display:flex;align-items:center;gap:11px;padding:11px 2px;border-bottom:1px solid var(--border)">' +
            '<div style="width:46px;height:46px;border-radius:50%;overflow:hidden;background:var(--bg-soft);display:grid;place-items:center;font-size:1.2rem;flex-shrink:0">' +
                (c.image ? '<img src="' + esc(c.image) + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">' : (c.icon || '📦')) + '</div>' +
            '<div style="flex:1;min-width:0">' +
                '<div style="font-weight:800;font-size:.88rem">' + esc(c.name) + '</div>' +
                '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + n + ' منتج · ' + avail + ' متاح</div>' +
            '</div>' +
            '<div style="display:flex;gap:5px">' +
                '<button class="mini-btn" title="أعلى" onclick="proCatMove(' + ci + ',-1)" ' + (ci === 0 ? 'disabled style="opacity:.35"' : '') + '>↑</button>' +
                '<button class="mini-btn" title="أسفل" onclick="proCatMove(' + ci + ',1)" ' + (ci === db.length - 1 ? 'disabled style="opacity:.35"' : '') + '>↓</button>' +
                '<button class="mini-btn" title="صورة" onclick="proCatPickImage(' + ci + ')">🖼️</button>' +
                '<button class="mini-btn" title="تعديل" onclick="proCatRename(' + ci + ')">✏️</button>' +
                '<button class="mini-btn" title="حذف" style="color:var(--danger)" onclick="proCatDelete(' + ci + ')">🗑️</button>' +
            '</div>' +
        '</div>';
    }).join('') || '<div style="padding:26px;text-align:center;color:var(--text-muted);font-weight:700">لا توجد أقسام بعد</div>';

    return '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>📂 ' + (db || []).length + ' قسم</h3>' +
            '<button class="btn btn-primary" style="padding:8px 15px;font-size:.82rem" onclick="proCatAdd()">➕ قسم جديد</button></div>' +
        '<div style="font-size:.78rem;color:var(--text-muted);font-weight:700;margin-bottom:8px">ترتيب الأقسام هنا هو نفسه ترتيب ظهورها للعميل في المتجر.</div>' +
        rows +
    '</div>';
}
function proCatAdd() {
    const name = prompt('اسم القسم الجديد:');
    if (!name || !name.trim()) return;
    db.push({ name: name.trim(), lid: genLid(), items: [] });
    save();
    proQueueSafe({ t: 'cat-ins', lid: db[db.length - 1].lid, so: db.length - 1 });
    logAction('إضافة قسم', name.trim());
    toast('✅ أُضيف القسم');
    proAdminRender();
}
function proCatRename(ci) {
    const c = db[ci];
    if (!c) return;
    const name = prompt('اسم القسم:', c.name);
    if (!name || !name.trim() || name.trim() === c.name) return;
    c.name = name.trim();
    save();
    proQueueSafe({ t: 'cat-upd', lid: c.lid });
    toast('✅ تم تحديث اسم القسم');
    proAdminRender();
}
function proCatMove(ci, dir) {
    const to = ci + dir;
    if (to < 0 || to >= db.length) return;
    const tmp = db[ci]; db[ci] = db[to]; db[to] = tmp;
    save();
    // ترتيب السحابة يُحدَّث مباشرة (لا يعتمد على الطابور لأنه لا يحمل sort_order)
    if (!proPreview && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
        db.forEach((c, i) => { if (c.cid) sb.from('categories').update({ sort_order: i }).eq('id', c.cid).then(() => {}, () => {}); });
    }
    proAdminRender();
}
function proCatPickImage(ci) {
    const c = db[ci];
    if (!c) return;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const max = 400;
                const scale = Math.min(max / img.width, max / img.height, 1);
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                const data = cv.toDataURL('image/jpeg', 0.8);
                proUploadImage(data, 'cat_' + (c.cid || c.lid)).then(url => {
                    c.image = url;
                    save();
                    if (!proPreview && c.cid && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
                        sb.from('categories').update({ image_url: url }).eq('id', c.cid).then(() => {}, () => {});
                    }
                    toast('✅ تم تحديث صورة القسم');
                    proAdminRender();
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };
    inp.click();
}
function proCatDelete(ci) {
    const c = db[ci];
    if (!c) return;
    if ((c.items || []).length > 0 && !confirm('القسم «' + c.name + '» فيه ' + c.items.length + ' منتج. سيُحذف القسم وتُنقل منتجاته إلى أول قسم آخر. متابعة؟')) return;
    else if ((c.items || []).length === 0 && !confirm('حذف القسم «' + c.name + '»؟')) return;
    const target = db.filter((_, i) => i !== ci)[0];
    if (c.items.length && !target) return toast('⚠️ لا يمكن حذف القسم الأخير وفيه منتجات');
    if (c.items.length) target.items = target.items.concat(c.items);
    db.splice(ci, 1);
    if (c.cid) proQueueSafe({ t: 'cat-del', lid: c.lid, cid: c.cid });
    save();
    toast('🗑️ تم حذف القسم');
    proAdminRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  8) البنرات
// ═══════════════════════════════════════════════════════════════════════════
async function proLoadBanners() {
    if (typeof cloudReady === 'function' && cloudReady() && !proPreview) {
        try {
            const { data, error } = await sb.from('banners').select('*').is('deleted_at', null).order('sort_order');
            if (!error && Array.isArray(data)) { proCacheBanners(data); return; }
        } catch (e) {}
    }
    if (!proBanners.length) proBanners = proLocalBanners();
}
function proBannerPersistLocal() {
    try { localStorage.setItem('al_sayed_banners', JSON.stringify(proBanners)); } catch (e) {}
}
function proViewBanners() {
    const rows = proBanners.map((b, i) =>
        '<div style="display:flex;align-items:center;gap:11px;padding:11px 2px;border-bottom:1px solid var(--border)">' +
            '<div style="width:82px;height:46px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,var(--primary),var(--accent));display:grid;place-items:center;color:#fff;font-size:1.3rem;flex-shrink:0">' +
                (b.image_url ? '<img src="' + esc(b.image_url) + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">' : (b.emoji || '🖼️')) + '</div>' +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(b.title || '(بلا عنوان)') + '</div>' +
                '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(b.subtitle || '') + '</div></div>' +
            '<label class="pro-switch"><input type="checkbox" ' + (b.active !== false ? 'checked' : '') + ' onchange="proBannerToggle(' + i + ',this.checked)"><span class="pro-switch-track"></span></label>' +
            '<div style="display:flex;gap:5px">' +
                '<button class="mini-btn" onclick="proBannerMove(' + i + ',-1)" ' + (i === 0 ? 'disabled style="opacity:.35"' : '') + '>↑</button>' +
                '<button class="mini-btn" onclick="proBannerMove(' + i + ',1)" ' + (i === proBanners.length - 1 ? 'disabled style="opacity:.35"' : '') + '>↓</button>' +
                '<button class="mini-btn" onclick="proBannerEdit(' + i + ')">✏️</button>' +
                '<button class="mini-btn" style="color:var(--danger)" onclick="proBannerDelete(' + i + ')">🗑️</button>' +
            '</div>' +
        '</div>').join('') ||
        '<div style="padding:26px;text-align:center;color:var(--text-muted);font-weight:700;font-size:.86rem">لا توجد بنرات — سيظهر بنر افتراضي أنيق في الصفحة الرئيسية</div>';

    const editing = proAdminState.editing && proAdminState.editing.bannerIdx !== undefined;
    const form = editing ? proBannerFormHtml() : '';
    return '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>🖼️ بنرات الصفحة الرئيسية</h3>' +
            '<button class="btn btn-primary" style="padding:8px 15px;font-size:.82rem" onclick="proBannerNew()">➕ بنر جديد</button></div>' +
        '<div style="font-size:.78rem;color:var(--text-muted);font-weight:700;margin-bottom:8px">تظهر هذه البنرات كسلايدر متحرك أعلى الصفحة الرئيسية للعميل.</div>' +
        rows +
    '</div>' + form;
}
function proBannerFormHtml() {
    const f = proAdminState.form || {};
    const linkTypes = [['category', 'قسم'], ['product', 'منتج'], ['url', 'رابط خارجي'], ['none', 'بدون رابط']];
    const opts = linkTypes.map(t => '<option value="' + t[0] + '"' + (f.link_type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('');
    return '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>' + (f.id ? '✏️ تعديل بنر' : '➕ بنر جديد') + '</h3></div>' +
        '<div class="pro-choice-grid">' +
            '<div class="form-group"><label>العنوان *</label><input type="text" value="' + esc(f.title || '') + '" oninput="proAdminState.form.title=this.value" placeholder="عروض العودة للمدارس"></div>' +
            '<div class="form-group"><label>العنوان الفرعي</label><input type="text" value="' + esc(f.subtitle || '') + '" oninput="proAdminState.form.subtitle=this.value" placeholder="خصومات حتى 30%"></div>' +
        '</div>' +
        '<div class="pro-choice-grid" style="grid-template-columns:1fr 1fr 1fr">' +
            '<div class="form-group"><label>نص الزر</label><input type="text" value="' + esc(f.cta_text || '') + '" oninput="proAdminState.form.cta_text=this.value" placeholder="تسوّق الآن"></div>' +
            '<div class="form-group"><label>إيموجي</label><input type="text" value="' + esc(f.emoji || '') + '" oninput="proAdminState.form.emoji=this.value" placeholder="🎒"></div>' +
            '<div class="form-group"><label>نوع الرابط</label><select onchange="proAdminState.form.link_type=this.value">' + opts + '</select></div>' +
        '</div>' +
        '<div class="form-group"><label>قيمة الرابط (رقم القسم أو المنتج أو رابط)</label><input type="text" value="' + esc(f.link_value || '') + '" oninput="proAdminState.form.link_value=this.value" style="direction:ltr;text-align:left"></div>' +
        '<div class="form-group"><label>صورة الخلفية (اختياري)</label>' +
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                (f.image_url ? '<div class="pro-img-tile" style="width:120px;height:64px"><img src="' + esc(f.image_url) + '" alt=""></div>' : '') +
                '<label class="pro-img-add" style="width:120px;height:64px"><input type="file" accept="image/*" style="display:none" onchange="proBannerImgPick(event)"><span>＋</span><span>صورة</span></label>' +
                (f.image_url ? '<button class="btn btn-ghost" style="font-size:.78rem" onclick="proAdminState.form.image_url=\'\';proAdminRender()">حذف الصورة</button>' : '') +
            '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">' +
            '<button class="btn btn-primary" style="padding:11px 22px" onclick="proBannerSave()">💾 حفظ البنر</button>' +
            '<button class="btn btn-outline" style="padding:11px 16px" onclick="proAdminState.editing=null;proAdminState.form=null;proAdminRender()">إلغاء</button>' +
        '</div>' +
    '</div>';
}
function proBannerNew() {
    proAdminState.editing = { bannerIdx: proBanners.length, isNew: true };
    proAdminState.form = { title: '', subtitle: '', image_url: '', emoji: '', cta_text: 'تسوّق الآن', link_type: 'none', link_value: '', active: true };
    proAdminRender();
}
function proBannerEdit(i) {
    const b = proBanners[i];
    proAdminState.editing = { bannerIdx: i, isNew: false };
    proAdminState.form = Object.assign({}, b);
    proAdminRender();
}
function proBannerImgPick(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const max = 1400;
            const scale = Math.min(max / img.width, max / img.height, 1);
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            proUploadImage(cv.toDataURL('image/jpeg', 0.8), 'banner_' + Date.now()).then(url => {
                proAdminState.form.image_url = url;
                proAdminRender();
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
async function proBannerSave() {
    const f = proAdminState.form;
    if (!f || !String(f.title || '').trim()) return toast('✍️ اكتب عنوان البنر');
    const i = proAdminState.editing.bannerIdx;
    const rec = {
        title: String(f.title).trim(), subtitle: String(f.subtitle || '').trim(),
        image_url: f.image_url || '', emoji: f.emoji || '', cta_text: f.cta_text || 'تسوّق الآن',
        link_type: f.link_type || 'none', link_value: f.link_value || '',
        sort_order: i, active: f.active !== false
    };
    if (!proPreview && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
        try {
            if (proAdminState.editing.isNew) {
                const { data, error } = await sb.from('banners').insert(rec).select().single();
                if (error) throw error;
                rec.id = data.id;
            } else if (f.id) {
                const { error } = await sb.from('banners').update(rec).eq('id', f.id);
                if (error) throw error;
                rec.id = f.id;
            }
        } catch (e) { toast('⚠️ لم يُحفظ على السحابة: ' + ((e && e.message) || 'تحقّق من تنفيذ ترقية قاعدة البيانات')); }
    }
    if (proAdminState.editing.isNew) proBanners.push(rec);
    else proBanners[i] = Object.assign({}, proBanners[i], rec);
    proBannerPersistLocal();
    proAdminState.editing = null; proAdminState.form = null;
    toast('✅ تم حفظ البنر');
    proAdminRender();
}
function proBannerDelete(i) {
    const b = proBanners[i];
    if (!b || !confirm('حذف البنر «' + (b.title || '') + '»؟')) return;
    if (!proPreview && b.id && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
        sb.from('banners').update({ deleted_at: new Date().toISOString() }).eq('id', b.id).then(() => {}, () => {});
    }
    proBanners.splice(i, 1);
    proBannerPersistLocal();
    toast('🗑️ تم حذف البنر');
    proAdminRender();
}
function proBannerToggle(i, on) {
    proBanners[i].active = !!on;
    proBannerPersistLocal();
    if (!proPreview && proBanners[i].id && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
        sb.from('banners').update({ active: !!on }).eq('id', proBanners[i].id).then(() => {}, () => {});
    }
    toast(on ? '✅ البنر ظاهر الآن' : '⏸️ أُخفي البنر');
}
function proBannerMove(i, dir) {
    const to = i + dir;
    if (to < 0 || to >= proBanners.length) return;
    const t = proBanners[i]; proBanners[i] = proBanners[to]; proBanners[to] = t;
    proBanners.forEach((b, k) => {
        b.sort_order = k;
        if (!proPreview && b.id && typeof cloudReady === 'function' && cloudReady() && sessionRole === 'admin') {
            sb.from('banners').update({ sort_order: k }).eq('id', b.id).then(() => {}, () => {});
        }
    });
    proBannerPersistLocal();
    proAdminRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  9) العملاء والصلاحيات
// ═══════════════════════════════════════════════════════════════════════════
let proCustomersCache = null;
async function proLoadCustomers() {
    if (proCustomersCache) return;
    if (typeof cloudReady !== 'function' || !cloudReady()) { proCustomersCache = []; return; }
    try {
        const { data } = await sb.from('profiles').select('*').order('created_at');
        proCustomersCache = data || [];
    } catch (e) { proCustomersCache = []; }
    if (proAdminState.view === 'customers') {
        const c = document.getElementById('proAdminContent');
        if (c) c.innerHTML = proViewCustomers();
    }
}
function proViewCustomers() {
    const list = proCustomersCache || [];
    const roleNames = { admin: '🛡️ مدير', worker: '👷 عامل', customer: '👤 عميل' };
    const counts = {
        admin: list.filter(u => u.role === 'admin').length,
        worker: list.filter(u => u.role === 'worker').length,
        customer: list.filter(u => u.role === 'customer').length
    };
    const rows = list.map(u =>
        '<div style="display:flex;align-items:center;gap:11px;padding:10px 2px;border-bottom:1px solid var(--border)">' +
            '<div style="width:38px;height:38px;border-radius:50%;background:var(--bg-soft);display:grid;place-items:center;font-size:1rem;flex-shrink:0">' + (u.role === 'admin' ? '🛡️' : u.role === 'worker' ? '👷' : '👤') + '</div>' +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.85rem">' + esc(u.display_name || u.username) + '</div>' +
            '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">@' + esc(u.username) + '</div></div>' +
            '<select onchange="proChangeRole(\'' + u.id + '\',this.value)" style="padding:6px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg-card);font-family:inherit;font-weight:800;font-size:.78rem">' +
                ['admin', 'worker', 'customer'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + roleNames[r] + '</option>').join('') +
            '</select>' +
        '</div>').join('') || '<div style="padding:24px;text-align:center;color:var(--text-muted);font-weight:700;font-size:.85rem">' +
            (typeof cloudReady === 'function' && cloudReady() ? 'لا توجد حسابات بعد' : 'قائمة الحسابات تحتاج اتصالًا بالسحابة') + '</div>';

    const permKeys = [['stock', '📦 صفحة المخزن'], ['add', '➕ إضافة'], ['del', '✏️ تعديل وحذف'], ['dash', '📊 لوحة التحكم'], ['history', '📋 سجل الطلبات'], ['exp', '📥 تصدير'], ['invoice', '🧾 إنشاء فاتورة']];
    const permBlock = ['worker', 'customer'].map(role =>
        '<div style="margin-bottom:12px">' +
            '<div style="font-weight:900;font-size:.86rem;margin-bottom:7px">' + (role === 'worker' ? '👷 صلاحيات العامل' : '👤 صلاحيات العميل') + ' (' + counts[role] + ')</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:7px">' +
                permKeys.map(k =>
                    '<label class="pro-pill" style="cursor:pointer;' + (effectivePerm(role, k[0]) ? 'background:var(--primary);color:#fff;border-color:var(--primary)' : '') + '">' +
                        '<input type="checkbox" ' + (effectivePerm(role, k[0]) ? 'checked' : '') + ' onchange="setRolePerm(\'' + role + '\',\'' + k[0] + '\',this.checked);setTimeout(proAdminRender,120)" style="width:14px;height:14px">' +
                        k[1] +
                    '</label>').join('') +
            '</div>' +
        '</div>').join('');

    return '<div class="pro-kpi-grid" style="grid-template-columns:repeat(3,1fr)">' +
        '<div class="pro-kpi-card"><div class="pro-kpi-lbl">🛡️ مديرون</div><div class="pro-kpi-val">' + counts.admin + '</div></div>' +
        '<div class="pro-kpi-card"><div class="pro-kpi-lbl">👷 عاملون</div><div class="pro-kpi-val">' + counts.worker + '</div></div>' +
        '<div class="pro-kpi-card"><div class="pro-kpi-lbl">👤 عملاء</div><div class="pro-kpi-val">' + counts.customer + '</div></div>' +
    '</div>' +
    '<div class="pro-card"><div class="pro-card-head"><h3>👥 الحسابات (' + list.length + ')</h3></div>' + rows + '</div>' +
    '<div class="pro-card"><div class="pro-card-head"><h3>🔐 الصلاحيات</h3></div>' + permBlock + '</div>';
}
async function proChangeRole(id, role) {
    if (proPreview) return toast('🔍 وضع المعاينة — لا يُحفظ تغيير الصلاحيات');
    if (typeof cloudReady !== 'function' || !cloudReady()) return toast('⚠️ يحتاج اتصالًا بالسحابة');
    const { error } = await sb.from('profiles').update({ role: role }).eq('id', id);
    if (error) return toast('❌ ' + (error.message || 'تعذّر التحديث'));
    if (proCustomersCache) proCustomersCache.forEach(u => { if (u.id === id) u.role = role; });
    toast('✅ تم تغيير الدور');
    logAction('تغيير دور مستخدم', role);
}

// ═══════════════════════════════════════════════════════════════════════════
//  10) إعدادات المتجر والهوية
// ═══════════════════════════════════════════════════════════════════════════
function proToggleStoreOpen() {
    settings.open = proIsOpen() ? '0' : '1';
    saveSettings();
    proSaveSettingsCloud(['store_open']);
    proApplyBranding();
    toast(proIsOpen() ? '✅ المتجر يستقبل الطلبات الآن' : '🌙 المتجر مغلق مؤقتًا');
    proAdminRender();
}
function proSaveSettingsCloud(keys) {
    if (proPreview) return;
    if (typeof cloudReady !== 'function' || !cloudReady() || sessionRole !== 'admin') return;
    const map = { store: 'store_name', address: 'address', phone: 'phone', footer: 'footer', tax: 'tax_pct',
                  desc: 'store_desc', returnDays: 'return_days', returnNote: 'return_note',
                  shipping: 'shipping_fee', freeShip: 'free_shipping_over',
                  couponCode: 'coupon_code', couponPct: 'coupon_pct',
                  open: 'store_open', announce: 'announce_text', logo: 'store_logo', brandColor: 'brand_color',
                  payVodafone: 'pay_vodafone', payInstapay: 'pay_instapay', payBank: 'pay_bank' };
    const rows = [];
    Object.keys(map).forEach(k => { if (!keys || keys.indexOf(map[k]) !== -1) rows.push({ key: map[k], value: String(settings[k] === undefined ? '' : settings[k]) }); });
    if (!rows.length) return;
    Promise.resolve(sb.from('settings').upsert(rows)).then(r => {
        if (r && r.error) toast('⚠️ لم تُحفظ الإعدادات على السحابة: ' + r.error.message);
    }).catch(() => {});
}
function proSetSetting(k, v) {
    settings[k] = v;
}
function proViewSettings() {
    const swatch = ['', '#0d4f6c', '#0f766e', '#7c3aed', '#b91c1c', '#1f2937', '#c2410c'].map(c =>
        '<button class="pro-swatch' + (String(settings.brandColor || '') === c ? ' active' : '') + '" ' +
        'style="background:' + (c || 'linear-gradient(135deg,#0d4f6c,#00c9a7)') + '" onclick="proSetSetting(\'brandColor\',\'' + c + '\');proApplyBranding();proAdminRender()" title="' + (c || 'افتراضي') + '"></button>').join('');

    return '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>🏪 حالة المتجر</h3></div>' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--bg-soft);padding:13px;border-radius:13px">' +
            '<span style="font-size:1.6rem">' + (proIsOpen() ? '🟢' : '🌙') + '</span>' +
            '<div style="flex:1;min-width:150px"><div style="font-weight:900;font-size:.9rem">' + (proIsOpen() ? 'المتجر مفتوح ويستقبل الطلبات' : 'المتجر مغلق مؤقتًا') + '</div>' +
            '<div style="font-size:.75rem;color:var(--text-muted);font-weight:700">' + (proIsOpen() ? 'الزوار يستطيعون إتمام الطلبات الآن.' : 'الزوار يرون المنتجات لكن لا يمكنهم إتمام الطلب.') + '</div></div>' +
            '<label class="pro-switch"><input type="checkbox" ' + (proIsOpen() ? 'checked' : '') + ' onchange="proToggleStoreOpen()"><span class="pro-switch-track"></span></label>' +
        '</div>' +
    '</div>' +

    '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>🎨 هوية المتجر</h3></div>' +
        '<div class="pro-choice-grid">' +
            '<div class="form-group"><label>اسم المتجر</label><input type="text" value="' + esc(settings.store || '') + '" oninput="proSetSetting(\'store\',this.value)"></div>' +
            '<div class="form-group"><label>رقم الهاتف / واتساب</label><input type="tel" value="' + esc(settings.phone || '') + '" oninput="proSetSetting(\'phone\',this.value)" style="direction:ltr;text-align:left"></div>' +
        '</div>' +
        '<div class="form-group"><label>وصف المتجر (يظهر في الرئيسية والتذييل)</label><textarea rows="2" oninput="proSetSetting(\'desc\',this.value)" style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:600;resize:vertical">' + esc(settings.desc || '') + '</textarea></div>' +
        '<div class="form-group"><label>📣 شريط الإعلان العلوي (اتركه فارغًا لإخفائه)</label><input type="text" value="' + esc(settings.announce || '') + '" oninput="proSetSetting(\'announce\',this.value)" placeholder="مثال: شحن مجاني لأي طلب فوق 300 ج.م"></div>' +
        '<div class="form-group"><label>الشعار</label>' +
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                (settings.logo ? '<img src="' + esc(settings.logo) + '" style="width:52px;height:52px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid var(--border);padding:3px">' : '') +
                '<label class="pro-img-add" style="width:52px;height:52px;border-radius:12px"><input type="file" accept="image/*" style="display:none" onchange="proLogoPick(event)"><span>＋</span></label>' +
                (settings.logo ? '<button class="btn btn-ghost" style="font-size:.78rem" onclick="proSetSetting(\'logo\',\'\');proAdminRender()">حذف</button>' : '') +
            '</div>' +
        '</div>' +
        '<div class="form-group"><label>لون الهوية</label><div class="pro-swatches">' + swatch +
            '<input type="color" value="' + (/^#[0-9a-f]{6}$/i.test(settings.brandColor || '') ? settings.brandColor : '#0d4f6c') + '" onchange="proSetSetting(\'brandColor\',this.value);proApplyBranding();proAdminRender()" style="width:44px;height:38px;border-radius:10px;border:1px solid var(--border);cursor:pointer;background:none">' +
        '</div></div>' +
        '<div class="form-group"><label>العنوان</label><input type="text" value="' + esc(settings.address || '') + '" oninput="proSetSetting(\'address\',this.value)"></div>' +
    '</div>' +

    '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>💳 طرق الدفع</h3></div>' +
        '<div class="pro-choice-grid">' +
            '<div class="form-group"><label>📱 فودافون كاش</label><input type="text" value="' + esc(settings.payVodafone || '') + '" oninput="proSetSetting(\'payVodafone\',this.value)" placeholder="010xxxxxxxx" style="direction:ltr;text-align:left"></div>' +
            '<div class="form-group"><label>⚡ إنستاباي</label><input type="text" value="' + esc(settings.payInstapay || '') + '" oninput="proSetSetting(\'payInstapay\',this.value)" placeholder="name@instapay" style="direction:ltr;text-align:left"></div>' +
        '</div>' +
        '<div class="form-group"><label>🏦 تحويل بنكي</label><textarea rows="2" oninput="proSetSetting(\'payBank\',this.value)" placeholder="اسم البنك · رقم الحساب · اسم صاحب الحساب" style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:600;resize:vertical">' + esc(settings.payBank || '') + '</textarea></div>' +
        '<div style="font-size:.76rem;color:var(--text-muted);font-weight:700">تظهر هذه البيانات للعميل في خطوة الدفع مع إمكانية إرفاق صورة الإيصال.</div>' +
    '</div>' +

    '<div class="pro-card">' +
        '<div class="pro-card-head"><h3>🚚 الشحن والخصومات والضريبة</h3></div>' +
        '<div class="pro-choice-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">' +
            '<div class="form-group"><label>مصاريف الشحن</label><input type="number" value="' + proNum(settings.shipping) + '" oninput="proSetSetting(\'shipping\',this.value)" min="0"></div>' +
            '<div class="form-group"><label>شحن مجاني فوق</label><input type="number" value="' + proNum(settings.freeShip) + '" oninput="proSetSetting(\'freeShip\',this.value)" min="0"></div>' +
            '<div class="form-group"><label>الضريبة %</label><input type="number" value="' + proNum(settings.tax) + '" oninput="proSetSetting(\'tax\',this.value)" min="0"></div>' +
            '<div class="form-group"><label>أيام الإرجاع</label><input type="number" value="' + proNum(settings.returnDays) + '" oninput="proSetSetting(\'returnDays\',this.value)" min="0"></div>' +
        '</div>' +
        '<div class="pro-choice-grid">' +
            '<div class="form-group"><label>كود الكوبون</label><input type="text" value="' + esc(settings.couponCode || '') + '" oninput="proSetSetting(\'couponCode\',this.value)" style="direction:ltr;text-align:left"></div>' +
            '<div class="form-group"><label>نسبة الكوبون %</label><input type="number" value="' + proNum(settings.couponPct) + '" oninput="proSetSetting(\'couponPct\',this.value)" min="0" max="100"></div>' +
        '</div>' +
    '</div>' +

    '<div style="display:flex;gap:8px;flex-wrap:wrap;position:sticky;bottom:0;background:var(--bg-body);padding:12px 0;border-top:1px solid var(--border)">' +
        '<button class="btn btn-primary" style="padding:13px 30px" onclick="proSaveSettingsForm()">💾 حفظ كل الإعدادات</button>' +
        '<button class="btn btn-outline" style="padding:13px 18px" onclick="openSyncStatus()">☁️ حالة المزامنة</button>' +
        '<button class="btn btn-outline" style="padding:13px 18px" onclick="openTrash()">🗑️ سلة المحذوفات</button>' +
        '<button class="btn btn-outline" style="padding:13px 18px" onclick="manualBackup()">💾 نسخة احتياطية</button>' +
    '</div>';
}
function proLogoPick(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const max = 320;
            const scale = Math.min(max / img.width, max / img.height, 1);
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            proUploadImage(cv.toDataURL('image/png'), 'logo_' + Date.now()).then(url => {
                settings.logo = url;
                saveSettings();
                proSaveSettingsCloud(['store_logo']);
                proAdminRender();
                toast('✅ تم تحديث الشعار');
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
function proSaveSettingsForm() {
    saveSettings();
    proSaveSettingsCloud();
    proApplyBranding();
    toast('✅ تم حفظ الإعدادات' + (proPreview ? ' (وضع المعاينة — محليًا فقط)' : ' وستظهر على كل الأجهزة'));
    logAction('تحديث إعدادات المتجر', 'من لوحة التحكم الجديدة');
    proAdminRender();
}

// ═══════════════════════════════════════════════════════════════════════════
//  11) وضع المعاينة (لتجربة اللوحة هنا قبل أي نشر)
// ═══════════════════════════════════════════════════════════════════════════
function proInitPreviewMode() {
    const params = new URLSearchParams(location.search || '');
    if (!params.has('preview')) return false;
    proPreview = true;
    sessionUser = 'مدير (معاينة)';
    sessionRole = 'admin';
    try { applyRoleUI(); } catch (e) {}
    const what = params.get('preview') || 'admin';
    setTimeout(() => {
        try {
            if (what === 'store') { setView('home'); }
            else if (what === 'shop') { setView('shop'); }
            else if (what === 'checkout') { setView('shop'); setTimeout(proOpenCheckout, 400); }
            else { proOpenAdmin('overview'); }
        } catch (e) {}
    }, 700);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  12) التهيئة
// ═══════════════════════════════════════════════════════════════════════════
function proInitAdmin() {
    try {
        proAdminSidebarCollapsed = localStorage.getItem('al_sayed_admin_collapsed') === '1';
    } catch (e) {}
    // زر اللوحة في قائمة الهامبرجر
    const burgerDash = document.getElementById('burger-dash');
    if (burgerDash) {
        burgerDash.textContent = '🖥️ لوحة التحكم الاحترافية';
        burgerDash.setAttribute('onclick', 'proOpenAdmin(\'overview\');closeBurger()');
    }
    proSyncHeaderAdminBtn();
    setInterval(proRefreshNewOrdersBadge, 20000);
    proInitPreviewMode();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', proInitAdmin);
} else {
    proInitAdmin();
}

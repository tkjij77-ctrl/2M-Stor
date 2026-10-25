// ═══════════════════════════════════════════════════════════════════════════
//  🏪 pro-store.js — واجهة المتجر الاحترافية + تثبيت التطبيق + تيليجرام
//
//  ماذا يضيف هذا الملف فوق التطبيق القائم:
//   • شريط إعلان علوي + سلايدر بنرات + دوائر الأقسام + صفوف «عروض/الأكثر مبيعًا»
//   • شارة الخصم والسعر المشطوب على بطاقات المنتجات (بلا تكرار منطق العرض)
//   • معرض صور حقيقي لصفحة المنتج + الوصف + شريط شراء سفلي للجوال
//   • إشعار سلة سفلي أنيق
//   • بطاقة تثبيت ذكية: أندرويد/كمبيوتر بضغطة · آيفون بشرح خطوات · تيليجرام
//   • تهيئة Telegram Mini App (رجوع أصلي · اهتزاز · هوية · اسم العميل)
//
//  قيد التصميم: لا نُعيد كتابة دوال العرض القائمة — نُغلّفها (wrap) ونُحسّن
//  ناتجها في الـDOM، حتى لا تنحرف نسختان من نفس منطق الأسعار والمخزون.
// ═══════════════════════════════════════════════════════════════════════════

// ── أدوات صغيرة ────────────────────────────────────────────────────────────
function proNum(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

/** صور المنتج: الغلاف أولًا ثم بقية المعرض (بلا تكرار) */
function proItemImages(it) {
    const out = [];
    const push = (u) => { if (u && typeof u === 'string' && out.indexOf(u) === -1) out.push(u); };
    if (it && it.img) push(it.img);
    if (it && it.imgUrl) push(it.imgUrl);
    if (it && Array.isArray(it.imgs)) it.imgs.forEach(push);
    return out;
}
function proOldPrice(it) { return it ? proNum(it.oldP) : 0; }
function proDiscountPct(it) {
    const oldP = proOldPrice(it), cur = itemPrice(it || {});
    if (oldP <= 0 || cur <= 0 || oldP <= cur) return 0;
    return Math.round((1 - cur / oldP) * 100);
}
function proIsOpen() { return String(settings.open === undefined ? '1' : settings.open) !== '0'; }

// ── حالة الواجهة ───────────────────────────────────────────────────────────
let proBanners = [];
let proBannerIdx = 0;
let proBannerTimer = null;
let proCfgLoaded = false;
let proOrigRenderHome = null;
let proOrigOpenProductDetail = null;
let proOrigAddToCart = null;
let proOrigRenderCart = null;
let proToastTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
//  1) تحميل إعدادات المتجر والبنرات (تعمل أوفلاين من الكاش المحلي)
// ═══════════════════════════════════════════════════════════════════════════
function proCacheBanners(list) {
    proBanners = (list || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    try { localStorage.setItem('al_sayed_banners', JSON.stringify(proBanners)); } catch (e) {}
}
function proLocalBanners() {
    try { return JSON.parse(localStorage.getItem('al_sayed_banners') || '[]'); } catch (e) { return []; }
}
async function proLoadStoreConfig(force) {
    if (proCfgLoaded && !force) return;
    proCfgLoaded = true;
    proBanners = proLocalBanners();
    if (typeof cloudReady !== 'function' || !cloudReady()) { proApplyBranding(); return; }
    try {
        const [bR, sR] = await Promise.all([
            sb.from('banners').select('*').is('deleted_at', null).order('sort_order'),
            sb.from('settings').select('key,value')
        ]);
        if (bR && !bR.error && Array.isArray(bR.data)) proCacheBanners(bR.data.filter(b => b.active !== false));
        if (sR && !sR.error && Array.isArray(sR.data)) {
            // نطبّق فقط مفاتيح المتجر — لا نلمس بقية الإعدادات (mergeSettings مسؤولة عنها)
            const map = { store_open: 'open', announce_text: 'announce', store_logo: 'logo',
                          brand_color: 'brandColor', pay_vodafone: 'payVodafone',
                          pay_instapay: 'payInstapay', pay_bank: 'payBank' };
            sR.data.forEach(r => { if (map[r.key]) settings[map[r.key]] = r.value; });
            saveSettings();
        }
    } catch (e) { /* أوفلاين — نكمل بالكاش */ }
    proApplyBranding();
}

// ═══════════════════════════════════════════════════════════════════════════
//  2) هوية المتجر: اللون · الشريط العلوي · الشعار · حالة الفتح
// ═══════════════════════════════════════════════════════════════════════════
function proApplyBranding() {
    // لون الهوية: يُحسب منه تدرّج كامل حتى لا ينكسر التباين في الوضع الليلي
    const brand = String(settings.brandColor || '').trim();
    const root = document.documentElement;
    if (/^#[0-9a-f]{6}$/i.test(brand)) {
        root.style.setProperty('--primary', brand);
        root.style.setProperty('--primary-dark', brand);
        root.style.setProperty('--btn-bg', brand);
        root.style.setProperty('--toast-bg', brand);
    } else {
        ['--primary', '--primary-dark', '--btn-bg', '--toast-bg'].forEach(v => root.style.removeProperty(v));
    }

    // شريط الإعلان العلوي
    let bar = document.getElementById('proAnnBar');
    const text = String(settings.announce || '').trim();
    if (text) {
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'proAnnBar';
            bar.className = 'pro-ann-bar';
            document.body.appendChild(bar);
        }
        bar.textContent = '📣 ' + text;
        bar.classList.add('show');
        document.body.classList.add('has-ann');
    } else if (bar) {
        bar.classList.remove('show');
        document.body.classList.remove('has-ann');
    }
    // نُبلّغ الهيدر ليقيس ارتفاعه (الشريط يزحزحه لأسفل)
    const header = document.getElementById('appHeader');
    if (header && bar) {
        const h = bar.classList.contains('show') ? bar.offsetHeight : 0;
        root.style.setProperty('--ann-h', h + 'px');
        if (typeof measureHeader === 'function') measureHeader();
    }
    proSyncHeaderAdminBtn();
    proUpdateInstallCard();
}

/** زر «لوحة التحكم» في الهيدر + عدّاد الطلبات الجديدة */
function proSyncHeaderAdminBtn() {
    const actions = document.querySelector('header .header-actions');
    if (!actions) return;
    let btn = document.getElementById('proHdrAdmin');
    const isManager = typeof can === 'function' && (can('dash') || can('del') || can('stock'));
    if (!isManager) { if (btn) btn.remove(); return; }
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'proHdrAdmin';
        btn.className = 'pro-hdr-admin-btn';
        btn.type = 'button';
        btn.onclick = function () { proOpenAdmin('overview'); };
        btn.innerHTML = '🖥️ <span class="pro-hdr-lbl">لوحة التحكم</span><span class="pro-hdr-badge" id="proHdrBadge" style="display:none">0</span>';
        const burger = document.getElementById('burgerBtn');
        if (burger && burger.parentNode === actions) actions.insertBefore(btn, burger);
        else actions.appendChild(btn);
    }
    proRefreshNewOrdersBadge();
}
function proNewOrdersCount() {
    return (invoices || []).filter(inv => (inv.status || 'قيد المعالجة') === 'قيد المعالجة').length;
}
function proRefreshNewOrdersBadge() {
    const b = document.getElementById('proHdrBadge');
    const n = proNewOrdersCount();
    if (b) { b.textContent = n; b.style.display = n > 0 ? 'inline-grid' : 'none'; }
    const nav = document.querySelector('.pro-admin-link[data-view="orders"] .pro-admin-badge');
    if (nav) { nav.textContent = n; nav.style.display = n > 0 ? 'grid' : 'none'; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3) الصفحة الرئيسية = واجهة متجر حقيقية
// ═══════════════════════════════════════════════════════════════════════════
function proAllItems() {
    const out = [];
    (db || []).forEach((c, ci) => (c.items || []).forEach((it, ii) => out.push({ cat: c, ci: ci, it: it, ii: ii })));
    return out;
}
function proBestsellers(limit) {
    const sold = {};
    (invoices || []).forEach(inv => (inv.items || []).forEach(l => {
        if (!l || !l.name) return;
        sold[l.name] = (sold[l.name] || 0) + (l.qty || 0);
    }));
    const all = proAllItems().filter(x => getQs(x.it) > 0);
    all.sort((a, b) => (sold[b.it.n] || 0) - (sold[a.it.n] || 0) || getQs(b.it) - getQs(a.it));
    return all.slice(0, limit || 8);
}
function proOffers(limit) {
    const all = proAllItems().filter(x => proDiscountPct(x.it) > 0 && getQs(x.it) > 0);
    all.sort((a, b) => proDiscountPct(b.it) - proDiscountPct(a.it));
    return all.slice(0, limit || 8);
}

function proCardHtml(entry, opts) {
    const ci = entry.ci, ii = entry.ii, it = entry.it;
    const qs = getQs(it), pct = proDiscountPct(it), oldP = proOldPrice(it);
    const imgs = proItemImages(it);
    const img = imgs.length
        ? '<img src="' + esc(imgs[0]) + '" alt="" loading="lazy" decoding="async">'
        : '<span>📦</span>';
    const badges =
        (pct > 0 ? '<span class="pro-sale-badge">-' + pct + '%</span>' : '') +
        (imgs.length > 1 ? '<span style="position:absolute;bottom:8px;right:8px;z-index:2;background:rgba(0,0,0,.62);color:#fff;font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:999px">🖼️ ' + imgs.length + '</span>' : '');
    const priceRow = '<div class="shop-price">' + esc(it.p) + ' <span>ج.م</span>' +
        (oldP > itemPrice(it) ? '<span class="pro-old-price">' + fmt(oldP) + '</span>' : '') + '</div>';
    const favActive = isFav(ci, ii);
    const favBtn = (opts && opts.noFav) ? '' :
        '<button class="fav-btn ' + (favActive ? 'active' : '') + '" style="position:absolute;top:8px;left:8px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.95);cursor:pointer;font-size:.95rem;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:2" onclick="event.stopPropagation();toggleFav(' + ci + ',' + ii + ')">' + (favActive ? '❤️' : '🤍') + '</button>';
    return '<div class="shop-card" onclick="openProductDetail(' + ci + ',' + ii + ')">' +
        '<div class="shop-img" style="position:relative;overflow:hidden">' + favBtn + badges + img + '</div>' +
        '<div class="shop-body">' +
            '<div class="shop-name">' + esc(it.n) + '</div>' +
            priceRow +
            '<div class="shop-avail ' + (qs > 0 ? 'ok' : 'no') + '">' + availText(it) + '</div>' +
        '</div>' +
        '<button class="cart-add' + (qs <= 0 ? ' disabled' : '') + '" onclick="event.stopPropagation();addToCart(' + ci + ',' + ii + ')">🛒 + إضافة للسلة</button>' +
    '</div>';
}

function proRailHtml(title, icon, entries, linkView) {
    if (!entries.length) return '';
    return '<div class="pro-sec-head"><h2>' + icon + ' ' + esc(title) + '</h2>' +
        (linkView ? '<button class="pro-sec-more" onclick="setView(\'' + linkView + '\')">عرض الكل ←</button>' : '') +
        '</div><div class="pro-rail-track">' + entries.map(e => proCardHtml(e)).join('') + '</div>';
}

function proBannersHtml() {
    if (!proBanners.length) {
        // بنر افتراضي ذكي عند عدم وجود بنرات — لا يظهر فارغًا أبدًا
        const total = proAllItems().filter(x => getQs(x.it) > 0).length;
        return '<div class="pro-banner-sec"><div class="pro-banner-track">' +
            '<div class="pro-banner-slide" onclick="setView(\'shop\')">' +
                '<div class="pro-banner-overlay"></div>' +
                '<div class="pro-banner-content">' +
                    '<span class="pro-banner-tag">✨ ' + esc(settings.store || 'متجرنا') + '</span>' +
                    '<div class="pro-banner-title">كل ما تحتاجه في مكان واحد</div>' +
                    '<div class="pro-banner-sub">' + total + ' منتج متاح الآن · توصيل سريع لكل المحافظات</div>' +
                    '<button class="pro-banner-cta">تسوّق الآن ←</button>' +
                '</div>' +
                '<div class="pro-banner-art">🛍️</div>' +
            '</div></div></div>';
    }
    const slides = proBanners.map((b, i) => {
        const link = b.link_type === 'category' && b.link_value ? 'setView(\'shop\');selectCat(' + parseInt(b.link_value, 10) + ')' :
                     b.link_type === 'product' && b.link_value !== null ? 'setView(\'shop\');setTimeout(function(){openProductDetail(0,0)},150)' :
                     /^https?:/i.test(b.link_value || '') ? 'window.open(\'' + esc(b.link_value) + '\',\'_blank\')' :
                     'setView(\'shop\')';
        const bg = b.image_url
            ? '<img class="pro-banner-bg" src="' + esc(b.image_url) + '" alt="" loading="lazy">'
            : '';
        return '<div class="pro-banner-slide" data-idx="' + i + '" onclick="' + link + '">' +
            bg + '<div class="pro-banner-overlay"></div>' +
            '<div class="pro-banner-content">' +
                (b.cta_text ? '<span class="pro-banner-tag">' + esc(b.cta_text) + '</span>' : '') +
                '<div class="pro-banner-title">' + esc(b.title || '') + '</div>' +
                (b.subtitle ? '<div class="pro-banner-sub">' + esc(b.subtitle) + '</div>' : '') +
                '<button class="pro-banner-cta">تسوّق الآن ←</button>' +
            '</div>' +
            (b.emoji ? '<div class="pro-banner-art">' + esc(b.emoji) + '</div>' : '') +
        '</div>';
    }).join('');
    const dots = proBanners.length > 1
        ? '<div class="pro-banner-dots">' + proBanners.map((b, i) =>
            '<button class="pro-banner-dot' + (i === 0 ? ' active' : '') + '" onclick="event.stopPropagation();proBannerGo(' + i + ')"></button>').join('') + '</div>'
        : '';
    return '<div class="pro-banner-sec"><div class="pro-banner-track" id="proBannerTrack">' + slides + '</div>' + dots + '</div>';
}
function proBannerGo(idx) {
    const track = document.getElementById('proBannerTrack');
    if (!track) return;
    const slides = track.querySelectorAll('.pro-banner-slide');
    if (!slides.length) return;
    proBannerIdx = (idx + slides.length) % slides.length;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const target = slides[proBannerIdx];
    try {
        track.scrollTo({ left: rtl ? -(target.offsetLeft) : target.offsetLeft, behavior: 'smooth' });
    } catch (e) { }
    track.querySelectorAll('.pro-banner-dot').forEach((d, i) => d.classList.toggle('active', i === proBannerIdx));
}
function proBannersAutoStart() {
    if (proBannerTimer) clearInterval(proBannerTimer);
    if (proBanners.length < 2) return;
    proBannerTimer = setInterval(() => {
        if (document.hidden) return;
        proBannerGo(proBannerIdx + 1);
    }, 6000);
}

function proCatCirclesHtml() {
    if (!db || !db.length) return '';
    const items = db.map((c, i) => {
        const n = (c.items || []).filter(it => getQs(it) > 0).length;
        const inner = c.image
            ? '<img src="' + esc(c.image) + '" alt="" loading="lazy">'
            : (c.icon || '📦');
        return '<button class="pro-cat-item" onclick="setView(\'shop\');selectCat(' + i + ')">' +
            '<span class="pro-cat-ring">' + inner + '</span>' +
            '<span class="pro-cat-lbl">' + esc(c.name) + '</span>' +
            '<span class="pro-cat-cnt">' + n + ' منتج</span>' +
        '</button>';
    }).join('');
    return '<div class="pro-sec-head"><h2>📂 تسوّق حسب القسم</h2>' +
        '<button class="pro-sec-more" onclick="setView(\'shop\')">كل الأقسام ←</button></div>' +
        '<div class="pro-cat-circles">' + items + '</div>';
}

function proTrustHtml() {
    const shipFee = proNum(settings.shipping), freeOver = proNum(settings.freeShip);
    const shipTxt = freeOver > 0 ? ('شحن مجاني فوق ' + fmt(freeOver) + ' ج') : (shipFee > 0 ? (fmt(shipFee) + ' ج للشحن') : 'شحن مجاني');
    const retTxt = proNum(settings.returnDays) > 0 ? ('إرجاع خلال ' + proNum(settings.returnDays) + ' يوم') : 'سياسة إرجاع واضحة';
    return '<div class="pro-trust-row">' +
        '<div class="pro-trust-card"><span class="pro-trust-ic">🚚</span><div><b>توصيل سريع</b><small>' + esc(shipTxt) + '</small></div></div>' +
        '<div class="pro-trust-card"><span class="pro-trust-ic">💳</span><div><b>دفع مرن</b><small>عند الاستلام أو تحويل</small></div></div>' +
        '<div class="pro-trust-card"><span class="pro-trust-ic">🔄</span><div><b>إرجاع سهل</b><small>' + esc(retTxt) + '</small></div></div>' +
        '<div class="pro-trust-card"><span class="pro-trust-ic">💬</span><div><b>دعم مباشر</b><small>' + (settings.phone ? esc(settings.phone) : 'تواصل معنا') + '</small></div></div>' +
    '</div>';
}

function proRenderHome() {
    const hv = document.getElementById('homeView');
    if (!hv) return;
    if (!proIsOpen()) {
        proLoadStoreConfig();
    }
    const offers = proOffers(8);
    const best = proBestsellers(8);
    const newest = proAllItems().slice().sort((a, b) => {
        const ta = a.it._ts || '', tb = b.it._ts || '';
        return tb > ta ? 1 : (tb < ta ? -1 : 0);
    }).slice(0, 8);
    let byCat = '';
    (db || []).forEach((c, ci) => {
        const entries = (c.items || []).map((it, ii) => ({ cat: c, ci: ci, it: it, ii: ii })).filter(x => getQs(x.it) > 0).slice(0, 8);
        if (entries.length >= 3) byCat += proRailHtml(c.name, c.icon || '📦', entries, 'shop');
    });

    const closed = proIsOpen() ? '' :
        '<div class="pro-closed-banner"><span>🌙 المتجر مغلق مؤقتًا ولا يستقبل طلبات جديدة الآن — تفضّل بزيارتنا قريبًا.</span>' +
        (settings.phone ? '<a href="tel:' + esc(settings.phone) + '" style="color:#fff;text-decoration:underline">اتصل بنا</a>' : '') + '</div>';

    hv.innerHTML =
    '<div class="pro-home-wrap">' +
        proTgGreetHtml() +
        closed +
        proBannersHtml() +
        proTrustHtml() +
        proInstallCardHtml() +
        proCatCirclesHtml() +
        proRailHtml('عروض وخصومات', '🔥', offers, 'shop') +
        proRailHtml('الأكثر مبيعًا', '🏆', best, 'shop') +
        proRailHtml('وصل حديثًا', '🆕', newest, 'shop') +
        byCat +
        '<section class="landing-section" id="landing-features">' +
            '<div class="landing-head"><span class="tag">لماذا نحن</span><h2>' + esc(settings.store || 'متجرنا') + '</h2>' +
            '<p>' + esc(settings.desc || '') + '</p></div>' +
            '<div class="features">' +
                '<div class="feature"><div class="icon">🚚</div><h3>توصيل لكل المحافظات</h3><p>اطلب أونلاين وتابع طلبك لحظة بلحظة برمز التتبّع.</p></div>' +
                '<div class="feature"><div class="icon">🔒</div><h3>دفع آمن وواضح</h3><p>' + (proNum(settings.payVodafone) || settings.payInstapay ? 'الدفع عند الاستلام أو تحويل فودافون كاش / إنستاباي.' : 'الدفع عند الاستلام مع إيصال موثّق لكل طلب.') + '</p></div>' +
                '<div class="feature"><div class="icon">💎</div><h3>منتجات أصلية</h3><p>كل صنف نعرضه موجود فعليًا في المخزن ومحدّث لحظيًا.</p></div>' +
                '<div class="feature"><div class="icon">📞</div><h3>خدمة عملاء</h3><p>' + (settings.phone ? ('اتصل بنا: ' + esc(settings.phone)) : 'تواصل معنا من صفحة المتجر.') + '</p></div>' +
            '</div>' +
        '</section>' +
        '<div style="text-align:center;margin:30px 0 10px">' +
            '<button class="btn btn-primary" onclick="setView(\'shop\')" style="padding:14px 30px;font-size:1rem">🏪 تصفّح كل المنتجات ←</button>' +
        '</div>' +
    '</div>';

    proLoadStoreConfig().then(() => {
        if (currentView === 'home') {
            const wrap = hv.querySelector('.pro-home-wrap');
            if (wrap) {
                // نُحدّث البنرات فقط بعد وصول السحابة (بلا إعادة رسم كاملة تسبب وميضًا)
                const sec = wrap.querySelector('.pro-banner-sec');
                if (sec) sec.outerHTML = proBannersHtml();
            }
            proBannersAutoStart();
            proMarkAnnounceSeen();
        }
    });
    proBannersAutoStart();
    proUpdateInstallCard();
}

function proTgGreetHtml() {
    if (!window.proTgUser) return '';
    const nm = (window.proTgUser.first_name || '') + (window.proTgUser.last_name ? ' ' + window.proTgUser.last_name : '');
    if (!nm) return '';
    return '<div class="pro-tg-greet"><span style="font-size:1.1rem">👋</span> أهلًا ' + esc(nm) + ' — تتسوّق الآن داخل تيليجرام</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  4) تحسين بطاقات المنتجات القائمة (شارة خصم + سعر مشطوب) بلا تكرار المنطق
// ═══════════════════════════════════════════════════════════════════════════
function proDecorateCards(root) {
    if (!root) return;
    const cards = root.querySelectorAll('.shop-card');
    if (!cards.length) return;
    cards.forEach(card => {
        if (card.dataset.prod === '1') return;
        const m = /openProductDetail\((\d+),\s*(\d+)\)/.exec(card.getAttribute('onclick') || '');
        if (!m) return;
        card.dataset.prod = '1';
        const cat = db[+m[1]]; const it = cat && cat.items[+m[2]];
        if (!it) return;
        const pct = proDiscountPct(it), oldP = proOldPrice(it);
        const imgBox = card.querySelector('.shop-img');
        if (imgBox && pct > 0 && !imgBox.querySelector('.pro-sale-badge')) {
            const b = document.createElement('span');
            b.className = 'pro-sale-badge';
            b.textContent = '-' + pct + '%';
            imgBox.appendChild(b);
        }
        const priceBox = card.querySelector('.shop-price');
        if (priceBox && oldP > itemPrice(it) && !priceBox.querySelector('.pro-old-price')) {
            const s = document.createElement('span');
            s.className = 'pro-old-price';
            s.textContent = fmt(oldP);
            priceBox.appendChild(s);
        }
        const imgs = proItemImages(it);
        if (imgBox && imgs.length > 1 && !imgBox.querySelector('.pro-img-count')) {
            const s = document.createElement('span');
            s.className = 'pro-img-count';
            s.style.cssText = 'position:absolute;bottom:8px;right:8px;z-index:2;background:rgba(0,0,0,.62);color:#fff;font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:999px';
            s.textContent = '🖼️ ' + imgs.length;
            imgBox.appendChild(s);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  5) صفحة المنتج: معرض صور حقيقي + وصف + شريط شراء سفلي + مشاركة
// ═══════════════════════════════════════════════════════════════════════════
function proEnhanceProductDetail(ci, ii) {
    const cat = db[ci], it = cat && cat.items[ii];
    if (!it) return;
    const card = document.getElementById('productDetailCard');
    if (!card) return;
    const imgs = proItemImages(it);
    const pct = proDiscountPct(it), oldP = proOldPrice(it);

    // (أ) إصلاح المعرض: صور هذا المنتج فقط — لا صور منتجات أخرى من نفس القسم
    const gallery = card.querySelector('.amz-gallery');
    if (gallery && !imgs.length) {
        // منتج بلا صور: نخفي شريط المصغرات بدل عرض صور منتجات أخرى (عطل قديم)
        const t = gallery.querySelector('.amz-thumbs');
        if (t) t.style.display = 'none';
        amzThumbs = [];
    }
    if (gallery && imgs.length) {
        const main = gallery.querySelector('.amz-main-img');
        if (main) main.innerHTML = '<img src="' + esc(imgs[0]) + '" alt="" id="amzMainImg">';
        const thumbs = gallery.querySelector('.amz-thumbs');
        if (thumbs) {
            amzThumbs = imgs.map(u => ({ img: u }));
            thumbs.innerHTML = imgs.map((u, k) =>
                '<div class="amz-thumb' + (k === 0 ? ' active' : '') + '" onclick="amzSetMain(' + k + ')">' +
                '<img src="' + esc(u) + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">' +
                '</div>').join('');
            thumbs.style.display = imgs.length > 1 ? '' : 'none';
        }
    }

    // (ب) السعر المشطوب + نسبة الخصم بجانب السعر الرئيسي
    const priceEl = card.querySelector('.amz-price');
    if (priceEl && pct > 0 && !priceEl.querySelector('.pro-old-price')) {
        const wrap = document.createElement('span');
        wrap.innerHTML = '<span class="pro-old-price" style="font-size:.9rem">' + fmt(oldP) + ' ج.م</span>' +
            '<span style="background:var(--pro-sale);color:#fff;font-size:.7rem;font-weight:900;padding:3px 9px;border-radius:999px;margin-inline-start:8px">وفّر ' + pct + '%</span>';
        priceEl.parentNode.insertBefore(wrap, priceEl.nextSibling);
    }

    // (ج) الوصف التفصيلي
    const desc = String(it.desc || '').trim();
    if (desc) {
        const host = card.querySelector('.amz-details');
        if (host && !host.querySelector('.pro-desc')) {
            const box = document.createElement('div');
            box.className = 'pro-desc';
            box.style.cssText = 'background:var(--bg-soft);padding:14px;border-radius:12px;font-size:.88rem;line-height:1.9;margin-top:10px';
            box.innerHTML = '<b style="display:block;margin-bottom:6px">📝 وصف المنتج</b>' + esc(desc).replace(/\n/g, '<br>');
            host.insertBefore(box, host.firstChild);
        }
    }

    // (د) شريط شراء سفلي ثابت على الجوال
    const layout = card.querySelector('.amz-layout');
    if (layout && !card.querySelector('.pro-pd-sticky')) {
        const qs = getQs(it);
        const bar = document.createElement('div');
        bar.className = 'pro-pd-sticky';
        bar.innerHTML =
            '<div><div style="font-size:1.05rem;font-weight:900">' + esc(it.p) + ' <small style="font-size:.72rem">ج.م</small></div>' +
            '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + (qs > 0 ? availText(it) : 'غير متوفر') + '</div></div>' +
            '<button class="btn btn-primary" style="padding:12px 20px;font-size:.9rem" ' + (qs <= 0 ? 'disabled style="opacity:.5"' : '') +
            ' onclick="addToCart(' + ci + ',' + ii + ');closeProductDetail();openCart()">🛒 أضف للسلة</button>';
        card.appendChild(bar);
    }

    // (هـ) زر مشاركة حقيقي برابط مباشر للمنتج
    if (it.cid || it.lid) {
        const shareBtns = card.querySelectorAll('button');
        shareBtns.forEach(b => {
            if ((b.textContent || '').indexOf('🔗 مشاركة') !== -1 && !b.dataset.proShare) {
                b.dataset.proShare = '1';
                b.onclick = function () { proShareProduct(ci, ii); };
            }
        });
    }
}

function proProductUrl(ci, ii) {
    const cat = db[ci], it = cat && cat.items[ii];
    if (!it) return location.href;
    const base = location.origin + location.pathname;
    const key = it.cid ? ('p=' + it.cid) : ('pl=' + encodeURIComponent(it.lid || ''));
    return base + '?' + key;
}
function proShareProduct(ci, ii) {
    const it = db[ci] && db[ci].items[ii];
    if (!it) return;
    const url = proProductUrl(ci, ii);
    const text = it.n + ' — ' + it.p + ' ج.م';
    if (navigator.share) {
        navigator.share({ title: it.n, text: text, url: url }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => toast('🔗 تم نسخ رابط المنتج')).catch(() => toast(url));
    } else {
        toast(url, 6000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6) إشعار «تمت الإضافة إلى السلة»
// ═══════════════════════════════════════════════════════════════════════════
function proShowAddedToast(ci, ii) {
    const it = db[ci] && db[ci].items[ii];
    if (!it) return;
    let el = document.getElementById('proAddedToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'proAddedToast';
        el.className = 'pro-added-toast';
        document.body.appendChild(el);
    }
    const imgs = proItemImages(it);
    el.innerHTML =
        '<span class="pro-added-check">✓</span>' +
        (imgs.length ? '<img src="' + esc(imgs[0]) + '" alt="" style="width:38px;height:38px;border-radius:10px;object-fit:cover;flex-shrink:0">' : '<span style="font-size:1.6rem">📦</span>') +
        '<div style="flex:1;min-width:0"><div style="font-size:.82rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.n) + '</div>' +
        '<div style="font-size:.72rem;opacity:.7;font-weight:700">تمت الإضافة إلى السلة</div></div>' +
        '<button class="pro-added-btn" onclick="closeProductDetail();openCart()">عرض السلة ←</button>';
    el.classList.add('show');
    if (proToastTimer) clearTimeout(proToastTimer);
    proToastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

// ═══════════════════════════════════════════════════════════════════════════
//  7) بطاقة تثبيت التطبيق (أندرويد · آيفون · تيليجرام)
// ═══════════════════════════════════════════════════════════════════════════
function proIsIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
function proIsStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
function proInstallDismissed() {
    const t = parseInt(localStorage.getItem('al_sayed_install_dismiss') || '0', 10) || 0;
    return t && (Date.now() - t) < 7 * 24 * 3600 * 1000;
}
function proInstallCardHtml() {
    if (proIsStandalone() || proInstallDismissed()) return '';
    const tg = window.Telegram && window.Telegram.WebApp;
    const inTg = !!(tg && tg.initData);
    const ios = proIsIOS();
    return '<div class="pro-install-card" id="proInstallCard">' +
        '<img class="pro-install-icon" src="icon-192.png" alt="">' +
        '<div class="pro-install-info">' +
            '<b>📲 ثبّت التطبيق على جهازك</b>' +
            '<span>' + (inTg ? 'أضِفه لشاشة تيليجرام الرئيسية للوصول السريع' : ios ? 'خطوات بسيطة من Safari — بلا متجر تطبيقات' : 'يفتح أسرع ويعمل أوفلاين بضغطة واحدة') + '</span>' +
        '</div>' +
        '<button class="btn btn-primary" style="padding:9px 16px;font-size:.8rem;white-space:nowrap" onclick="proInstallNow()">تثبيت</button>' +
        '<button class="pro-install-dismiss" onclick="proDismissInstall()" aria-label="إخفاء">✕</button>' +
    '</div>';
}
function proUpdateInstallCard() {
    const host = document.querySelector('.pro-home-wrap');
    if (!host) return;
    const existing = document.getElementById('proInstallCard');
    const html = proInstallCardHtml();
    if (!html) { if (existing) existing.remove(); return; }
    if (!existing) {
        const anchor = host.querySelector('.pro-trust-row');
        if (anchor) anchor.insertAdjacentHTML('afterend', html);
        else host.insertAdjacentHTML('afterbegin', html);
    }
}
function proDismissInstall() {
    localStorage.setItem('al_sayed_install_dismiss', String(Date.now()));
    const el = document.getElementById('proInstallCard');
    if (el) el.remove();
}
async function proInstallNow() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData && typeof tg.addToHomeScreen === 'function') {
        try { tg.addToHomeScreen(); return; } catch (e) {}
    }
    if (proIsIOS()) { proShowIosInstall(); return; }
    if (typeof deferredPrompt !== 'undefined' && deferredPrompt) {
        deferredPrompt.prompt();
        try {
            const r = await deferredPrompt.userChoice;
            if (r && r.outcome === 'accepted') {
                proDismissInstall();
                toast('✅ تم تثبيت التطبيق');
            }
        } catch (e) {}
        deferredPrompt = null;
        return;
    }
    // سطح المكتب/متصفح لا يدعم التثبيت التلقائي: نشرح الخطوات
    toast('📲 من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»', 6000);
}
function proShowIosInstall() {
    let ov = document.getElementById('proIosOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'proIosOverlay';
        ov.className = 'pro-ios-overlay';
        ov.onclick = function (e) { if (e.target === ov) ov.classList.remove('open'); };
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<div class="pro-ios-sheet">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
            '<h3 style="font-size:1.05rem;font-weight:900">📲 تثبيت على الآيفون</h3>' +
            '<button onclick="document.getElementById(\'proIosOverlay\').classList.remove(\'open\')" style="border:none;background:var(--bg-soft);width:32px;height:32px;border-radius:50%;cursor:pointer">✕</button>' +
        '</div>' +
        '<p style="font-size:.82rem;color:var(--text-muted);font-weight:700;margin-top:8px">افتح المتجر من متصفح <b>Safari</b> ثم اتبع الخطوات:</p>' +
        '<div class="pro-ios-step"><span class="pro-ios-num">1</span><span>اضغط زر <b>المشاركة</b> ⬆️ في أسفل الشاشة</span></div>' +
        '<div class="pro-ios-step"><span class="pro-ios-num">2</span><span>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ➕</span></div>' +
        '<div class="pro-ios-step"><span class="pro-ios-num">3</span><span>اضغط <b>«إضافة»</b> — وسيظهر أيقونة المتجر على هاتفك</span></div>' +
        '<button class="btn btn-primary" style="width:100%;margin-top:18px" onclick="document.getElementById(\'proIosOverlay\').classList.remove(\'open\')">فهمت، شكرًا</button>' +
    '</div>';
    ov.classList.add('open');
}

// ═══════════════════════════════════════════════════════════════════════════
//  8) Telegram Mini App
// ═══════════════════════════════════════════════════════════════════════════
function proTelegramInit() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData && !tg.initDataUnsafe) return null;
    try {
        tg.ready();
        tg.expand();
        if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
        if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#0d4f6c');
        if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#f5f9fb');
        if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) window.proTgUser = tg.initDataUnsafe.user;
        // زر الرجوع الأصلي: يُغلق النوافذ المفتوحة بدل الخروج من التطبيق
        if (tg.BackButton) {
            tg.BackButton.onClick(() => {
                const admin = document.getElementById('proAdmin');
                if (admin && admin.classList.contains('open')) { proCloseAdmin(); return; }
                const chk = document.getElementById('proCheckout');
                if (chk && chk.classList.contains('open')) { proCloseCheckout(); return; }
                const pd = document.getElementById('productDetailOverlay');
                if (pd && pd.classList.contains('open')) { closeProductDetail(); return; }
                const cart = document.getElementById('cartOverlay');
                if (cart && cart.classList.contains('open')) { closeCart(); return; }
                tg.close();
            });
        }
        // مزامنة الثيم مع تيليجرام
        const scheme = tg.colorScheme === 'dark' ? 'dark' : 'light';
        try {
            document.documentElement.setAttribute('data-theme', scheme);
            localStorage.setItem('al_sayed_theme', scheme);
        } catch (e) {}
    } catch (e) {}
    return tg;
}
function proHaptic(type) {
    const tg = window.Telegram && window.Telegram.WebApp;
    try {
        if (tg && tg.HapticFeedback) {
            if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
            else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
            else tg.HapticFeedback.impactOccurred('light');
        }
    } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  9) العلامة «تمت مشاهدة الإعلان» + ربط السلة
// ═══════════════════════════════════════════════════════════════════════════
function proMarkAnnounceSeen() {
    try { localStorage.setItem('al_sayed_ann_seen', String(settings.announce || '')); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  10) التهيئة — تُغلّف دوال العرض القائمة بلا تعديل فيها
// ═══════════════════════════════════════════════════════════════════════════
function proInitStorefront() {
    proOrigRenderHome = renderHome;
    renderHome = proRenderHome;

    proOrigOpenProductDetail = openProductDetail;
    openProductDetail = function (ci, ii) {
        proOrigOpenProductDetail(ci, ii);
        try { proEnhanceProductDetail(ci, ii); } catch (e) {}
    };

    proOrigAddToCart = addToCart;
    addToCart = function (ci, ii) {
        const before = cartCount();
        proOrigAddToCart(ci, ii);
        if (cartCount() > before) { proHaptic('light'); proShowAddedToast(ci, ii); }
    };

    // تحسين بطاقات المتجر بعد كل رسم (مراقب DOM بدل تكرار كود العرض)
    const root = document.getElementById('view-root');
    if (root && window.MutationObserver) {
        let queued = false;
        const obs = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                try { proDecorateCards(root); } catch (e) {}
            });
        });
        obs.observe(root, { childList: true, subtree: false });
    }

    // روابط مباشرة: ?p= معرّف المنتج (مشاركة) — تُفتح بعد المزامنة
    proHandleDeepLink();
    proTelegramInit();
    proLoadStoreConfig().then(() => {
        proApplyBranding();
        if (currentView === 'home') renderHome();
    });
    // التحديث التلقائي لحالة المتجر/الشريط عند تغيّر الإعدادات من جهاز آخر
    setInterval(() => { if (document.visibilityState === 'visible') proLoadStoreConfig(true); }, 120000);
}

function proHandleDeepLink() {
    const q = new URLSearchParams(location.search || '');
    const pid = q.get('p');
    if (!pid) return;
    let tries = 0;
    const iv = setInterval(() => {
        tries++;
        for (let ci = 0; ci < db.length; ci++) {
            const ii = (db[ci].items || []).findIndex(it => String(it.cid) === String(pid));
            if (ii >= 0) {
                clearInterval(iv);
                setView('shop');
                setTimeout(() => openProductDetail(ci, ii), 200);
                return;
            }
        }
        if (tries > 40) clearInterval(iv);
    }, 250);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', proInitStorefront);
} else {
    proInitStorefront();
}

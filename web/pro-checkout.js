// ═══════════════════════════════════════════════════════════════════════════
//  💳 pro-checkout.js — الشراء الأونلاين للزائر + تتبّع الطلب + الشحن المجاني
//
//  الفجوة التي يغلقها هذا الملف (كانت أخطر ثغرة بيع في التطبيق):
//   • الزائر بلا حساب كان طلبه يبقى في جهازه فقط («⏳ لم يصل للمحل بعد»).
//   • السلة لم تكن تطلب هاتفًا ولا عنوانًا ولا طريقة دفع.
//
//  الحل: صفحة إتمام طلب من 3 خطوات + دالة سيرفر آمنة place_store_order()
//  تعيد حساب كل الأرقام على القاعدة وتُرجع رمز تتبّع — يعمل بدون تسجيل حساب.
// ═══════════════════════════════════════════════════════════════════════════

let proCheckoutForm = null;
let proCheckoutBusy = false;
let proOrigRenderCartFn = null;

const PRO_CITIES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الشرقية', 'المنوفية', 'الغربية', 'كفر الشيخ',
    'البحيرة', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'شمال سيناء', 'جنوب سيناء', 'الفيوم', 'بني سويف',
    'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح'];

function proCheckoutDefault() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('al_sayed_customer') || '{}'); } catch (e) {}
    const tgName = window.proTgUser ? ((window.proTgUser.first_name || '') + ' ' + (window.proTgUser.last_name || '')).trim() : '';
    return {
        name: saved.name || tgName || (sessionUser && sessionRole === 'customer' ? sessionUser : ''),
        phone: saved.phone || '',
        fulfillment: 'delivery',
        city: saved.city || 'الدقهلية',
        area: saved.area || '',
        address: saved.address || '',
        notes: '',
        payment: 'cod',
        receipt: '',
        coupon: ''
    };
}
function proCheckoutReset() {
    proCheckoutForm = proCheckoutDefault();
}

// ═══════════════════════════════════════════════════════════════════════════
//  1) شريط الشحن المجاني داخل السلة + زر إتمام الطلب أونلاين
// ═══════════════════════════════════════════════════════════════════════════
function proFreeShipBarHtml(subtotal) {
    const freeOver = proNum(settings.freeShip);
    if (freeOver <= 0) return '';
    const remain = Math.max(0, freeOver - subtotal);
    const pct = Math.min(100, Math.round(subtotal / freeOver * 100));
    return '<div class="pro-freeship">' +
        '<div class="pro-freeship-txt"><span>' + (remain > 0 ? ('🚚 أضف بـ <b style="color:var(--primary)">' + fmt(remain) + ' ج.م</b> لتحصل على شحن مجاني') : '🎉 <b style="color:var(--success)">مبروك! شحن مجاني على طلبك</b>') + '</span>' +
        '<span style="color:var(--text-muted);font-size:.75rem">' + fmt(subtotal) + ' / ' + fmt(freeOver) + '</span></div>' +
        '<div class="pro-freeship-bar"><div class="pro-freeship-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
}
function proEnhanceCart() {
    const body = document.getElementById('cartBody');
    if (!body) return;
    const lines = body.querySelector('.cart-lines');
    const sub = cartSubtotal();
    if (lines && !lines.querySelector('.pro-freeship')) {
        lines.insertAdjacentHTML('afterbegin', proFreeShipBarHtml(sub));
    } else if (lines) {
        const old = lines.querySelector('.pro-freeship');
        if (old) old.outerHTML = proFreeShipBarHtml(sub);
    }
    // زر «إتمام الطلب أونلاين» — يعمل للزائر وللعميل معًا
    const actionsBox = body.querySelector('.modal-actions');
    if (actionsBox && !body.querySelector('.pro-checkout-cta')) {
        const cta = document.createElement('div');
        cta.className = 'pro-checkout-cta';
        cta.style.cssText = 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap';
        cta.innerHTML = '<button class="btn btn-primary" style="flex:1;padding:13px;font-size:.92rem" onclick="proOpenCheckout()">' +
            '💳 إتمام الطلب أونلاين ←</button>';
        body.querySelector('.summary').appendChild(cta);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2) صفحة إتمام الطلب (3 خطوات)
// ═══════════════════════════════════════════════════════════════════════════
function proCheckoutEnsureShell() {
    let el = document.getElementById('proCheckout');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'proCheckout';
    el.style.cssText = 'position:fixed;inset:0;z-index:16000;background:var(--bg-body);display:none;overflow-y:auto';
    document.body.appendChild(el);
    return el;
}
function proOpenCheckout() {
    if (!invoiceCart.length) return toast('🛒 سلتك فارغة — أضف منتجات أولًا');
    if (!proIsOpen()) return toast('🌙 المتجر مغلق مؤقتًا — لا يستقبل طلبات جديدة الآن', 5000);
    if (!proCheckoutForm) proCheckoutReset();
    try { closeCart(); } catch (e) {}
    const el = proCheckoutEnsureShell();
    el.style.display = 'block';
    document.body.style.overflow = 'hidden';
    proRenderCheckout();
}
function proCloseCheckout() {
    const el = document.getElementById('proCheckout');
    if (el) el.style.display = 'none';
    document.body.style.overflow = '';
}
function proCheckoutSet(k, v) { proCheckoutForm[k] = v; proRenderCheckoutTotals(); }
function proCheckoutPick(k, v) { proCheckoutForm[k] = v; proRenderCheckout(); }

function proCheckoutTotals() {
    const items = invoiceCart.map(c => {
        const cat = db[c.ci], it = cat && cat.items[c.ii];
        return it ? { it: it, qty: c.qty, price: itemPrice(it), cat: cat } : null;
    }).filter(Boolean);
    const subtotal = items.reduce((s, x) => s + x.price * x.qty, 0);
    const cCode = String(settings.couponCode || '').trim().toUpperCase();
    const cPct = proNum(settings.couponPct);
    const usedCoupon = !!cCode && cPct > 0 && String(proCheckoutForm.coupon || '').trim().toUpperCase() === cCode;
    const discount = usedCoupon ? Math.round(subtotal * cPct) / 100 : 0;
    const tax = Math.round((subtotal - discount) * proNum(settings.tax)) / 100;
    const freeOver = proNum(settings.freeShip);
    const pickup = proCheckoutForm.fulfillment === 'pickup';
    const shipping = pickup ? 0 : (subtotal <= 0 ? 0 : (freeOver > 0 && subtotal >= freeOver ? 0 : proNum(settings.shipping)));
    return { items: items, subtotal: subtotal, discount: discount, tax: tax, shipping: shipping, total: subtotal - discount + tax + shipping, couponApplied: usedCoupon, pickup: pickup };
}
function proRenderCheckoutTotals() {
    const host = document.getElementById('proCheckoutTotals');
    if (!host) return;
    const t = proCheckoutTotals();
    host.innerHTML =
        '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>المجموع الفرعي</span><span>' + fmt(t.subtotal) + ' ج</span></div>' +
        (t.discount > 0 ? '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:800;padding:4px 0;color:var(--success)"><span>الخصم</span><span>−' + fmt(t.discount) + ' ج</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>الشحن</span><span>' + (t.pickup ? 'استلام من المحل' : (t.shipping ? fmt(t.shipping) + ' ج' : 'مجاني')) + '</span></div>' +
        (t.tax > 0 ? '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>الضريبة</span><span>' + fmt(t.tax) + ' ج</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:900;padding:9px 0;border-top:1px solid var(--border);margin-top:5px"><span>الإجمالي</span><span id="proCheckoutGrand">' + fmt(t.total) + ' ج.م</span></div>';
    const sticky = document.getElementById('proCheckoutStickyTotal');
    if (sticky) sticky.textContent = fmt(t.total) + ' ج.م';
}

function proPayInfoHtml() {
    const f = proCheckoutForm;
    if (f.payment === 'cod') {
        return '<div style="font-size:.8rem;font-weight:700;color:var(--text-muted);background:var(--bg-soft);padding:10px 12px;border-radius:11px">💵 ادفع نقدًا عند استلام الطلب. لا تحتاج لأي تحويل الآن.</div>';
    }
    const rows = [];
    if (settings.payVodafone) rows.push('📱 فودافون كاش: <b style="direction:ltr;display:inline-block">' + esc(settings.payVodafone) + '</b>');
    if (settings.payInstapay) rows.push('⚡ إنستاباي: <b style="direction:ltr;display:inline-block">' + esc(settings.payInstapay) + '</b>');
    if (settings.payBank) rows.push('🏦 ' + esc(settings.payBank));
    if (!rows.length) {
        rows.push('⚠️ لم تُضَف بيانات التحويل بعد — اختر «الدفع عند الاستلام» أو تواصل مع المتجر' + (settings.phone ? ' على ' + esc(settings.phone) : ''));
    }
    return '<div style="font-size:.82rem;font-weight:700;background:var(--bg-soft);padding:11px 13px;border-radius:11px;line-height:2">' + rows.join('<br>') + '</div>' +
        '<label class="pro-receipt-drop">' +
            '<input type="file" accept="image/*" style="display:none" onchange="proReceiptPick(event)">' +
            (f.receipt
                ? '<img src="' + esc(f.receipt) + '" style="width:46px;height:46px;object-fit:cover;border-radius:9px">'
                : '<span style="font-size:1.4rem">🧾</span>') +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.82rem">' + (f.receipt ? '✅ تم إرفاق الإيصال' : 'أرفق صورة إيصال التحويل') + '</div>' +
            '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + (f.receipt ? 'اضغط للتغيير' : 'مطلوب لتأكيد الحجز') + '</div></div>' +
        '</label>';
}
function proReceiptPick(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('⚠️ حجم الصورة كبير جدًا');
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const max = 1000;
            const scale = Math.min(max / img.width, max / img.height, 1);
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            proCheckoutForm.receipt = cv.toDataURL('image/jpeg', 0.8);
            proRenderCheckout();
            toast('✅ تم إرفاق الإيصال');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function proRenderCheckout() {
    const el = document.getElementById('proCheckout');
    if (!el) return;
    const f = proCheckoutForm;
    const t = proCheckoutTotals();
    const catOpts = PRO_CITIES.map(c => '<option value="' + c + '"' + (f.city === c ? ' selected' : '') + '>' + c + '</option>').join('');
    const choice = (key, val, icon, label, sub) =>
        '<button class="pro-choice-btn' + (f[key] === val ? ' active' : '') + '" onclick="proCheckoutPick(\'' + key + '\',\'' + val + '\')">' +
        '<span style="font-size:1.05rem">' + icon + '</span><span style="flex:1;min-width:0"><b style="display:block;font-size:.82rem">' + label + '</b>' +
        (sub ? '<small style="font-size:.68rem;opacity:.75;font-weight:700">' + sub + '</small>' : '') + '</span>' +
        (f[key] === val ? '<span style="color:var(--primary);font-weight:900">✓</span>' : '') + '</button>';

    el.innerHTML =
    '<div style="position:sticky;top:0;z-index:5;background:var(--bg-card);border-bottom:1px solid var(--border);padding:13px 16px;display:flex;align-items:center;gap:10px">' +
        '<button onclick="proCloseCheckout()" style="background:var(--bg-soft);border:1px solid var(--border);width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:1rem">' + (document.documentElement.dir === 'rtl' ? '→' : '←') + '</button>' +
        '<div style="flex:1"><div style="font-weight:900;font-size:.98rem">إتمام الطلب</div>' +
        '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700">' + cartCount() + ' قطعة · ' + esc(settings.store || '') + '</div></div>' +
        '<div style="font-weight:900;color:var(--primary);font-size:.95rem" id="proCheckoutStickyTotal">' + fmt(t.total) + ' ج.م</div>' +
    '</div>' +
    '<div style="max-width:680px;margin:0 auto;padding:16px 16px 120px">' +
        proFreeShipBarHtml(t.subtotal) +

        // ── الخطوة 1 ──
        '<div class="pro-step-box">' +
            '<div class="pro-step-head"><span class="pro-step-num">1</span> بياناتك</div>' +
            '<div class="form-group" style="margin-bottom:10px"><label>الاسم بالكامل *</label>' +
                '<input type="text" value="' + esc(f.name) + '" placeholder="مثال: أحمد السيد" oninput="proCheckoutSet(\'name\',this.value)"></div>' +
            '<div class="form-group" style="margin-bottom:0"><label>رقم الموبايل *</label>' +
                '<div class="pro-phone-wrap"><span class="pro-phone-pfx">🇪🇬 +20</span>' +
                '<input type="tel" inputmode="numeric" maxlength="11" value="' + esc(f.phone) + '" placeholder="01012345678" oninput="proCheckoutSet(\'phone\',this.value)"></div>' +
                '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700;margin-top:5px">سنستخدمه للتواصل وتأكيد الطلب فقط.</div></div>' +
        '</div>' +

        // ── الخطوة 2 ──
        '<div class="pro-step-box">' +
            '<div class="pro-step-head"><span class="pro-step-num">2</span> الاستلام والتوصيل</div>' +
            '<div class="pro-choice-grid">' +
                choice('fulfillment', 'delivery', '🚚', 'توصيل للعنوان', proNum(settings.shipping) > 0 ? ('شحن ' + fmt(proNum(settings.shipping)) + ' ج') : 'شحن حسب المنطقة') +
                choice('fulfillment', 'pickup', '🏬', 'استلام من المحل', 'بلا مصاريف شحن') +
            '</div>' +
            (f.fulfillment === 'delivery'
                ? '<div class="pro-choice-grid">' +
                    '<div class="form-group"><label>المحافظة</label><select onchange="proCheckoutSet(\'city\',this.value)">' + catOpts + '</select></div>' +
                    '<div class="form-group"><label>المنطقة / الحي</label><input type="text" value="' + esc(f.area) + '" placeholder="مثال: المشاية السفلية" oninput="proCheckoutSet(\'area\',this.value)"></div>' +
                  '</div>' +
                  '<div class="form-group"><label>العنوان بالتفصيل *</label><textarea rows="2" placeholder="اسم الشارع · رقم العمارة · الدور · علامة مميزة" oninput="proCheckoutSet(\'address\',this.value)" style="width:100%;padding:11px;border-radius:11px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:600;resize:vertical">' + esc(f.address) + '</textarea></div>'
                : '<div style="font-size:.82rem;font-weight:700;background:var(--bg-soft);padding:11px 13px;border-radius:11px;line-height:1.9">🏬 يمكنك استلام طلبك من: <b>' + esc(settings.address || settings.store || 'المحل') + '</b>' + (settings.phone ? '<br>📞 ' + esc(settings.phone) : '') + '</div>') +
            '<div class="form-group" style="margin-top:10px;margin-bottom:0"><label>ملاحظات (اختياري)</label>' +
                '<input type="text" value="' + esc(f.notes) + '" placeholder="مثال: اتصل قبل الوصول" oninput="proCheckoutSet(\'notes\',this.value)"></div>' +
        '</div>' +

        // ── الخطوة 3 ──
        '<div class="pro-step-box">' +
            '<div class="pro-step-head"><span class="pro-step-num">3</span> طريقة الدفع</div>' +
            '<div class="pro-choice-grid">' +
                choice('payment', 'cod', '💵', 'الدفع عند الاستلام', 'الأسهل والأكثر أمانًا') +
                (settings.payVodafone ? choice('payment', 'vodafone', '📱', 'فودافون كاش', 'تحويل فوري') : '') +
                (settings.payInstapay ? choice('payment', 'instapay', '⚡', 'إنستاباي', 'تحويل فوري') : '') +
                (settings.payBank ? choice('payment', 'bank', '🏦', 'تحويل بنكي', 'حسب بيانات الحساب') : '') +
            '</div>' +
            proPayInfoHtml() +
        '</div>' +

        // ── الملخص ──
        '<div class="pro-step-box">' +
            '<div class="pro-step-head"><span class="pro-step-num">🧾</span> ملخص الطلب</div>' +
            t.items.map(x =>
                '<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)">' +
                    '<div style="width:38px;height:38px;border-radius:9px;overflow:hidden;background:var(--bg-soft);display:grid;place-items:center;flex-shrink:0">' +
                        (x.it.img ? '<img src="' + esc(x.it.img) + '" style="width:100%;height:100%;object-fit:cover">' : '📦') + '</div>' +
                    '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(x.it.n) + '</div>' +
                    '<div style="font-size:.7rem;color:var(--text-muted);font-weight:700">' + fmt(x.price) + ' ج × ' + x.qty + '</div></div>' +
                    '<div style="font-weight:900;font-size:.82rem">' + fmt(x.price * x.qty) + ' ج</div>' +
                '</div>').join('') +
            '<div style="display:flex;gap:7px;margin-top:11px">' +
                '<input type="text" value="' + esc(f.coupon) + '" placeholder="كود الخصم' + (settings.couponCode ? ' (' + esc(settings.couponCode) + ')' : '') + '" oninput="proCheckoutSet(\'coupon\',this.value)" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-body);font-family:inherit;font-weight:800;text-align:center">' +
            '</div>' +
            (t.couponApplied ? '<div style="font-size:.76rem;font-weight:800;color:var(--success);margin-top:6px">✅ تم تطبيق خصم ' + proNum(settings.couponPct) + '%</div>' : '') +
            '<div id="proCheckoutTotals" style="margin-top:10px">' + proCheckoutTotalsHtml(t) + '</div>' +
        '</div>' +

        '<div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-align:center;line-height:1.9;margin-top:12px">' +
            '🔒 بياناتك تُستخدم لتنفيذ طلبك فقط · ' + (proNum(settings.returnDays) > 0 ? ('إمكانية الإرجاع خلال ' + proNum(settings.returnDays) + ' يوم') : 'سياسة الإرجاع موضّحة في صفحة الإرجاع') +
        '</div>' +
    '</div>' +

    '<div style="position:fixed;bottom:0;inset-inline:0;background:var(--bg-card);border-top:1px solid var(--border);padding:11px 16px calc(11px + env(safe-area-inset-bottom,0px));z-index:6;box-shadow:0 -6px 20px rgba(0,0,0,.08)">' +
        '<div style="max-width:680px;margin:0 auto;display:flex;align-items:center;gap:10px">' +
            '<div style="min-width:0"><div style="font-size:.68rem;color:var(--text-muted);font-weight:800">الإجمالي</div>' +
            '<div style="font-weight:900;font-size:1.05rem">' + fmt(t.total) + ' ج.م</div></div>' +
            '<button class="btn btn-primary" style="flex:1;padding:14px;font-size:.95rem" ' + (proCheckoutBusy ? 'disabled' : '') + ' onclick="proSubmitOrder()">' +
                (proCheckoutBusy ? '⏳ جاري إرسال الطلب...' : '✅ تأكيد الطلب') + '</button>' +
        '</div>' +
    '</div>';
}
function proCheckoutTotalsHtml(t) {
    return '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>المجموع الفرعي</span><span>' + fmt(t.subtotal) + ' ج</span></div>' +
        (t.discount > 0 ? '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:800;padding:4px 0;color:var(--success)"><span>الخصم</span><span>−' + fmt(t.discount) + ' ج</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>الشحن</span><span>' + (t.pickup ? 'استلام من المحل' : (t.shipping ? fmt(t.shipping) + ' ج' : 'مجاني')) + '</span></div>' +
        (t.tax > 0 ? '<div style="display:flex;justify-content:space-between;font-size:.82rem;font-weight:700;padding:4px 0"><span>الضريبة</span><span>' + fmt(t.tax) + ' ج</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:900;padding:9px 0;border-top:1px solid var(--border);margin-top:5px"><span>الإجمالي</span><span>' + fmt(t.total) + ' ج.م</span></div>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  3) إرسال الطلب
// ═══════════════════════════════════════════════════════════════════════════
function proNormalizePhone(v) {
    let d = String(v || '').replace(/[^0-9]/g, '');
    if (d.slice(0, 2) === '20' && d.length === 12) d = '0' + d.slice(2);
    if (d.charAt(0) === '1' && d.length === 10) d = '0' + d;
    return d;
}
function proValidateCheckout() {
    const f = proCheckoutForm;
    if (!String(f.name || '').trim() || String(f.name).trim().length < 2) return '✍️ اكتب اسمك بالكامل';
    const phone = proNormalizePhone(f.phone);
    if (!/^01[0-9]{9}$/.test(phone)) return '📞 رقم الموبايل غير صحيح — اكتبه بالصيغة 01012345678';
    if (f.fulfillment === 'delivery' && String(f.address || '').trim().length < 6) return '📍 اكتب العنوان بالتفصيل للتوصيل';
    if (f.payment !== 'cod' && !f.receipt) return '🧾 أرفق صورة إيصال التحويل أو اختر الدفع عند الاستلام';
    return null;
}

async function proSubmitOrder() {
    if (proCheckoutBusy) return;
    const err = proValidateCheckout();
    if (err) return toast(err, 5000);
    if (!invoiceCart.length) return toast('🛒 سلتك فارغة');

    const f = proCheckoutForm;
    const t = proCheckoutTotals();
    const phone = proNormalizePhone(f.phone);

    // نحفظ بيانات العميل لطلبه القادم (بلا أي بيانات دفع)
    try {
        localStorage.setItem('al_sayed_customer', JSON.stringify({ name: f.name, phone: phone, city: f.city, area: f.area, address: f.address }));
    } catch (e) {}

    proCheckoutBusy = true;
    proRenderCheckout();

    const payload = {
        name: String(f.name).trim(),
        phone: phone,
        fulfillment: f.fulfillment,
        city: f.city, area: f.area, address: f.address, notes: f.notes,
        payment: f.payment,
        receipt: f.receipt || null,
        coupon: String(f.coupon || '').trim(),
        source: (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? 'telegram' : 'web',
        items: invoiceCart.map(c => {
            const it = db[c.ci] && db[c.ci].items[c.ii];
            return { id: it ? it.cid : null, qty: c.qty };
        }).filter(x => x.id)
    };

    const canRpc = !proPreview && payload.items.length === invoiceCart.length &&
                   typeof cloudReady === 'function' && cloudReady() && window.supabase;

    if (canRpc) {
        try {
            // نرفع الإيصال أولًا (إن وُجد) لنُرسل رابطًا لا صورة كاملة
            let receiptUrl = null;
            if (payload.receipt && payload.receipt.indexOf('data:image') === 0) {
                receiptUrl = await proUploadImage(payload.receipt, 'receipt_' + Date.now());
            }
            const { data, error } = await sb.rpc('place_store_order', { payload: Object.assign({}, payload, { receipt: receiptUrl }) });
            if (error) throw error;
            if (!data || data.ok === false) throw new Error((data && data.error) || 'تعذّر إتمام الطلب');
            proCheckoutBusy = false;
            // ⚠️ الأرقام المعتمدة هي التي أعادها السيرفر (قد تختلف عن تقدير المتصفح
            // لو لم تُضبط إعدادات الشحن بعد) — لا نعرض للعميل رقمًا غير الذي حُفظ.
            proAfterOrderSuccess(data, {
                subtotal: proNum(data.subtotal), discount: proNum(data.discount),
                tax: proNum(data.tax), shipping: proNum(data.shipping), total: proNum(data.total)
            });
            return;
        } catch (e) {
            const msg = String((e && e.message) || e);
            // الأخطاء القادمة من الدالة نفسها رسائل عربية واضحة — نعرضها كما هي
            if (/المتجر مغلق|رقم الهاتف|العنوان|السلة فارغة|المتاح من|بلا سعر|محاولات طلب كثيرة|بعد غير متوفر|لم يعد متوفر/.test(msg)) {
                proCheckoutBusy = false;
                proRenderCheckout();
                return toast('⚠️ ' + msg, 6000);
            }
            // غير ذلك (الترقية لم تُنفَّذ بعد / الشبكة) → المسار الاحتياطي المحلي
            console.warn('[checkout] تعذّر استخدام RPC — مسار محلي:', msg);
        }
    }

    // ── المسار الاحتياطي: طلب محلي + واتساب (لا يفقد الطلب) ──
    const res = proCreateLocalOrder(payload, t);
    proCheckoutBusy = false;
    proAfterOrderSuccess(res, t, true);
}

function proCreateLocalOrder(payload, t) {
    const lines = invoiceCart.map(c => {
        const cat = db[c.ci], it = cat && cat.items[c.ii];
        if (!it) return null;
        return { name: it.n, cat: cat.name, qty: c.qty, price: itemPrice(it), lid: it.lid };
    }).filter(Boolean);

    invCounter = (invCounter || 0) + 1;
    const token = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
    const inv = {
        id: Date.now(), lid: genLid(), cid: null, no: invCounter, date: new Date().toISOString(),
        customer: payload.name, user: sessionUser || 'زائر',
        phone: payload.phone, city: payload.city, area: payload.area, address: payload.address,
        notes: payload.notes, payment: payload.payment, paymentStatus: payload.payment === 'cod' ? 'unpaid' : 'review',
        receipt: payload.receipt || '', fulfillment: payload.fulfillment,
        source: payload.source || 'web', token: token,
        items: lines, subtotal: t.subtotal, discount: t.discount, tax: t.tax, shipping: t.shipping, total: t.total,
        status: 'قيد المعالجة', updated_at: new Date().toISOString(), stockApplied: false
    };
    invoices.push(inv);
    // خصم المخزون محليًا (نفس قواعد التطبيق)
    try {
        if (typeof applyStockForInvoice === 'function') {
            const n = applyStockForInvoice(inv, +1);
            if (n) inv.stockApplied = (settings.stockMode || 'both');
        }
    } catch (e) {}
    saveInvoices();
    try { localStorage.setItem('al_sayed_invno', String(invCounter)); } catch (e) {}
    proQueueSafe({ t: 'inv-ins', lid: inv.lid, inv: inv });
    logAction('طلب أونلاين (محلي)', '#' + inv.no + ' · ' + inv.customer + ' · ' + fmt(inv.total) + ' ج.م');
    return { ok: true, order_no: inv.no, token: token, total: inv.total, local: true, invoice: inv };
}

// 🤖 متابعة الطلب على تيليجرام — يفتح البوت برمز الطلب فيربطه بمحادثة العميل
//    (يعمل مع الدالة الخلفية telegram-order-bot: /start o_<token>)
function proTelegramBotUsername() {
    const u = (settings && (settings.telegramBot || settings.tgBot)) || 'Stor2M_bot';
    return String(u).replace(/^@/, '').trim();
}
function proTelegramFollowUrl(token) {
    if (!token) return '';
    return 'https://t.me/' + proTelegramBotUsername() + '?start=o_' + encodeURIComponent(token);
}

function proAfterOrderSuccess(res, t, isLocal) {
    // 🏪 2026-10-25: نُسجّل الطلب السحابي محليًا فورًا — بدونه لا يظهر في «طلباتي»
    // على نفس الجهاز حتى المزامنة التالية، ولا يعمل زر التتبّع من الشاشة نفسها.
    if (!isLocal && res && res.order_id && !(invoices || []).some(i => String(i.cid) === String(res.order_id))) {
        try {
            invoices.push({
                id: Date.now(), lid: genLid(), cid: res.order_id, no: res.order_no,
                date: res.created_at || new Date().toISOString(),
                customer: proCheckoutForm.name, user: sessionUser || 'زائر',
                phone: proNormalizePhone(proCheckoutForm.phone),
                city: proCheckoutForm.city, area: proCheckoutForm.area, address: proCheckoutForm.address,
                notes: proCheckoutForm.notes, payment: res.payment || proCheckoutForm.payment,
                paymentStatus: (res.payment === 'cod' ? 'unpaid' : 'review'),
                receipt: proCheckoutForm.receipt || '', fulfillment: res.fulfillment || proCheckoutForm.fulfillment,
                source: (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? 'telegram' : 'web',
                token: res.token,
                items: (res.items || []).map(x => ({ name: x.name, cat: x.category, qty: x.qty, price: x.price })),
                subtotal: res.subtotal, discount: res.discount, tax: res.tax, total: res.total,
                status: 'قيد المعالجة', updated_at: new Date().toISOString(),
                // المخزون خُصم على السيرفر داخل نفس المعاملة — نضع علامة تمنع الخصم المزدوج
                stockApplied: (settings.stockMode || 'both')
            });
            saveInvoices();
        } catch (e) {}
    }
    try { invoiceCart = []; } catch (e) {}
    try { afterCartChange(); } catch (e) {}
    try { closeCart(); } catch (e) {}
    proHaptic('success');
    toast('✅ تم استلام طلبك بنجاح', 4000);

    const token = res.token;
    const trackUrl = location.origin + location.pathname + '?order=' + token;
    const inv = res.invoice || null;
    const waText = 'مرحبًا ' + (settings.store || '') + '، أرسلت طلبًا أونلاين:%0A' +
        '🧾 رقم الطلب: #' + String(res.order_no || '').padStart(4, '0') + '%0A' +
        '👤 الاسم: ' + encodeURIComponent(proCheckoutForm.name) + '%0A' +
        '📞 الهاتف: ' + encodeURIComponent(proNormalizePhone(proCheckoutForm.phone)) + '%0A' +
        (proCheckoutForm.fulfillment === 'delivery' ? ('📍 العنوان: ' + encodeURIComponent((proCheckoutForm.city || '') + ' - ' + (proCheckoutForm.area || '') + ' - ' + (proCheckoutForm.address || '')) + '%0A') : '🏬 استلام من المحل%0A') +
        '💰 الإجمالي: ' + encodeURIComponent(fmt(t.total)) + ' ج.م%0A' +
        '🔗 تتبّع الطلب: ' + encodeURIComponent(trackUrl);
    const wa = waNumber(settings.phone);

    const el = document.getElementById('proCheckout');
    if (el) {
        el.innerHTML =
        '<div style="max-width:520px;margin:0 auto;padding:50px 20px;text-align:center">' +
            '<div style="width:92px;height:92px;border-radius:50%;background:var(--success);color:#fff;display:grid;place-items:center;font-size:2.6rem;margin:0 auto 18px;box-shadow:0 12px 30px rgba(0,201,167,.35)">✓</div>' +
            '<h2 style="font-size:1.4rem;font-weight:900;margin-bottom:6px">تم استلام طلبك بنجاح</h2>' +
            '<p style="font-size:.86rem;color:var(--text-muted);font-weight:700;line-height:1.9;margin-bottom:18px">' +
                'طلبك رقم <b style="color:var(--text-main)">#' + String(res.order_no || '').padStart(4, '0') + '</b> قيد المراجعة وسنتواصل معك على الرقم <b style="color:var(--text-main);direction:ltr;display:inline-block">' + esc(proNormalizePhone(proCheckoutForm.phone)) + '</b> للتأكيد.' +
            '</p>' +
            '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:14px;margin-bottom:14px;text-align:right">' +
                '<div style="display:flex;justify-content:space-between;font-size:.86rem;font-weight:800"><span>الإجمالي</span><span>' + fmt(t.total) + ' ج.م</span></div>' +
                '<div style="display:flex;justify-content:space-between;font-size:.8rem;font-weight:700;color:var(--text-muted);margin-top:6px"><span>طريقة الدفع</span><span>' + proPayLabel(proCheckoutForm.payment) + '</span></div>' +
                '<div style="display:flex;justify-content:space-between;font-size:.8rem;font-weight:700;color:var(--text-muted);margin-top:6px"><span>الاستلام</span><span>' + (proCheckoutForm.fulfillment === 'pickup' ? 'استلام من المحل' : 'توصيل') + '</span></div>' +
            '</div>' +
            (isLocal ? '<div style="background:#fff7e6;border:1px solid #f5b62c;color:#7a5200;border-radius:12px;padding:11px;font-size:.78rem;font-weight:800;line-height:1.8;margin-bottom:12px">📲 طلبك محفوظ على جهازك — اضغط «إرسال على واتساب» ليصل للمحل فورًا.</div>' : '') +
            '<div style="display:flex;flex-direction:column;gap:9px">' +
                '<button class="btn btn-primary" style="padding:13px" onclick="proTrackByToken(\'' + esc(token) + '\')">🔍 تتبّع طلبك الآن</button>' +
                (!isLocal && token ? '<a class="btn" style="padding:13px;background:#229ED9;color:#fff;text-decoration:none;text-align:center" target="_blank" rel="noopener" href="' + proTelegramFollowUrl(token) + '">🔔 تابع طلبك على تيليجرام</a>' : '') +
                '<button class="btn btn-outline" style="padding:13px" onclick="proCopyTrackLink(\'' + esc(token) + '\')">🔗 نسخ رابط التتبّع</button>' +
                (wa ? '<a class="btn" style="padding:13px;background:var(--pro-whatsapp);color:#fff;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + waText + '">💬 إرسال الطلب على واتساب</a>' : '') +
                '<button class="btn btn-ghost" style="padding:13px" onclick="proCloseCheckout();setView(\'shop\')">🏪 متابعة التسوّق</button>' +
            '</div>' +
            (inv ? '' : '<div style="font-size:.72rem;color:var(--text-muted);font-weight:700;margin-top:14px">احفظ رابط التتبّع — ستحتاجه لمعرفة حالة طلبك بدون حساب.</div>') +
        '</div>';
    }
    proRefreshNewOrdersBadge();
    if (typeof cloudReady === 'function' && cloudReady() && !proPreview) setTimeout(() => pullAll().catch(() => {}), 1200);
}

// ═══════════════════════════════════════════════════════════════════════════
//  4) صفحة تتبّع الطلب (بالرمز — بلا حساب)
// ═══════════════════════════════════════════════════════════════════════════
function proTrackByToken(token) {
    const el = proCheckoutEnsureShell();
    el.style.display = 'block';
    document.body.style.overflow = 'hidden';
    proRenderTracking(token, null);
    proFetchTracking(token);
}
async function proFetchTracking(token) {
    if (typeof cloudReady !== 'function' || !cloudReady() || !window.supabase) {
        proRenderTracking(token, { local: true });
        return;
    }
    try {
        const { data, error } = await sb.rpc('get_order_by_token', { p_token: token });
        if (error) throw error;
        // 🔎 الطلب المحلي (أُنشئ بلا اتصال أو على جهاز لم يزامن) يُعرض بدل «غير موجود»
        if (!data || data.ok === false) {
            const loc = (invoices || []).filter(i => i.token === token)[0];
            if (loc) {
                proRenderTracking(token, {
                    ok: true, local: true, order_no: loc.no, status: loc.status, total: loc.total,
                    items: loc.items, customer: loc.customer, created_at: loc.date,
                    updated_at: loc.updated_at, fulfillment: loc.fulfillment, payment: loc.payment,
                    address: loc.address, city: loc.city, area: loc.area
                });
                return;
            }
        }
        proRenderTracking(token, data);
    } catch (e) {
        // قد يكون الطلب محليًا على نفس الجهاز
        const local = (invoices || []).filter(i => i.token === token)[0];
        proRenderTracking(token, local ? { ok: true, local: true, order_no: local.no, status: local.status, total: local.total, items: local.items, customer: local.customer, created_at: local.date, fulfillment: local.fulfillment, payment: local.payment } : null);
    }
}
function proRenderTracking(token, data) {
    const el = document.getElementById('proCheckout');
    if (!el) return;
    const back = '<div style="position:sticky;top:0;z-index:5;background:var(--bg-card);border-bottom:1px solid var(--border);padding:13px 16px;display:flex;align-items:center;gap:10px">' +
        '<button onclick="proCloseCheckout()" style="background:var(--bg-soft);border:1px solid var(--border);width:38px;height:38px;border-radius:50%;cursor:pointer">✕</button>' +
        '<div style="flex:1"><div style="font-weight:900;font-size:.96rem">تتبّع الطلب</div>' +
        '<div style="font-size:.7rem;color:var(--text-muted);font-weight:700;direction:ltr;text-align:right">' + esc(token) + '</div></div></div>';

    if (data === null) {
        el.innerHTML = back + '<div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center">' +
            '<div style="font-size:3rem;margin-bottom:12px">🔍</div>' +
            '<h3 style="font-weight:900;margin-bottom:8px">جاري البحث عن طلبك...</h3>' +
            '<p style="font-size:.84rem;color:var(--text-muted);font-weight:700">لو استمرت الرسالة، تأكد من صحة رابط التتبّع.</p></div>';
        return;
    }
    if (!data || data.ok === false) {
        el.innerHTML = back + '<div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center">' +
            '<div style="font-size:3rem;margin-bottom:12px">😕</div>' +
            '<h3 style="font-weight:900;margin-bottom:8px">لا يوجد طلب بهذا الرمز</h3>' +
            '<p style="font-size:.84rem;color:var(--text-muted);font-weight:700">تأكد من نسخ الرابط كاملًا أو تواصل مع المتجر' + (settings.phone ? ' على ' + esc(settings.phone) : '') + '.</p></div>';
        return;
    }
    const order = ['قيد المعالجة', 'مؤكد', 'في الطريق', 'تم التوصيل'];
    const idx = order.indexOf(data.status);
    const cancelled = data.status === 'ملغي' || data.status === 'تم رفض الطلب';
    const steps = order.map((s, i) =>
        '<div class="pro-track-node' + (!cancelled && i < idx ? ' done' : '') + (!cancelled && i === idx ? ' current' : '') + '">' +
            '<div class="pro-track-dot">' + (!cancelled && i < idx ? '✓' : ['🆕', '✅', '🚚', '📦'][i]) + '</div>' +
            '<div>' + s + '</div></div>').join('');
    const items = (data.items || []).map(i =>
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:.84rem;font-weight:700">' +
            '<span>' + esc(i.name) + ' <span style="color:var(--text-muted)">×' + i.qty + '</span></span>' +
            '<span style="font-weight:900">' + fmt(proNum(i.price) * i.qty) + ' ج</span></div>').join('');

    el.innerHTML = back + '<div style="max-width:560px;margin:0 auto;padding:16px 16px 40px">' +
        '<div class="pro-card" style="text-align:center">' +
            '<div style="font-size:.78rem;font-weight:800;color:var(--text-muted)">طلب رقم</div>' +
            '<div style="font-size:1.5rem;font-weight:900;margin-bottom:10px">#' + String(data.order_no || '').padStart(4, '0') + '</div>' +
            '<div class="pro-track-steps">' + steps + '</div>' +
            (cancelled ? '<div style="background:var(--danger-soft);color:var(--danger);border-radius:11px;padding:10px;font-weight:900;font-size:.84rem">هذا الطلب ' + esc(data.status) + '</div>' : '') +
            '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-top:8px">آخر تحديث: ' + (data.updated_at ? new Date(data.updated_at).toLocaleString('ar-EG') : '—') + '</div>' +
        '</div>' +
        '<div class="pro-card">' +
            '<div class="pro-card-head"><h3>🛍️ تفاصيل الطلب</h3></div>' +
            items +
            '<div style="display:flex;justify-content:space-between;font-size:.95rem;font-weight:900;padding-top:10px;margin-top:6px;border-top:2px solid var(--border)"><span>الإجمالي</span><span>' + fmt(proNum(data.total)) + ' ج.م</span></div>' +
        '</div>' +
        '<div class="pro-card">' +
            '<div style="font-size:.84rem;font-weight:700;line-height:2">' +
                '<div>👤 ' + esc(data.customer || '') + '</div>' +
                (data.phone_masked ? '<div>📞 ' + esc(data.phone_masked) + '</div>' : '') +
                (data.address ? '<div>📍 ' + esc((data.city || '') + ' ' + (data.area || '') + ' — ' + data.address) + '</div>' : '') +
                '<div>' + (data.fulfillment === 'pickup' ? '🏬 استلام من المحل' : '🚚 توصيل') + ' · ' + proPayLabel(data.payment || 'cod') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:12px">' +
                (!data.local ? '<a class="btn" style="flex:1;padding:11px;background:#229ED9;color:#fff;text-decoration:none;text-align:center" target="_blank" rel="noopener" href="' + proTelegramFollowUrl(token) + '">🔔 تابع على تيليجرام</a>' : '') +
                (waNumber(settings.phone) ? '<a class="btn" style="flex:1;padding:11px;background:var(--pro-whatsapp);color:#fff;text-decoration:none;text-align:center" target="_blank" rel="noopener" href="https://wa.me/' + waNumber(settings.phone) + '?text=' + encodeURIComponent('استفسار عن الطلب #' + data.order_no) + '">💬 تواصل مع المتجر</a>' : '') +
                (settings.phone ? '<a class="btn btn-outline" style="flex:1;padding:11px;text-decoration:none;text-align:center" href="tel:' + esc(settings.phone) + '">📞 اتصال</a>' : '') +
            '</div>' +
        '</div>' +
        (data.local ? '<div style="background:#fff7e6;border:1px solid #f5b62c;color:#7a5200;border-radius:12px;padding:11px;font-size:.78rem;font-weight:800;line-height:1.8">📲 هذا الطلب مسجّل على جهازك ولم يصل للمحل بعد — أرسله على واتساب ليصل فورًا.</div>' : '') +
    '</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  5) التهيئة
// ═══════════════════════════════════════════════════════════════════════════
function proInitCheckout() {
    proCheckoutReset();
    proOrigRenderCartFn = renderCart;
    renderCart = function () {
        proOrigRenderCartFn();
        try { proEnhanceCart(); } catch (e) {}
    };
    // رابط تتبّع مباشر: ?order=<token>
    const token = new URLSearchParams(location.search || '').get('order');
    if (token) setTimeout(() => proTrackByToken(token), 900);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', proInitCheckout);
} else {
    proInitCheckout();
}

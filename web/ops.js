    // ===== DAILY REPORT + CSV (تقرير نهاية اليوم والتصدير) =====
    function dailyReport() {
        if (!can('dash')) return;
        const today = new Date().toDateString();
        const tInv = invoices.filter(inv => new Date(inv.date).toDateString() === today);
        const tSales = tInv.reduce((s, inv) => s + inv.total, 0);
        const avg = tInv.length ? tSales / tInv.length : 0;
        const ps = {};
        tInv.forEach(inv => inv.items.forEach(it => { ps[it.name] = (ps[it.name] || 0) + it.qty; }));
        const top = Object.entries(ps).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const ss = {};
        tInv.forEach(inv => { const k = inv.user || '—'; ss[k] = (ss[k] || 0) + inv.total; });
        const sellers = Object.entries(ss).sort((a, b) => b[1] - a[1]);
        let totalValue = 0, lowN = 0, outN = 0;
        db.forEach(c => c.items.forEach(it => {
            totalValue += (getQ(it) + getQs(it)) * itemPrice(it);
            if (getQ(it) === 0) outN++;
            else if (getQ(it) <= getMin(it)) lowN++;
        }));
        const d = new Date();
        const body = document.getElementById('modalBody');
        body.innerHTML =
            '<div class="receipt" style="padding:10px 0">' +
                '<div style="text-align:center;margin-bottom:14px">' +
                    '<div style="font-size:2rem">📊</div>' +
                    '<h2 style="font-size:1.3rem;margin:4px 0">' + esc(settings.store) + '</h2>' +
                    '<div style="color:var(--text-muted);font-size:0.8rem">تقرير نهاية اليوم · ' + d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
                '</div>' +
                '<table><tr><th>البند</th><th style="text-align:left">القيمة</th></tr>' +
                '<tr><td>💵 إيراد اليوم</td><td style="font-weight:900;color:var(--primary);text-align:left">' + fmt(tSales) + ' ج.م</td></tr>' +
                '<tr><td>🧾 عدد فواتير اليوم</td><td style="text-align:left">' + tInv.length + '</td></tr>' +
                '<tr><td>⚖️ متوسط قيمة الفاتورة</td><td style="text-align:left">' + fmt(avg) + ' ج.م</td></tr>' +
                '<tr><td>📚 إجمالي الفواتير (كل الوقت)</td><td style="text-align:left">' + invoices.length + '</td></tr>' +
                '<tr><td>📦 قيمة المخزون الحالية</td><td style="text-align:left">' + fmt(totalValue) + ' ج.م</td></tr>' +
                '<tr><td>⚠️ أصناف تحت الحد (منخفض / نافذ)</td><td style="text-align:left">' + lowN + ' / ' + outN + '</td></tr>' +
                '</table>' +
                (top.length ? '<div style="font-weight:800;margin:10px 0 6px">🏆 أعلى الأصناف اليوم</div>' + top.map(([n, q]) => '<div class="ct-row"><span>' + esc(n) + '</span><span>' + q + ' قطعة</span></div>').join('') : '') +
                (sellers.length ? '<div style="font-weight:800;margin:10px 0 6px">👷 مبيعات البائعين اليوم</div>' + sellers.map(([n, v]) => '<div class="ct-row"><span>' + esc(n) + '</span><span>' + fmt(v) + ' ج.م</span></div>').join('') : '') +
                (settings.footer ? '<div style="text-align:center;color:var(--text-muted);font-size:0.78rem;margin-top:12px">' + esc(settings.footer) + '</div>' : '') +
                '<div class="modal-actions" style="margin-top:16px"><button class="btn btn-outline" onclick="printReceipt()">🖨️ طباعة التقرير</button></div>' +
            '</div>';
        document.getElementById('modal').style.display = 'flex';
    }
    function makeCsvInvoices() {
        let rows = [['رقم', 'التاريخ', 'العميل', 'البائع', 'الخصم', 'الضريبة', 'الإجمالي']];
        invoices.forEach(inv => rows.push([
            inv.no || '',
            new Date(inv.date).toLocaleString('en-EG'),
            '"' + String(inv.customer).replace(/"/g, '""') + '"',
            '"' + String(inv.user || '').replace(/"/g, '""') + '"',
            inv.discount || 0,
            inv.tax || 0,
            inv.total
        ]));
        return '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    }
    function makeCsvStock() {
        let rows = [['القسم', 'الصنف', 'السعر النصي', 'السعر الرقمي', 'المخزن', 'المعروض', 'الحد الأدنى']];
        db.forEach(c => c.items.forEach(it => rows.push([
            '"' + c.name.replace(/"/g, '""') + '"',
            '"' + it.n.replace(/"/g, '""') + '"',
            '"' + String(it.p).replace(/"/g, '""') + '"',
            itemPrice(it),
            getQ(it),
            getQs(it),
            getMin(it)
        ])));
        return '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    }
    function downloadCsv(text, name) {
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
        logAction('تصدير CSV', name);
        toast('✅ تم تصدير ' + name);
    }

    // ===== SAVE / DELETE ITEM =====
    function saveItem() {
        let cat = parseInt(document.getElementById('modal-cat').value);
        let n = document.getElementById('modal-name').value.trim();
        let p = document.getElementById('modal-price').value.trim();
        let q = parseInt(document.getElementById('modal-q').value) || 0;
        let qs = parseInt(document.getElementById('modal-qs').value) || 0;
        let b = document.getElementById('modal-barcode').value.trim();
        let pnEl = document.getElementById('modal-pn');
        let mnEl = document.getElementById('modal-min');
        if (!n || !p) return toast('يرجى إدخال الاسم والسعر!');
        let pn = pnEl && pnEl.value !== '' ? parseFloat(pnEl.value) : firstNum(p);
        if (isNaN(pn) || pn < 0) pn = firstNum(p);
        let mn = mnEl ? (parseInt(mnEl.value) || 0) : 5;

        const orig = (editingIdx >= 0 && editingCat >= 0) ? db[editingCat].items[editingIdx] : null;
        let rec = { n, p, q, qs, b, pn: pn, min: mn };
        // معالجة الصورة: dirty يعني المستخدم لمس الصورة (تغيير أو إزالة)
        if (imgState.dirty) {
            if (imgState.val) { rec.img = imgState.val; rec.imgUrl = ''; }
            else { rec.img = ''; rec.imgUrl = ''; }
        } else if (orig && orig.img) {
            rec.img = orig.img; rec.imgUrl = orig.imgUrl || '';
        }
        if (orig) { rec.lid = orig.lid; rec.cid = orig.cid; rec._ts = orig._ts; if(rec.imgUrl===undefined) rec.imgUrl = orig.imgUrl || ''; }
        else { rec.lid = genLid(); if(rec.imgUrl===undefined) rec.imgUrl=''; }

        if (editingIdx >= 0 && editingCat >= 0) {
            let wasMoved = editingCat !== cat;
            if (wasMoved) {
                db[editingCat].items.splice(editingIdx, 1);
                db[cat].items.push(rec);
                // تصحيح مراجع السلة
                invoiceCart.forEach(c => {
                    if (c.ci === editingCat && c.ii > editingIdx) c.ii--;
                    if (c.ci === editingCat && c.ii === editingIdx) { c.ci = cat; c.ii = db[cat].items.length - 1; }
                    if (c.ci > editingCat && c.ci !== cat) c.ci--;
                    if (c.ci === cat && c.ci !== editingCat && c.ii < db[cat].items.length - 1) { /* unchanged */ }
                });
            } else {
                db[cat].items[editingIdx] = rec;
            }
        } else {
            db[cat].items.push(rec);
        }
        queue({ t: (orig ? 'item-upd' : 'item-ins'), lid: rec.lid, catLid: db[cat].lid });
        logAction(editingIdx >= 0 && editingCat >= 0 ? 'تعديل صنف' : 'إضافة صنف', n);
        closeModal();
        save();
    }
    function deleteItem() {
        if (!can('del')) return toast('⚠️ حذف الأصناف للمدير فقط');
        const ci = editingCat, ii = editingIdx;
        const removed = db[ci].items.splice(ii, 1)[0];
        // 🗑️ T3.4: نحفظ نسخة كاملة قبل الحذف حتى يمكن الاستعادة
        trashPush({ type: 'item', lid: removed.lid, cid: removed.cid || null,
                    name: removed.n, catName: (db[ci] && db[ci].name) || '', catLid: db[ci] && db[ci].lid,
                    snapshot: removed });
        queue({ t: 'item-del', lid: removed.lid, cid: removed.cid });
        invoiceCart = invoiceCart.filter(c => !(c.ci === ci && c.ii === ii));
        invoiceCart.forEach(c => { if (c.ci === ci && c.ii > ii) c.ii--; });
        logAction('حذف صنف', removed.n);
        closeModal();
        save();
        toastUndo('تم حذف "' + removed.n + '"', () => {
            db[ci].items.splice(Math.min(ii, db[ci].items.length), 0, removed);
            invoiceCart.forEach(c => { if (c.ci === ci && c.ii >= ii) c.ii++; });
            save();
        });
    }

    // ===== QR SCANNING =====
    document.getElementById('scanInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const scale = Math.min(800 / img.width, 800 / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                // BarcodeDetector ناتيف أولاً (60fps) ثم jsQR fallback
                if ('BarcodeDetector' in window) {
                    try {
                        const detector = new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8','upc_a']});
                        detector.detect(canvas).then(b=>{
                            if(b.length>0 && b[0].rawValue) handleScan(b[0].rawValue);
                            else {
                                const code2 = (typeof jsQR!=='undefined') ? jsQR(imageData.data, imageData.width, imageData.height) : null;
                                handleScan(code2 ? code2.data : null);
                            }
                        }).catch(()=>{
                            const code2 = (typeof jsQR!=='undefined') ? jsQR(imageData.data, imageData.width, imageData.height) : null;
                            handleScan(code2 ? code2.data : null);
                        });
                        return;
                    } catch {}
                }
                const code = (typeof jsQR!=='undefined') ? jsQR(imageData.data, imageData.width, imageData.height) : null;
                handleScan(code ? code.data : null);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    function handleScan(data) {
        if (!data) { toast('لم يتم العثور على رمز'); return; }
        data = data.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1584));
        const nameInput = document.getElementById('modal-name');
        if (!nameInput) {
            document.getElementById('searchInput').value = data;
            renderAll();
            return;
        }
        try {
            const json = JSON.parse(data);
            nameInput.value = json.name || json.n || data;
            let priceEl = document.getElementById('modal-price');
            if (priceEl) priceEl.value = json.price || json.p || priceEl.value;
            let qEl = document.getElementById('modal-q');
            if (qEl && json.qty != null) qEl.value = json.qty;
            let bEl = document.getElementById('modal-barcode');
            if (bEl) bEl.value = data;
            toast('✅ تم تعبئة البيانات من QR!');
            return;
        } catch(e) {}
        if (data.includes(';')) {
            const parts = data.split(';').map(s => s.trim());
            nameInput.value = parts[0];
            let priceEl = document.getElementById('modal-price');
            if (priceEl && parts[1]) priceEl.value = parts[1];
            if (parts.length >= 3) {
                let qEl = document.getElementById('modal-q');
                if (qEl) qEl.value = parseInt(parts[1]) || 0;
                if (priceEl) priceEl.value = parts[2];
            }
            let bEl = document.getElementById('modal-barcode');
            if (bEl) bEl.value = data;
            toast('✅ تم تعبئة البيانات من QR!');
            return;
        }
        nameInput.value = data;
        let bEl = document.getElementById('modal-barcode');
        if (bEl) bEl.value = data;
        toast('✅ تم تعبئة الاسم من QR');
    }

    // ===== CAMERA SCAN (مسح بالكاميرا الحية) =====
    let camStream = null, camRaf = null;
    async function startCameraScan() {
        if (camStream) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('⚠️ الكاميرا غير مدعومة على هذا المتصفح');
        const box = document.createElement('div');
        box.id = 'camBox';
        box.className = 'cam-box';
        box.innerHTML = '<video id="camVideo" autoplay playsinline muted></video>' +
            '<div class="cam-hint">وجّه الكاميرا نحو الرمز — سيُقرأ تلقائياً</div>' +
            '<button class="btn btn-outline cam-close" onclick="stopCameraScan()">✕ إغلاق</button>';
        document.body.appendChild(box);
        try {
            camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        } catch (e) { stopCameraScan(); return toast('⚠️ تعذر الوصول للكاميرا — امنح الإذن وحاول تاني'); }
        const video = document.getElementById('camVideo');
        video.srcObject = camStream;
        try { await video.play(); } catch (e) {}
        const canvas = document.createElement('canvas');
        let detector=null;
        try{ if('BarcodeDetector' in window) detector=new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8','upc_a']}); }catch{}
        const tick = async () => {
            if (!camStream) return;
            if (video.videoWidth > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);
                if(detector){
                    try{
                        const barcodes = await detector.detect(canvas);
                        if(barcodes.length && barcodes[0].rawValue){ const v=barcodes[0].rawValue; stopCameraScan(); handleScan(v); return; }
                    }catch{}
                }
                const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = (typeof jsQR!=='undefined') ? jsQR(d.data, d.width, d.height) : null;
                if (code && code.data) { const val = code.data; stopCameraScan(); handleScan(val); return; }
            }
            camRaf = requestAnimationFrame(tick);
        };
        tick();
    }
    function stopCameraScan() {
        if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
        if (camRaf) { cancelAnimationFrame(camRaf); camRaf = null; }
        const box = document.getElementById('camBox');
        if (box) box.remove();
    }

    // ===== NAV =====
    document.getElementById('burgerBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        document.getElementById('burgerMenu').classList.toggle('open');
        document.getElementById('burgerOverlay').classList.toggle('open');
    });
    function closeBurger() {
        document.getElementById('burgerMenu').classList.remove('open');
        document.getElementById('burgerOverlay').classList.remove('open');
    }
    function toggleFabMenu() {
        document.getElementById('fabMenu').classList.toggle('open');
        document.getElementById('fabOverlay').classList.toggle('open');
    }

    // ===== PWA =====
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('installBtn').style.display = 'block';
    });
    document.getElementById('installBtn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') document.getElementById('installBtn').style.display = 'none';
        deferredPrompt = null;
    });
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
        let updateToastShown = false;
        function showUpdateToast() {
            if (updateToastShown) return;
            updateToastShown = true;
            const container = document.getElementById('toastContainer');
            const el = document.createElement('div');
            el.className = 'toast toast-update';
            const span = document.createElement('span');
            span.textContent = '✨ في نسخة جديدة من التطبيق — اضغط تحديث عشان تعمل بيها';
            const b = document.createElement('button');
            b.className = 'toast-reload';
            b.textContent = 'تحديث دلوقتي';
            b.onclick = () => location.reload();
            el.appendChild(span);
            el.appendChild(b);
            container.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.remove(); updateToastShown = false; }, 20000);
        }
        navigator.serviceWorker.addEventListener('controllerchange', showUpdateToast);
        navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.type === 'sw-update-ready') showUpdateToast(); });
    }

    // ===== TOAST =====
    function toast(msg, duration) {
        let container = document.getElementById('toastContainer');
        let el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => { el.remove(); }, duration || 2500);
    }

    // ===== DARK MODE =====
    function applyTheme(dark) {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
        const btn = document.getElementById('themeToggle');
        if (btn) {
            btn.textContent = dark ? '☀️' : '🌙';
            btn.setAttribute('aria-label', dark ? 'الوضع النهاري' : 'الوضع الليلي');
        }
    }
    function toggleDarkMode() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const next = !isDark;
        localStorage.setItem('al_sayed_theme', next ? 'dark' : 'light');
        applyTheme(next);
    }
    (function initTheme() {
        let saved = localStorage.getItem('al_sayed_theme');
        if (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) saved = 'dark';
        applyTheme(saved === 'dark');
    })();
    // 🧩 T5.1: measureHeader معرّفة في admin.js (ملف تالٍ) — في الملف الواحد كان الرفع
    // ينجّيها، وبعد التفكيك صار المرجع المباشر هنا ReferenceError عند التحميل.
    // التأجيل بالدالة السهمية يُبقي المعنى نفسه بلا اعتماد على ترتيب التعريف.
    window.addEventListener('resize', () => measureHeader(), { passive: true });
        // منع سحب الخلفية عند فتح الأوفرلاي (تحسين تمرير الموبايل)
        document.addEventListener('touchmove', (e) => {
            const openOverlay = document.querySelector('.cart-overlay.open, .product-detail-overlay.open, .dash-overlay.open, .lock-overlay[style*="flex"], .modal-overlay[style*="flex"]');
            if (openOverlay && !openOverlay.contains(e.target)) { /* allow */ }
        }, { passive: true });
        // هيدر يتحول عند السكرول + زر العودة للأعلى + loader
        (function(){
            const hdr=document.getElementById('appHeader'), tt=document.getElementById('toTop');
            window.addEventListener('scroll', ()=>{ const y=window.scrollY||0; if(hdr) hdr.classList.toggle('scrolled', y>40); if(tt) tt.classList.toggle('show', y>500); }, {passive:true});
            window.addEventListener('load', ()=> setTimeout(()=>{ const l=document.getElementById('loader'); if(l) l.classList.add('hide'); }, 600));
            // hide loader حتى لو load تأخر (fallback)
            setTimeout(()=>{ const l=document.getElementById('loader'); if(l) l.classList.add('hide'); }, 2500);
        })();

    // ===== EXPORT / IMPORT =====
    function exportData() {
        if (!can('exp')) return toast('⚠️ التصدير للمدير فقط');
        let data = { db: db, invoices: invoices, date: new Date().toISOString(), version: 3 };
        let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url; a.download = 'al-sayed-backup-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        toast('✅ تم تصدير البيانات بنجاح');
        closeBurger();
    }
    function importData(event) {
        if (!can('exp')) return toast('⛔ الاستيراد للمدير فقط');
        let file = event.target.files[0];
        if (!file) return;
        let reader = new FileReader();
        reader.onload = function(e) {
            try {
                let data = JSON.parse(e.target.result);
                if (!data.db || !Array.isArray(data.db)) return toast('❌ ملف غير صالح');
                if (!confirm('⚠️ هل تريد استبدال جميع البيانات الحالية؟')) return;
                db = data.db;
                db.forEach(c => c.items.forEach(item => {
                    if (item.q === undefined) item.q = 0;
                    if (item.qs === undefined) item.qs = 0;
                }));
                invoices = data.invoices || [];
                invoiceCart = [];
                save();
                saveInvoices();
                if (cloudReady()) cloudFullReplace();
                toast('✅ تم استيراد ' + db.reduce((a, c) => a + c.items.length, 0) + ' منتج بنجاح');
            } catch(err) { toast('❌ فشل استيراد الملف'); }
        };
        reader.readAsText(file);
        event.target.value = '';
    }


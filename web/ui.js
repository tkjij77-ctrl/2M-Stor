    // ===== PERSISTENCE (مع IndexedDB fallback) =====
    function save() {
        const str=JSON.stringify(db);
        try {
            localStorage.setItem('al_sayed_db', str);
        } catch (e) {
            idbSet('al_sayed_db', str);
            toast('⚠️ localStorage ممتلئ — تم الحفظ في IndexedDB');
        }
        idbSet('al_sayed_db', str);
        renderAll();
        updateCartBadge();
        updateFavBadge();
    }

    // ===== UNDO TOAST (تراجع عن الحذف) =====
    let lastUndo = null;
    function toastUndo(msg, undoFn) {
        lastUndo = undoFn;
        let container = document.getElementById('toastContainer');
        let el = document.createElement('div');
        el.className = 'toast toast-undo-wrap';
        let span = document.createElement('span');
        span.textContent = msg;
        let btn = document.createElement('button');
        btn.className = 'toast-undo';
        btn.textContent = '↩ تراجع';
        btn.onclick = () => { if (lastUndo) lastUndo(); lastUndo = null; el.remove(); };
        el.appendChild(span);
        el.appendChild(btn);
        container.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }

    // ===== MODAL =====
    function openModal(type, ci, ii) {
        if (type === 'add' && !can('add')) return toast('⚠️ إضافة الأصناف للعامل والمدير فقط');
        if (type === 'edit' && !can('edit')) { if (typeof toast === 'function') toast('⛔ التعديل للعاملين والمدير فقط'); return; }
        const modal = document.getElementById('modal');
        const body = document.getElementById('modalBody');
        editingCat = ci !== undefined ? ci : -1;
        editingIdx = ii !== undefined ? ii : -1;

        if (type === 'add') {
            imgState = { val: null, dirty: false };
            let catOpts = db.map((c, i) => '<option value="' + i + '">' + esc(c.name) + '</option>').join('');
            let imgPrev = '<span>📷</span>';
            body.innerHTML =
                '<h2>➕ إضافة <span class="accent">صنف</span> جديد</h2>' +
                '<div class="modal-section">📂 القسم</div>' +
                '<div class="form-group">' +
                    '<label>القسم</label>' +
                    '<div style="display:flex;gap:8px">' +
                        '<select id="modal-cat" style="flex:1">' + catOpts + '</select>' +
                        '<button class="btn-scan" onclick="addCategory()" title="إضافة قسم جديد" style="background:var(--success);font-size:1.2rem">＋</button>' +
                    '</div>' +
                '</div>' +
                '<div class="modal-section">📝 بيانات الصنف</div>' +
                '<div class="form-group"><label>اسم الصنف</label>' +
                    '<div class="scan-group">' +
                        '<input type="text" id="modal-name" placeholder="اسم الصنف...">' +
                        '<button class="btn-scan" onclick="document.getElementById(\'scanInput\').click()">📷</button>' +
                        '<button class="btn-scan" onclick="startCameraScan()">🎥</button>' +
                    '</div>' +
                '</div>' +
                '<div class="form-group"><label>📷 صورة الصنف — اسحب أو التقط (اختياري)</label>' +
                    '<div class="img-drop" id="img-drop" onclick="document.getElementById(\'modal-image\').click()" ondragover="event.preventDefault(); this.style.borderColor=\'var(--primary)\'; this.style.background=\'var(--primary-light)\'" ondragleave="this.style.borderColor=\'var(--border)\'; this.style.background=\'var(--bg-soft)\'" ondrop="handleDrop(event)" style="border:2px dashed var(--border);border-radius:14px;padding:14px;display:flex;gap:12px;align-items:center;cursor:pointer;background:var(--bg-soft);transition:.2s">' +
                        '<div class="img-preview" id="img-preview" style="width:92px;height:92px;border-radius:12px;border:none;background:var(--bg-card);box-shadow:var(--shadow-sm);flex-shrink:0">' + imgPrev + '</div>' +
                        '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.9rem">اسحب الصورة هنا أو اضغط للاختيار</div><div style="font-size:.75rem;color:var(--text-muted);font-weight:700;margin-top:2px">JPG/PNG — تُضغط تلقائياً • الصق (Ctrl+V) أو التقط بالكاميرا</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn btn-primary" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();document.getElementById(\'modal-image\').click()">🖼️ اختر</button><button type="button" class="btn btn-outline" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();captureProductPhoto()">📷 التقط</button><button type="button" class="btn btn-outline" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();clearImage()">🗑 إزالة</button></div></div>' +
                    '</div>' +
                    '<input type="file" id="modal-image" accept="image/*" style="display:none" onchange="handleImageFile(event)">' +
                    '<input type="text" id="modal-image-url" placeholder="أو الصق رابط صورة https://..." style="margin-top:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;width:100%;background:var(--bg-card);color:var(--text-main);font-size:.85rem" onkeydown="if(event.key===\'Enter\'){event.preventDefault();loadImageFromUrl(this.value)}" onblur="if(this.value.trim()) loadImageFromUrl(this.value.trim())">' +
                '</div>' +
                '<div class="modal-section">💰 الأسعار</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>السعر (يظهر للعميل)</label><input type="text" id="modal-price" placeholder="مثال: 50 أو 100 - 150"></div>' +
                    '<div class="form-group"><label>💵 السعر الرقمي (للحسابات)</label><input type="number" id="modal-pn" placeholder="تلقائي" min="0" step="0.5"></div>' +
                '</div>' +
                '<div class="modal-section">📦 الكميات</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>📦 في المخزن</label><input type="number" id="modal-q" value="0" min="0"></div>' +
                    '<div class="form-group"><label>🏪 معروض للبيع</label><input type="number" id="modal-qs" value="0" min="0"></div>' +
                '</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>⚠️ حد التنبيه</label><input type="number" id="modal-min" value="5" min="0"></div>' +
                    '<div class="form-group"><label>🔳 رمز QR</label><input type="text" id="modal-barcode" placeholder="تلقائي" style="direction:ltr"></div>' +
                '</div>' +
                '<div class="modal-actions">' +
                    '<button class="btn btn-outline" onclick="closeModal()">إلغاء</button>' +
                    '<button class="btn btn-primary" onclick="saveItem()">💾 حفظ</button>' +
                '</div>';
        } else if (type === 'edit' && ci >= 0 && ii >= 0) {
            let item = db[ci].items[ii];
            imgState = { val: item.img || null, dirty: false };
            let catOpts = db.map((c, i) => '<option value="' + i + '"' + (i === ci ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
            let imgPrev = imgState.val ? '<img src="' + esc(imgState.val) + '" alt="">' : '<span>📷</span>';
            body.innerHTML =
                '<h2>✏️ تعديل <span class="accent">' + esc(item.n) + '</span></h2>' +
                '<div class="modal-section">📂 القسم</div>' +
                '<div class="form-group">' +
                    '<label>القسم</label>' +
                    '<div style="display:flex;gap:8px">' +
                        '<select id="modal-cat" style="flex:1">' + catOpts + '</select>' +
                        '<button class="btn-scan" onclick="addCategory()" title="إضافة قسم جديد" style="background:var(--success);font-size:1.2rem">＋</button>' +
                    '</div>' +
                '</div>' +
                '<div class="modal-section">📝 بيانات الصنف</div>' +
                '<div class="form-group"><label>اسم الصنف</label>' +
                    '<div class="scan-group">' +
                        '<input type="text" id="modal-name" value="' + esc(item.n) + '">' +
                        '<button class="btn-scan" onclick="document.getElementById(\'scanInput\').click()">📷</button>' +
                        '<button class="btn-scan" onclick="startCameraScan()">🎥</button>' +
                    '</div>' +
                '</div>' +
                '<div class="form-group"><label>📷 صورة الصنف — اسحب أو التقط (اختياري)</label>' +
                    '<div class="img-drop" id="img-drop" onclick="document.getElementById(\'modal-image\').click()" ondragover="event.preventDefault(); this.style.borderColor=\'var(--primary)\'; this.style.background=\'var(--primary-light)\'" ondragleave="this.style.borderColor=\'var(--border)\'; this.style.background=\'var(--bg-soft)\'" ondrop="handleDrop(event)" style="border:2px dashed var(--border);border-radius:14px;padding:14px;display:flex;gap:12px;align-items:center;cursor:pointer;background:var(--bg-soft);transition:.2s">' +
                        '<div class="img-preview" id="img-preview" style="width:92px;height:92px;border-radius:12px;border:none;background:var(--bg-card);box-shadow:var(--shadow-sm);flex-shrink:0">' + imgPrev + '</div>' +
                        '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.9rem">اسحب الصورة هنا أو اضغط للاختيار</div><div style="font-size:.75rem;color:var(--text-muted);font-weight:700;margin-top:2px">JPG/PNG — تُضغط تلقائياً • الصق (Ctrl+V) أو التقط بالكاميرا</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn btn-primary" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();document.getElementById(\'modal-image\').click()">🖼️ اختر</button><button type="button" class="btn btn-outline" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();captureProductPhoto()">📷 التقط</button><button type="button" class="btn btn-outline" style="padding:8px 14px;font-size:.8rem" onclick="event.stopPropagation();clearImage()">🗑 إزالة</button></div></div>' +
                    '</div>' +
                    '<input type="file" id="modal-image" accept="image/*" style="display:none" onchange="handleImageFile(event)">' +
                    '<input type="text" id="modal-image-url" placeholder="أو الصق رابط صورة https://..." style="margin-top:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;width:100%;background:var(--bg-card);color:var(--text-main);font-size:.85rem" onkeydown="if(event.key===\'Enter\'){event.preventDefault();loadImageFromUrl(this.value)}" onblur="if(this.value.trim()) loadImageFromUrl(this.value.trim())">' +
                '</div>' +
                '<div class="modal-section">💰 الأسعار</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>السعر (يظهر للعميل)</label><input type="text" id="modal-price" value="' + esc(item.p) + '"></div>' +
                    '<div class="form-group"><label>💵 السعر الرقمي (للحسابات)</label><input type="number" id="modal-pn" value="' + itemPrice(item) + '" min="0" step="0.5"></div>' +
                '</div>' +
                '<div class="modal-section">📦 الكميات</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>📦 في المخزن</label><input type="number" id="modal-q" value="' + getQ(item) + '" min="0"></div>' +
                    '<div class="form-group"><label>🏪 معروض للبيع</label><input type="number" id="modal-qs" value="' + getQs(item) + '" min="0"></div>' +
                '</div>' +
                '<div class="form-grid-2">' +
                    '<div class="form-group"><label>⚠️ حد التنبيه</label><input type="number" id="modal-min" value="' + getMin(item) + '" min="0"></div>' +
                    '<div class="form-group"><label>🔳 رمز QR</label><input type="text" id="modal-barcode" value="' + esc(item.b || '') + '" style="direction:ltr"></div>' +
                '</div>' +
                '<div class="modal-actions between">' +
                    '<div style="display:flex;gap:8px">' +
                        '<button class="btn btn-danger" onclick="deleteItem()">🗑️ حذف</button>' +
                        '<button class="btn btn-outline" onclick="deleteCategory(' + ci + ')" style="color:#e17055;border-color:#e17055" title="حذف هذا القسم">📂 حذف القسم</button>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px">' +
                        '<button class="btn btn-outline" onclick="closeModal()">إلغاء</button>' +
                        '<button class="btn btn-primary" onclick="saveItem()">💾 حفظ</button>' +
                    '</div>' +
                '</div>';
        }
        modal.style.display = 'flex';
    }
    function closeModal() {
        document.getElementById('modal').style.display = 'none';
    }

    // ===== IMAGE UPLOAD =====
    function handleImageFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { toast('⚠️ حجم الصورة كبير جداً'); return; }
        const reader = new FileReader();
        reader.onload = function (ev) {
            const img = new Image();
            img.onload = function () {
                const max = 720;
                const scale = Math.min(max / img.width, max / img.height, 1);
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                imgState = { val: c.toDataURL('image/jpeg', 0.75), dirty: true };
                renderImagePreview();
                toast('✅ تم تجهيز الصورة — جاهزة للحفظ');
            };
            img.onerror = function () { toast('⚠️ تعذر قراءة الصورة'); };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }
    function clearImage() {
        imgState = { val: null, dirty: true };
        renderImagePreview();
    }
    function renderImagePreview() {
        const el = document.getElementById('img-preview');
        if (!el) return;
        el.innerHTML = imgState.val ? '<img src="' + esc(imgState.val) + '" alt="">' : '<span>📷</span>';
    }
    function handleDrop(e){
        e.preventDefault();
        try{ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-soft)'; }catch{}
        const file=e.dataTransfer && e.dataTransfer.files[0];
        if(file) handleImageFile({target:{files:[file], value:''}});
    }
    async function loadImageFromUrl(url){
        url=(url||'').trim(); if(!url) return;
        if(!/^https?:\/\//i.test(url)) return toast('⚠️ الرابط يجب أن يبدأ بـ https://');
        toast('⏳ جاري تحميل الصورة...');
        try{
            const img=new Image(); img.crossOrigin='anonymous';
            img.onload=()=>{
                const max=720; const scale=Math.min(max/img.width, max/img.height, 1);
                const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
                c.getContext('2d').drawImage(img,0,0,c.width,c.height);
                try{ imgState={val:c.toDataURL('image/jpeg',0.75), dirty:true}; renderImagePreview(); toast('✅ تم تحميل الصورة'); }catch{ toast('⚠️ تعذر ضغط الصورة'); }
            };
            img.onerror=()=> toast('❌ تعذر تحميل الرابط — تأكد أنه رابط صورة مباشر');
            img.src=url;
        }catch{ toast('❌ رابط غير صالح'); }
    }
    async function captureProductPhoto(){
        if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('⚠️ الكاميرا غير مدعومة');
        const box=document.createElement('div'); box.className='cam-box'; box.id='photoBox';
        box.innerHTML='<video id="photoVideo" autoplay playsinline muted style="width:100%;max-width:420px;border-radius:16px"></video><div class="cam-hint">ضع المنتج في المنتصف ثم اضغط التقاط</div><div style="display:flex;gap:10px"><button class="btn btn-primary" id="snapBtn">📷 التقاط</button><button class="btn btn-outline cam-close" onclick="closePhotoBox()">✕ إلغاء</button></div>';
        document.body.appendChild(box);
        let stream=null;
        try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); }catch{ box.remove(); return toast('⚠️ تعذر فتح الكاميرا'); }
        const video=document.getElementById('photoVideo'); video.srcObject=stream; try{ await video.play(); }catch{}
        const snapBtn=document.getElementById('snapBtn');
        const closePhotoBox=()=>{ if(stream) stream.getTracks().forEach(t=>t.stop()); const b=document.getElementById('photoBox'); if(b) b.remove(); };
        window.closePhotoBox=closePhotoBox;
        snapBtn.onclick=()=>{
            const c=document.createElement('canvas'); c.width=video.videoWidth; c.height=video.videoHeight;
            c.getContext('2d').drawImage(video,0,0);
            // قص مربع وسط
            const max=720; const scale=Math.min(max/c.width, max/c.height, 1);
            const cc=document.createElement('canvas'); cc.width=Math.max(1,Math.round(c.width*scale)); cc.height=Math.max(1,Math.round(c.height*scale));
            cc.getContext('2d').drawImage(c,0,0,cc.width,cc.height);
            try{ imgState={val:cc.toDataURL('image/jpeg',0.78), dirty:true}; renderImagePreview(); toast('✅ تم التقاط الصورة — اضغط حفظ'); }catch{ toast('⚠️ تعذر حفظ الصورة'); }
            closePhotoBox();
        };
    }
    // لصق من الحافظة (Ctrl+V) داخل المودال
    document.addEventListener('paste', (e)=>{
        const modal=document.getElementById('modal');
        if(!modal || modal.style.display==='none') return;
        const items=e.clipboardData && e.clipboardData.items;
        if(!items) return;
        for(const it of items){
            if(it.type && it.type.startsWith('image/')){
                const file=it.getAsFile();
                if(file){ e.preventDefault(); handleImageFile({target:{files:[file], value:''}}); toast('✅ تم لصق الصورة'); return; }
            }
            if(it.type==='text/plain'){
                it.getAsString(txt=>{ if(/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(txt.trim())) loadImageFromUrl(txt.trim()); });
            }
        }
    });

    // ===== CATEGORIES =====
    function addCategory() {
        if (!can('cats')) return toast('⚠️ غير مسموح');
        let name = prompt('📂 أدخل اسم القسم الجديد:');
        if (!name || !name.trim()) return;
        const nc = { name: name.trim(), items: [], lid: genLid() };
        db.push(nc);
        queue({ t: 'cat-ins', lid: nc.lid, so: db.length - 1 });
        logAction('إضافة قسم', name.trim());
        save();
        let select = document.getElementById('modal-cat');
        if (select) {
            let idx = db.length - 1;
            let opt = document.createElement('option');
            opt.value = idx; opt.textContent = name.trim();
            select.appendChild(opt);
            select.value = idx;
        }
    }
    function deleteCategory(ci) {
        if (!can('del')) return toast('⚠️ حذف الأقسام للمدير فقط');
        const cat = db[ci];
        const moved = cat.items.length;
        const hasTarget = db.length > 1;
        let target = ci === 0 ? 1 : 0;
        if (hasTarget) {
            if (!db[target]) target = 0;
            cat.items.forEach(item => db[target].items.push(item));
        }
        // 🗑️ T3.4: نحفظ القسم كاملًا (مع أصنافه) قبل الحذف
        trashPush({ type: 'cat', lid: cat.lid, cid: cat.cid || null,
                    name: cat.name, itemsCount: moved, snapshot: cat });
        db.splice(ci, 1);
        queue({ t: 'cat-del', lid: cat.lid, cid: cat.cid });
        if (moved > 0 && hasTarget) {
            const tgt = db[target];
            if (tgt) cat.items.forEach(it => queue({ t: 'item-upd', lid: it.lid, catLid: tgt.lid }));
        }
        invoiceCart = invoiceCart.filter(c => c.ci !== ci);
        invoiceCart.forEach(c => { if (c.ci > ci) c.ci--; });
        if (currentCat === ci) currentCat = 'all';
        else if (typeof currentCat === 'number' && currentCat > ci) currentCat--;
        logAction('حذف قسم', cat.name);
        closeModal();
        save();
        toastUndo('تم حذف قسم "' + cat.name + '" (منتجاته انتقلت لقسم آخر)', () => {
            if (moved > 0 && hasTarget) db[target].items.splice(-moved, moved);
            db.splice(Math.min(ci, db.length), 0, cat);
            invoiceCart.forEach(c => { if (c.ci > ci) c.ci++; });
            save();
        });
    }

    // ===== SETTINGS MODAL (الإعدادات - مدير) =====
    function openSettingsModal() {
        if (!can('dash')) return toast('⛔ الإعدادات للمدير فقط');
        const body = document.getElementById('modalBody');
        let backups = [];
        try { backups = JSON.parse(localStorage.getItem('al_sayed_backups') || '[]'); } catch (e) {}
        let backupRows = backups.map((b, i) =>
            '<div class="user-row"><div><div class="user-name">💾 ' + new Date(b.date).toLocaleString('ar-EG') + '</div><div class="user-meta">' + b.db.reduce((a, c) => a + c.items.length, 0) + ' منتج · ' + b.invoices.length + ' فاتورة</div></div>' +
            '<button class="btn btn-outline" style="padding:5px 10px;font-size:0.72rem" onclick="restoreBackup(' + i + ')">استعادة</button></div>'
        ).join('') || '<div style="font-size:0.8rem;color:var(--text-muted);font-weight:700;padding:8px">لا توجد نسخ بعد — أول نسخة تلقائية بتتعمل دلوقتي</div>';
        body.innerHTML =
            '<h2>⚙️ <span class="accent">الإعدادات</span></h2>' +
            '<div class="form-group"><label>اسم المحل (بيظهر على الإيصال)</label><input type="text" id="set-store" value="' + esc(settings.store) + '"></div>' +
            '<div class="form-group"><label>العنوان</label><input type="text" id="set-address" value="' + esc(settings.address) + '"></div>' +
            '<div class="form-group"><label>الهاتف</label><input type="text" id="set-phone" value="' + esc(settings.phone) + '" style="direction:ltr;text-align:left"></div>' +
            '<div class="form-group"><label>نص تذييل الإيصال</label><input type="text" id="set-footer" value="' + esc(settings.footer) + '"></div>' +
            // 🏪 T4.2: وصف المتجر — يظهر للزائر (كان مكتوبًا «كتب وقرطاسية» بلا أساس)
            '<div class="form-group"><label>وصف المتجر (يظهر للزائر في الرئيسية)</label><input type="text" id="set-desc" value="' + esc(settings.desc || '') + '" placeholder="مثال: أدوات ومستلزمات كهربائية"></div>' +
            // ⚖️ T4.3: سياسة الإرجاع — لا نُصدر وعدًا نيابة عنك
            '<div class="form-group"><label>⚖️ مدة الإرجاع (أيام) — 0 = لم تُحدَّد بعد</label><input type="number" id="set-returndays" value="' + (parseInt(settings.returnDays, 10) || 0) + '" min="0" max="365" step="1"></div>' +
            '<div class="form-group"><label>شروط الإرجاع الإضافية (اختياري)</label><input type="text" id="set-returnnote" value="' + esc(settings.returnNote || '') + '" placeholder="مثال: بشرط الفاتورة الأصلية"></div>' +
            '<div class="form-group"><label>نسبة الضريبة % (0 = بدون)</label><input type="number" id="set-tax" value="' + settings.tax + '" min="0" max="100" step="0.5"></div>' +
            '<div style="border-top:1px solid var(--border);margin:14px 0 8px;padding-top:10px;font-weight:800;font-size:.85rem">🛒 قواعد البيع (تنطبق على كل الأجهزة)</div>' +
            '<div class="form-group"><label>مصاريف الشحن (ج.م)</label><input type="number" id="set-shipping" value="' + (parseFloat(settings.shipping) || 0) + '" min="0" step="1"></div>' +
            '<div class="form-group"><label>شحن مجاني فوق (ج.م) — 0 = بدون</label><input type="number" id="set-freeship" value="' + (parseFloat(settings.freeShip) || 0) + '" min="0" step="10"></div>' +
            '<div class="form-group"><label>كود الخصم (فاضي = بدون كوبون)</label><input type="text" id="set-coupon" value="' + esc(String(settings.couponCode || '')) + '" style="direction:ltr;text-align:left" placeholder="مثال: 2M10"></div>' +
            '<div class="form-group"><label>نسبة خصم الكوبون %</label><input type="number" id="set-couponpct" value="' + (parseFloat(settings.couponPct) || 0) + '" min="0" max="100" step="1"></div>' +
            // 📦 T3.3: نموذج المخزون
            '<div class="form-group"><label>📦 خصم المخزون عند البيع</label>' +
            '<select id="set-stockmode">' +
                '<option value="both"' + ((settings.stockMode || 'both') === 'both' ? ' selected' : '') + '>المخزن والمعروض معًا (موصى به — جرد دقيق)</option>' +
                '<option value="display"' + (settings.stockMode === 'display' ? ' selected' : '') + '>المعروض فقط (الوضع القديم)</option>' +
                '<option value="off"' + (settings.stockMode === 'off' ? ' selected' : '') + '>لا تخصم تلقائيًا</option>' +
            '</select></div>' +
            '<div class="form-group"><label>⚠️ البيع برصيد غير كافٍ</label>' +
            '<select id="set-oversell">' +
                '<option value="warn"' + ((settings.oversell || 'warn') === 'warn' ? ' selected' : '') + '>تنبيه والسماح بالبيع</option>' +
                '<option value="block"' + (settings.oversell === 'block' ? ' selected' : '') + '>منع البيع نهائيًا</option>' +
            '</select></div>' +
            cloudSectionHtml() +
            '<div class="form-group"><label>🗄️ النسخ الاحتياطية (تلقائية يومياً — آخر 7)</label><div class="user-list">' + backupRows + '</div></div>' +
            '<div class="modal-actions between">' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button class="btn btn-outline" onclick="openSyncStatus()">🔄 حالة المزامنة' + ((outbox.length || outboxFailed.length) ? ' (' + (outbox.length + outboxFailed.length) + ')' : '') + '</button>' +
                    '<button class="btn btn-outline" onclick="openTrash()">🗑️ سلة المحذوفات</button>' +
                    '<button class="btn btn-outline" onclick="manualBackup()">💾 نسخة الآن</button>' +
                '</div>' +
                '<div style="display:flex;gap:8px">' +
                    '<button class="btn btn-outline" onclick="closeModal()">إغلاق</button>' +
                    '<button class="btn btn-primary" onclick="saveSettingsForm()">💾 حفظ</button>' +
                '</div>' +
            '</div>';
        document.getElementById('modal').style.display = 'flex';
    }
    function saveSettingsForm() {
        settings.store = document.getElementById('set-store').value.trim() || '2M-Stor';
        settings.address = document.getElementById('set-address').value.trim();
        settings.phone = document.getElementById('set-phone').value.trim();
        settings.footer = document.getElementById('set-footer').value.trim();
        settings.tax = parseFloat(document.getElementById('set-tax').value) || 0;
        // 🔧 T3.5: قواعد البيع
        settings.shipping   = parseFloat(document.getElementById('set-shipping').value) || 0;
        settings.freeShip   = parseFloat(document.getElementById('set-freeship').value) || 0;
        settings.couponCode = String(document.getElementById('set-coupon').value || '').trim().toUpperCase();
        settings.couponPct  = parseFloat(document.getElementById('set-couponpct').value) || 0;
        // 📦 T3.3: نموذج المخزون
        const descEl = document.getElementById('set-desc');
        if (descEl) settings.desc = descEl.value.trim();
        const rdEl = document.getElementById('set-returndays');
        if (rdEl) settings.returnDays = parseInt(rdEl.value, 10) || 0;
        const rnEl = document.getElementById('set-returnnote');
        if (rnEl) settings.returnNote = rnEl.value.trim();
        settings.stockMode  = document.getElementById('set-stockmode').value || 'both';
        settings.oversell   = document.getElementById('set-oversell').value || 'warn';
        saveSettings();
        queue({ t: 'set', lid: 's1', key: 'store_name', value: settings.store });
        queue({ t: 'set', lid: 's2', key: 'address', value: settings.address });
        queue({ t: 'set', lid: 's3', key: 'phone', value: settings.phone });
        queue({ t: 'set', lid: 's4', key: 'footer', value: settings.footer });
        queue({ t: 'set', lid: 's5', key: 'tax_pct', value: String(settings.tax) });
        // 🔧 T3.5: رفع قواعد البيع عند الحفظ
        queue({ t: 'set', lid: 's6', key: 'shipping_fee', value: String(settings.shipping || 0) });
        queue({ t: 'set', lid: 's7', key: 'free_shipping_over', value: String(settings.freeShip || 0) });
        queue({ t: 'set', lid: 's8', key: 'coupon_code', value: String(settings.couponCode || '') });
        queue({ t: 'set', lid: 's9', key: 'coupon_pct', value: String(settings.couponPct || 0) });
        // 📦 T3.3: رفع قواعد المخزون للسحابة (تسري على كل الأجهزة)
        queue({ t: 'set', lid: 's10', key: 'stock_mode', value: String(settings.stockMode || 'both') });
        queue({ t: 'set', lid: 's11', key: 'oversell_policy', value: String(settings.oversell || 'warn') });
        // 🏪 T4.2 + ⚖️ T4.3: الوصف وسياسة الإرجاع تسريان على كل الأجهزة
        queue({ t: 'set', lid: 's12', key: 'store_desc', value: String(settings.desc || '') });
        queue({ t: 'set', lid: 's13', key: 'return_days', value: String(settings.returnDays || 0) });
        queue({ t: 'set', lid: 's14', key: 'return_note', value: String(settings.returnNote || '') });
        logAction('تحديث الإعدادات');
        toast('✅ تم حفظ الإعدادات');
        renderAll();
    }
    // ═══════════════════════════════════════════════════════════════
    //  🔄 لوحة حالة المزامنة (T3.2) — ما لم يُرفع بعد، ولماذا
    // ═══════════════════════════════════════════════════════════════
    function openSyncStatus() {
        if (!can('dash')) return toast('⚠️ حالة المزامنة للمدير فقط');
        const body = document.getElementById('modalBody');
        const modal = document.getElementById('modal');
        modal.style.display = 'flex';

        const pendRows = outbox.map((e, i) =>
            '<div class="user-row"><div><div class="user-name">' + esc(describeEntry(e)) + '</div>' +
            '<div class="user-meta">بانتظار الرفع · محاولات: ' + (e.attempts || 0) + (e.lastError ? ' · آخر خطأ: ' + esc(e.lastError) : '') + '</div></div></div>'
        ).join('');

        const failRows = outboxFailed.map((e, i) =>
            '<div class="user-row"><div><div class="user-name">❌ ' + esc(describeEntry(e)) + '</div>' +
            '<div class="user-meta">فشلت ' + (e.attempts || 0) + ' محاولة · ' + esc(e.lastError || 'سبب غير معروف') + '</div></div></div>'
        ).join('');

        const fmtT = (ts) => { try { return new Date(ts).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

        body.innerHTML =
            '<h2>🔄 حالة <span class="accent">المزامنة</span></h2>' +
            '<div class="user-list" style="margin-bottom:12px">' +
              '<div class="user-row"><div><div class="user-name">' + (cloudReady() ? '☁️ متصل بالسحابة' : '📱 وضع محلي فقط') + '</div>' +
              '<div class="user-meta">' + (isOnline() ? 'الإنترنت متاح' : '⚠️ لا يوجد إنترنت') +
              (lastSync ? ' · آخر مزامنة: ' + esc(fmtT(lastSync)) : '') + '</div></div></div>' +
            '</div>' +

            '<div class="form-group"><label>📤 بانتظار الرفع (' + outbox.length + ')</label>' +
            '<div class="user-list">' + (pendRows || '<div style="padding:10px;font-size:.8rem;color:var(--text-muted);font-weight:700">✅ لا شيء بانتظار الرفع</div>') + '</div></div>' +

            '<div class="form-group"><label>❌ عمليات فشلت (' + outboxFailed.length + ')</label>' +
            '<div class="user-list">' + (failRows || '<div style="padding:10px;font-size:.8rem;color:var(--text-muted);font-weight:700">✅ لا عمليات فاشلة</div>') + '</div>' +
            '<p style="font-size:.72rem;color:var(--text-muted);font-weight:700;margin-top:6px">العمليات الفاشلة لا تُرفع تلقائيًا — راجع السبب ثم «أعد المحاولة»، أو تجاهلها إن كانت قديمة.</p>' +
            (outboxFailed.length ? '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
                '<button class="btn btn-primary" onclick="retryFailedOps();openSyncStatus()">🔄 أعد المحاولة</button>' +
                '<button class="btn btn-outline" onclick="clearFailedOps();openSyncStatus()">🗑️ تجاهل الكل</button></div>' : '') +
            '</div>' +

            '<div class="modal-actions between">' +
              '<button class="btn btn-outline" onclick="flushOutbox();setTimeout(openSyncStatus,600)">⬆️ ارفع الآن</button>' +
              '<button class="btn btn-outline" onclick="closeModal();openSettingsModal()">🔙 الإعدادات</button>' +
            '</div>';
    }

    // ═══════════════════════════════════════════════════════════════
    //  🗑️ واجهة سلة المحذوفات (T3.4) — استعادة أو حذف نهائي
    // ═══════════════════════════════════════════════════════════════
    async function openTrash() {
        if (!can('del')) return toast('⚠️ سلة المحذوفات للمدير فقط');
        const body = document.getElementById('modalBody');
        const modal = document.getElementById('modal');
        modal.style.display = 'flex';
        body.innerHTML = '<h2>🗑️ سلة <span class="accent">المحذوفات</span></h2><div style="text-align:center;padding:30px;color:var(--text-muted);font-weight:700">⏳ جاري التحميل...</div>';

        let local = trashList();
        let cloud = { items: [], cats: [] };
        if (cloudReady()) {
            try {
                const [ci, cc] = await Promise.all([
                    sb.from('items').select('id, name, deleted_at, category_id').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100),
                    sb.from('categories').select('id, name, deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(50)
                ]);
                cloud.items = ci.data || [];
                cloud.cats = cc.data || [];
            } catch (e) {}
        }

        const fmtD = (d) => { try { return new Date(d).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d || ''; } };
        let rows = '';

        cloud.cats.forEach(c => {
            rows += '<div class="user-row"><div><div class="user-name">📂 ' + esc(c.name) + '</div>' +
                '<div class="user-meta">قسم سحابي · حُذف ' + esc(fmtD(c.deleted_at)) + '</div></div>' +
                '<button class="btn btn-outline" style="padding:6px 12px;font-size:.75rem" onclick="restoreCloudTrash(\'cat\',' + c.id + ')">↩️ استعادة</button></div>';
        });
        cloud.items.forEach(i => {
            rows += '<div class="user-row"><div><div class="user-name">📦 ' + esc(i.name) + '</div>' +
                '<div class="user-meta">صنف سحابي · حُذف ' + esc(fmtD(i.deleted_at)) + '</div></div>' +
                '<button class="btn btn-outline" style="padding:6px 12px;font-size:.75rem" onclick="restoreCloudTrash(\'item\',' + i.id + ')">↩️ استعادة</button></div>';
        });
        local.forEach(t => {
            const isCat = t.type === 'cat';
            rows += '<div class="user-row"><div><div class="user-name">' + (isCat ? '📂 ' : '📦 ') + esc(t.name || '—') + '</div>' +
                '<div class="user-meta">' + (isCat ? 'قسم محلي' : 'صنف محلي') + ' · حُذف ' + esc(fmtD(t.deletedAt)) + (isCat && t.itemsCount ? (' · ' + t.itemsCount + ' صنف') : '') + '</div></div>' +
                '<div style="display:flex;gap:6px">' +
                '<button class="btn btn-outline" style="padding:6px 12px;font-size:.75rem" onclick="restoreLocalTrash(\'' + t.lid + '\')">↩️ استعادة</button>' +
                '<button class="btn btn-danger" style="padding:6px 12px;font-size:.75rem" onclick="purgeLocalTrash(\'' + t.lid + '\')">🗑️ نهائي</button>' +
                '</div></div>';
        });

        body.innerHTML =
            '<h2>🗑️ سلة <span class="accent">المحذوفات</span></h2>' +
            '<p style="font-size:.78rem;color:var(--text-muted);font-weight:700;margin-bottom:10px">' +
            'الحذف الآن <b>ناعم</b> — أي عنصر محذوف يمكن استعادته من هنا بدل أن يضيع نهائيًا.</p>' +
            (rows ? '<div class="user-list">' + rows + '</div>' : '<div class="empty-state"><div class="icon">✨</div>السلة فارغة — لا يوجد محذوفات</div>') +
            '<div class="modal-actions"><button class="btn btn-outline" onclick="closeModal();openSettingsModal()">🔙 الإعدادات</button></div>';
    }

    async function restoreCloudTrash(kind, id) {
        if (!cloudReady()) return toast('⚠️ استعادة السحابي تحتاج اتصال');
        const table = kind === 'cat' ? 'categories' : 'items';
        const { error } = await sb.from(table).update({ deleted_at: null }).eq('id', id);
        if (error) return toast('❌ ' + (error.message || 'فشل الاستعادة'));
        logAction('استعادة من المحذوفات', kind + ' #' + id);
        toast('✅ تمت الاستعادة — ستظهر بعد المزامنة');
        await pullAll().catch(() => {});
        openTrash();
    }

    function restoreLocalTrash(lid) {
        const arr = trashList();
        const t = arr.find(x => x.lid === lid);
        if (!t) return toast('⚠️ العنصر غير موجود');
        if (t.type === 'cat') {
            if (!t.snapshot) return toast('⚠️ لا توجد نسخة محفوظة لهذا القسم');
            // حذف القسم ينقل أصنافه لقسم آخر (لا يمحوها)، لذا نستعيد الأصناف
            // المفقودة فقط — وإلا صار لدينا نسخ مكرّرة من نفس الصنف.
            const clone = JSON.parse(JSON.stringify(t.snapshot));
            const alive = new Set();
            db.forEach(c => (c.items || []).forEach(it => { alive.add(it.lid); if (it.cid) alive.add('c' + it.cid); }));
            clone.items = (clone.items || []).filter(it => !alive.has(it.lid) && !(it.cid && alive.has('c' + it.cid)));
            db.push(clone);
            clone.items.forEach(it => queue({ t: it.cid ? 'item-upd' : 'item-ins', lid: it.lid, catLid: clone.lid }));
            if (!clone.cid) queue({ t: 'cat-ins', lid: clone.lid, so: db.length - 1 });
        } else {
            if (!t.snapshot) return toast('⚠️ لا توجد نسخة محفوظة لهذا الصنف');
            // لا نُكريّر صنفًا ما زال موجودًا
            const dup = db.some(c => (c.items || []).some(it => it.lid === lid));
            if (dup) { trashRemove(lid); toast('ℹ️ الصنف موجود بالفعل'); closeModal(); return renderAll(); }
            let cat = db.find(c => c.lid === t.catLid) || db[0];
            if (!cat) return toast('⚠️ لا يوجد قسم لاستعادة الصنف إليه');
            cat.items.push(t.snapshot);
            if (t.snapshot.cid) queue({ t: 'item-upd', lid: t.snapshot.lid, catLid: cat.lid });
            else queue({ t: 'item-ins', lid: t.snapshot.lid, catLid: cat.lid });
        }
        trashRemove(lid);
        save();
        logAction('استعادة من المحذوفات (محلي)', t.name || lid);
        toast('✅ تمت استعادة «' + (t.name || '') + '»');
        closeModal();
        renderAll();
    }

    function purgeLocalTrash(lid) {
        if (!confirm('حذف نهائي؟ لا يمكن الرجوع بعد هذه الخطوة.')) return;
        trashRemove(lid);
        toast('🗑️ تم الحذف النهائي');
        openTrash();
    }

    function manualBackup() {
        localStorage.removeItem('al_sayed_last_backup');
        autoBackup();
        toast('✅ تم إنشاء نسخة احتياطية');
        openSettingsModal();
    }
    function restoreBackup(i) {
        let backups = [];
        try { backups = JSON.parse(localStorage.getItem('al_sayed_backups') || '[]'); } catch (e) {}
        const b = backups[i];
        if (!b) return;
        if (!confirm('استعادة هذه النسخة؟ سيتم استبدال البيانات الحالية.')) return;
        db = b.db;
        invoices = b.invoices;
        invoiceCart = [];
        save();
        saveInvoices();
        logAction('استعادة نسخة احتياطية');
        toast('✅ تم الاستعادة بنجاح');
        closeModal();
    }


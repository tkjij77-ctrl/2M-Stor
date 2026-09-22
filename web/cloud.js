    // ═══════════════════════════════════════════════════════
    // ☁️ CLOUD MODULE (Supabase) — السحابة هي المصدر الأساسي
    // الرابط والمفتاح الرسميين مثبّتين هنا — التطبيق يتصل تلقائياً
    // ═══════════════════════════════════════════════════════
    const CANONICAL_CLOUD = {
      url: 'https://uzzxhbotbshsgpdnbrmd.supabase.co',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6enhoYm90YnNoc2dwZG5icm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzE3OTcsImV4cCI6MjEwMzE0Nzc5N30.SqaqCWSdU6wKRKHMEdqXD5NJ4UUfh0YAY-QEAldCllc'
    };
    let cloudCfg = (() => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('al_sayed_cloud') || 'null'); } catch (e) {}
      // شفاء أي إعداد قديم غلط محفوظ على الجهاز — الرابط الرسمي دايماً يكسب
      return { url: CANONICAL_CLOUD.url, key: CANONICAL_CLOUD.key, on: !(saved && saved.on === false) };
    })();
    localStorage.setItem('al_sayed_cloud', JSON.stringify(cloudCfg));
    let sb = null;
    let cloudProfile = null;
    let cloudStatus = 'off'; // off | on | offline | connect
    // ═══════════════════════════════════════════════════════════════
    //  🔄 T3.2 (2026-09-21) — طابور مزامنة لا يعلق ولا يُخفي الأخطاء
    //  المشاكل التي أُغلقت:
    //   1) عملية واحدة فاشلة كانت تحجز الطابور كله للأبد (head-of-line blocking)
    //   2) لا إعادة محاولة دورية: فشل عابر يترك الطابور متوقفًا حتى تغيير جديد
    //   3) لا عدّاد محاولات ولا قائمة فشل — الأخطاء كانت صامتة تمامًا
    //   4) inv-ins كانت تُنشئ فاتورة مكرّرة عند إعادة المحاولة بعد نجاح جزئي
    //   5) لا تنظيف للطابور من التعديلات المكرّرة على نفس الصنف
    // ═══════════════════════════════════════════════════════════════
    let outbox = JSON.parse(localStorage.getItem('al_sayed_outbox') || '[]');
    let outboxFailed = JSON.parse(localStorage.getItem('al_sayed_outbox_failed') || '[]');
    let pushTimer = null;
    let flushing = false;
    let lastSync = 0;
    const MAX_ATTEMPTS = 5;        // بعدها تنتقل العملية لقائمة الفشل
    const MAX_QUEUE = 800;         // سقف أمان للطابور

    function cloudReady() { return !!(cloudCfg && cloudCfg.on && cloudCfg.url && cloudCfg.key && sb); }
    function initCloudClient() {
      if (cloudCfg && cloudCfg.on && cloudCfg.url && cloudCfg.key && window.supabase) {
        try { sb = window.supabase.createClient(cloudCfg.url, cloudCfg.key); return true; } catch (e) {}
      }
      sb = null;
      return false;
    }
    function genLid() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function ensureLids() {
      let changed = false;
      db.forEach(c => {
        if (!c.lid) { c.lid = genLid(); changed = true; }
        c.items.forEach(it => { if (!it.lid) { it.lid = genLid(); changed = true; } });
      });
      invoices.forEach(inv => { if (!inv.lid) { inv.lid = genLid(); changed = true; } });
      if (changed) {
        try {
          localStorage.setItem('al_sayed_db', JSON.stringify(db));
          localStorage.setItem('al_sayed_invoices', JSON.stringify(invoices));
        } catch (e) {}
      }
    }
    function setCloudStatus(s) {
      cloudStatus = s;
      const el = document.getElementById('cloudChip');
      if (el) {
        el.style.display = 'inline-flex';
        el.textContent = s === 'on' ? '☁️ سحابي' : (s === 'offline' ? '📡 أوفلاين' : (s === 'connect' ? '⏳ جاري الاتصال' : '📱 محلي'));
      }
    }
    function isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

    // ── الـ Outbox (طابور التغييرات اللي هترحل للسحابة) ──
    function persistOutbox() {
      try {
        localStorage.setItem('al_sayed_outbox', JSON.stringify(outbox));
        localStorage.setItem('al_sayed_outbox_failed', JSON.stringify(outboxFailed));
      } catch (e) {}
    }
    // مفتاح التكرار: العمليات التي تحمل «الحالة النهائية» يمكن استبدال الأقدم فيها
    function dedupeKey(e) {
      if (e.t === 'item-upd' || e.t === 'item-ins') return 'i:' + e.lid;
      if (e.t === 'cat-upd' || e.t === 'cat-ins') return 'c:' + e.lid;
      if (e.t === 'set') return 's:' + e.key;
      if (e.t === 'inv-status') return 'v:' + e.lid;
      return null;   // الحذف والإدراج لا يُنظَّفان (ترتيبهم مهم)
    }
    function queue(entry) {
      if (!cloudReady()) return; // وضع محلي: مفيش مزامنة
      const k = dedupeKey(entry);
      if (k) {
        // لو نفس العملية في الطابور → نحدّثها بدل تكرارها (آخر حالة تكسب)
        for (let i = outbox.length - 1; i >= 0; i--) {
          if (dedupeKey(outbox[i]) === k && outbox[i].t === entry.t) outbox.splice(i, 1);
        }
      }
      entry.ts = Date.now();
      entry.attempts = 0;
      outbox.push(entry);
      if (outbox.length > MAX_QUEUE) {
        // لا نمو غير محدود: نُبلّغ المستخدم بدل أن يمتلئ التخزين بصمت
        const dropped = outbox.splice(0, outbox.length - MAX_QUEUE);
        outboxFailed.push(...dropped.slice(0, 50).map(d => Object.assign({}, d, { lastError: 'تجاوز سقف الطابور' })));
        toast('⚠️ الطابور ممتلئ — ' + dropped.length + ' عملية قديمة لم تُرفع', 5000);
      }
      persistOutbox();
      updateSyncChip();
      schedulePush();
    }
    function schedulePush() {
      if (!cloudReady()) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushOutbox, 500);
    }
    // ── Realtime: أي تعديل من المدير يظهر فوراً على كل الأجهزة ──
    let realtimeChan = null;
    function subscribeRealtime() {
      if (!sb || realtimeChan) return;
      try {
        realtimeChan = sb.channel('al-sayed-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => { pullAll(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => { pullAll(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => { pullAll(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => { pullAll(); })
          .subscribe();
      } catch (e) {}
    }
    function findLocalItem(lid) {
      for (const c of db) for (const it of c.items) if (it.lid === lid) return it;
      return null;
    }
    function findLocalCat(lid) { return db.find(c => c.lid === lid) || null; }
    function localCatByCid(cid) { return db.find(c => c.cid === cid) || null; }
    function pendingHas(lid) { return outbox.some(o => o.lid === lid); }
    function itemPayload(it, cat) {
      return {
        category_id: cat ? cat.cid : null,
        name: it.n,
        price_text: it.p,
        price_num: it.pn !== undefined ? it.pn : firstNum(it.p),
        stock_q: getQ(it),
        display_qs: getQs(it),
        min_alert: getMin(it),
        barcode: it.b || null,
        image_url: it.imgUrl || null
      };
    }

    // ── رفع صورة الصنف لـ Storage (مضغوطة 1024px 0.7) ──
    async function compressImageDataUrl(dataUrl, maxW = 1024, quality = 0.7) {
      return new Promise((resolve) => {
        if (!dataUrl || !dataUrl.startsWith('data:image')) return resolve(dataUrl);
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', quality)); } catch (e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
    }
    async function uploadItemImage(item) {
      if (!item.img) return null;
      try {
        let dataUrl = item.img;
        if (dataUrl.startsWith('data:image')) dataUrl = await compressImageDataUrl(dataUrl, 1024, 0.7);
        const blob = await (await fetch(dataUrl)).blob();
        const path = item.lid + '.jpg';
        const { error } = await sb.storage.from('products').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) return null;
        return sb.storage.from('products').getPublicUrl(path).data.publicUrl;
      } catch (e) { return null; }
    }

    // ── تنفيذ إدخال من الطابور على السحابة ──
    async function applyEntry(e) {
      if (e.t === 'cat-ins') {
        const c = findLocalCat(e.lid); if (!c || c.cid) return;
        const { data, error } = await sb.from('categories').insert({ name: c.name, sort_order: e.so || 0 }).select().single();
        if (error) throw error;
        c.cid = data.id; c._ts = data.updated_at;
      } else if (e.t === 'cat-upd') {
        const c = findLocalCat(e.lid); if (!c || !c.cid) return;
        // 🐞 إصلاح (تدقيق المدير 2026-09-22): نفس عطل الأصناف — استعادة قسم محذوف
        // كانت تُبقي deleted_at عليه فيُمسح محليًا عند أول مزامنة.
        const { error } = await sb.from('categories').update({ name: c.name, deleted_at: null }).eq('id', c.cid);
        if (error) throw error;
      } else if (e.t === 'cat-del') {
        if (!e.cid) return;
        // 🔒 T3.4 (2026-09-21): حذف ناعم للأقسام — كان الحذف النهائي يمحو
        // كل أصناف القسم تلقائيًا (references ... on delete cascade) بلا رجعة.
        const { error } = await sb.from('categories')
          .update({ deleted_at: new Date().toISOString() }).eq('id', e.cid);
        if (error) throw error;
      } else if (e.t === 'item-ins') {
        const it = findLocalItem(e.lid); if (!it || it.cid) return;
        const cat = findLocalCat(e.catLid);
        // لو القسم لسه في الطابور (لسه ما اتسند cid) → نرجّع الصنف لآخر الطابور ونستنا
        // push (مش unshift) عشان ميدخلش حلقة لا نهائية في flushOutbox
        if (cat && !cat.cid && outbox.some(o => o.t === 'cat-ins' && o.lid === e.catLid)) {
          outbox.push(e);
          return;
        }
        if (it.img && !it.imgUrl) it.imgUrl = await uploadItemImage(it);
        const { data, error } = await sb.from('items').insert(itemPayload(it, cat)).select().single();
        if (error) throw error;
        it.cid = data.id; it._ts = data.updated_at;
      } else if (e.t === 'item-upd') {
        const it = findLocalItem(e.lid); if (!it) return;
        if (!it.cid) { queue({ t: 'item-ins', lid: it.lid, catLid: e.catLid }); return; }
        const cat = findLocalCat(e.catLid);
        if (it.img && !it.imgUrl) it.imgUrl = await uploadItemImage(it);
        // 🐞 إصلاح (تدقيق المدير 2026-09-22): `itemPayload` لا تحمل deleted_at، فكان
        // تعديل صنف مُستعاد من «سلة المحذوفات» يُبقي deleted_at عليه على السحابة ⇒
        // المزامنة التالية ترى الصنف محذوفًا فتمسحه محليًا (الاستعادة تنقلب بلا رسالة).
        // الحل: أي تعديل لصنف موجود محليًا = إحياء صريح له على السحابة.
        const { error } = await sb.from('items').update({ ...itemPayload(it, cat), deleted_at: null }).eq('id', it.cid);
        if (error) throw error;
      } else if (e.t === 'item-del') {
        if (!e.cid) return;
        // 🔒 T3.4 (2026-09-21): حذف ناعم بدل الحذف النهائي.
        // السبب: الحذف النهائي لا رجعة فيه (ولا يوجد Versioning على الخطة المجانية)،
        // وحذف قسم بالخطأ كان يمحو كل أصنافه عبر ON DELETE CASCADE.
        // الآن: deleted_at = وقت الحذف، ويمكن الاستعادة من «سلة المحذوفات».
        const { error } = await sb.from('items')
          .update({ deleted_at: new Date().toISOString() }).eq('id', e.cid);
        if (error) throw error;
      } else if (e.t === 'inv-ins') {
        const inv = invoices.find(x => x.lid === e.lid);
        if (!inv || inv.cid) return;
        let invNo = inv.no || invCounter;
        let lastErr = null;
        // 🔄 T3.2: قبل الإدراج، شوف الفاتورة دي موجودة فعلًا؟ (نجاح جزئي سابق)
        // بدونها: إعادة المحاولة تصطدم بـunique(invoice_no) وتعلق الطابور للأبد.
        try {
          const { data: exist } = await sb.from('invoices').select('id').eq('invoice_no', invNo).maybeSingle();
          if (exist && exist.id) { inv.cid = exist.id; return; }
        } catch (e) {}
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error } = await sb.from('invoices').insert({
            invoice_no: invNo, customer_name: inv.customer,
            seller_id: cloudProfile ? cloudProfile.id : null,
            subtotal: inv.subtotal || 0, discount: inv.discount || 0,
            tax: inv.tax || 0, total: inv.total, status: inv.status || 'قيد المعالجة',
            // 📦 T3.3: هل خُصم مخزون هذه الفاتورة؟ (يمنع الخصم/الاسترجاع المزدوج بين الأجهزة)
            stock_applied: inv.stockApplied || null
          }).select().single();
          if (!error) {
            inv.cid = data.id;
            // 🔢 T3.1: السيرفر قد يصحّح الرقم إن كان محجوزًا على جهاز آخر
            if (data.invoice_no && data.invoice_no !== inv.no) {
              logAction('تصحيح رقم فاتورة', '#' + inv.no + ' → #' + data.invoice_no);
              inv.no = data.invoice_no;
              if (inv.no > invCounter) { invCounter = inv.no; localStorage.setItem('al_sayed_invno', String(invCounter)); }
            }
            inv.noTemp = false;
            saveInvoices();
            if (inv.items && inv.items.length > 0) {
              const rows = inv.items.map(it => ({
                invoice_id: data.id,
                item_name: it.name,
                category_name: it.cat || null,
                qty: it.qty,
                price: it.price
              }));
              const { error: itemsErr } = await sb.from('invoice_items').insert(rows);
              if (itemsErr) throw itemsErr;
            }
            return;
          }
          lastErr = error;
          if (/duplicate key/i.test(error.message || String(error))) { invNo++; inv.no = invNo; continue; }
          throw error;
        }
        throw lastErr;
      } else if (e.t === 'inv-del') {
        if (!e.cid) return;
        const { error } = await sb.from('invoices').delete().eq('id', e.cid);
        if (error) throw error;
      } else if (e.t === 'inv-status') {
        if (!e.cid) return;
        const invLoc = invoices.find(x => x.lid === e.lid);
        const patch = { status: e.status, updated_at: new Date().toISOString() };
        // 📦 T3.3: نُبلّغ السحابة أن الكميات رُجعت (أو أُعيد خصمها)
        if (invLoc) patch.stock_applied = invLoc.stockApplied || null;
        const { error } = await sb.from('invoices').update(patch).eq('id', e.cid);
        if (error) {
          if(/column.*status/i.test(error.message)) return;
          throw error;
        }
      } else if (e.t === 'set') {
        const { error } = await sb.from('settings').upsert({ key: e.key, value: e.value });
        if (error) throw error;
      }
    }

    // خطأ دائم (خطأ في البيانات) أم عابر (شبكة/سيرفر)؟
    // الفرق مهم: العابر يُعاد ترتيبه، والدائم ينتقل لقائمة الفشل فلا يعلّق الطابور.
    function classifyError(err) {
      const msg = String((err && (err.message || err.error_description || err.details)) || err || '');
      const code = String((err && (err.code || err.status)) || '');
      if (/Failed to fetch|NetworkError|network|timeout|timed out|fetch failed|Load failed|ERR_/i.test(msg)) return 'transient';
      if (/^5\d\d$/.test(code)) return 'transient';
      if (code === '429') return 'transient';
      if (/JWT|token|refresh|expired/i.test(msg)) return 'transient';
      if (code === '23505' || /duplicate key|unique constraint/i.test(msg)) return 'permanent';
      if (/column .* does not exist|could not find the .* column|schema cache/i.test(msg)) return 'permanent';
      if (code === '23503' || /foreign key/i.test(msg)) return 'permanent';
      if (code === '42P01' || /relation .* does not exist/i.test(msg)) return 'permanent';
      if (/permission denied|violates row-level security|42501/i.test(msg)) return 'permanent';
      return 'permanent';   // الاحتياط: لا نعيد محاولة شيء مجهول للأبد
    }
    function describeEntry(e) {
      const names = { 'cat-ins':'إضافة قسم', 'cat-upd':'تعديل قسم', 'cat-del':'حذف قسم',
                      'item-ins':'إضافة صنف', 'item-upd':'تعديل صنف', 'item-del':'حذف صنف',
                      'inv-ins':'فاتورة جديدة', 'inv-del':'حذف فاتورة', 'inv-status':'حالة طلب', 'set':'إعداد' };
      return (names[e.t] || e.t) + (e.key ? ' (' + e.key + ')' : '');
    }

    // ── تفريغ الطابور (دفع التغييرات للسحابة) ──
    async function flushOutbox() {
      if (!cloudReady()) return;
      if (!isOnline()) { setCloudStatus('offline'); return; }
      if (outbox.length === 0) { if (cloudStatus === 'offline') setCloudStatus('on'); return; }
      if (flushing) return; // حلقة تانية شغالة — هتخلص هي
      flushing = true;
      setCloudStatus('on');
      let transientHit = false;
      while (outbox.length > 0) {
        const e = outbox.shift();
        persistOutbox();
        try {
          await applyEntry(e);
          e.attempts = 0;
        } catch (err) {
          const kind = classifyError(err);
          e.attempts = (e.attempts || 0) + 1;
          e.lastError = String((err && (err.message || err.details)) || err).slice(0, 200);
          if (kind === 'transient' && e.attempts < MAX_ATTEMPTS) {
            // عابر: نحفظ الترتيب ونعود لاحقًا (لا نحرق الطابور)
            outbox.unshift(e);
            persistOutbox();
            setCloudStatus('offline');
            transientHit = true;
            break;
          }
          if (e.attempts >= MAX_ATTEMPTS || kind === 'permanent') {
            // 🛑 لا يعلّق الطابور: ينتقل لقائمة الفشل مع سبب واضح
            outboxFailed.push(Object.assign({}, e, { failedAt: Date.now() }));
            if (outboxFailed.length > 100) outboxFailed = outboxFailed.slice(-100);
            persistOutbox();
            console.warn('[outbox] فشلت العملية ونُقلت لقائمة الفشل:', describeEntry(e), e.lastError);
          } else {
            outbox.push(e);   // عابر مع محاولات متبقية → آخره ليكمل الباقي
          }
        }
      }
      flushing = false;
      persistOutbox();
      updateSyncChip();
      // إعادة محاولة تلقائية بتأخير متزايد — بدل انتظار تغيير جديد من المستخدم
      if (outbox.length > 0) {
        const tries = Math.max(...outbox.map(x => x.attempts || 0), 0);
        const delay = Math.min(60000, 3000 * Math.pow(2, tries));
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => { if (isOnline()) flushOutbox(); }, delay);
      }
      if (!transientHit) pullAll().catch(() => {});
    }

    // ── مؤشر «عملية لم تُرفع» في الشريط العلوي ──
    function updateSyncChip() {
      const el = document.getElementById('cloudChip');
      if (!el) return;
      const pend = outbox.length, failed = outboxFailed.length;
      if (failed > 0) { el.textContent = '⚠️ ' + failed + ' عملية فشلت'; el.style.color = 'var(--danger)'; el.style.display = 'inline-flex'; return; }
      el.style.color = '';
      if (pend > 0) { el.textContent = '⏳ ' + pend + ' بانتظار الرفع'; el.style.display = 'inline-flex'; return; }
      setCloudStatus(cloudStatus);
    }

    // ── إعادة المحاولة اليدوية لقائمة الفشل ──
    function retryFailedOps() {
      if (!outboxFailed.length) return toast('✅ لا توجد عمليات فاشلة');
      const n = outboxFailed.length;
      outbox.push(...outboxFailed.map(f => {
        const c = Object.assign({}, f); c.attempts = 0; delete c.failedAt; delete c.lastError; return c;
      }));
      outboxFailed = [];
      persistOutbox();
      updateSyncChip();
      toast('🔄 أُعيدت ' + n + ' عملية للطابور');
      flushOutbox();
    }
    function clearFailedOps() {
      if (!outboxFailed.length) return;
      if (!confirm('تجاهل ' + outboxFailed.length + ' عملية فشلت نهائيًا؟ لن تُرفع للسحابة.')) return;
      logAction('تجاهل عمليات مزامنة فاشلة', String(outboxFailed.length));
      outboxFailed = [];
      persistOutbox();
      updateSyncChip();
      toast('🗑️ تم تجاهل العمليات الفاشلة');
    }

    // ── سحب البيانات من السحابة ودمجها (الأحدث يربح، والمتغيّر محلياً له الأولوية) ──
    async function pullAll() {
      if (!cloudReady()) return;
      if (!isOnline()) { setCloudStatus('offline'); return; }
      try {
        let invoicesQuery = sb.from('invoices').select('*, invoice_items(*), profiles(username)');
        if (sessionRole === 'customer' && sessionUser) {
          // العميل يرى طلباته فقط (customer_name = اسم العميل)
          invoicesQuery = invoicesQuery.eq('customer_name', sessionUser);
        } else if (sessionRole === 'worker' && cloudProfile?.id) {
          // العامل يرى طلباته فقط (seller_id)
          invoicesQuery = invoicesQuery.eq('seller_id', cloudProfile.id);
        }
        // admin: يرى الكل (لا فلترة إضافية)
        const [catsR, itemsR, invsR, setsR] = await Promise.all([
          sb.from('categories').select('*'),
          sb.from('items').select('*'),
          invoicesQuery,
          sb.from('settings').select('*')
        ]);
        if (catsR.error) throw catsR.error;
        // 🗑️ T3.4: نستبعد المحذوف ناعمًا — وإلا عاد للظهور بعد كل مزامنة
        const aliveCats = (catsR.data || []).filter(r => !r.deleted_at);
        const aliveItems = (itemsR.data || []).filter(r => !r.deleted_at);
        mergeCats(aliveCats);
        mergeItems(aliveItems);
        mergeInvoices(invsR.data || []);
        mergeSettings(setsR.data || []);
        lastSync = Date.now();
        setCloudStatus('on');
        try {
          localStorage.setItem('al_sayed_db', JSON.stringify(db));
          localStorage.setItem('al_sayed_invoices', JSON.stringify(invoices));
        } catch (e) {}
        renderAll();
        updateCartBadge();
      } catch (e) { setCloudStatus('offline'); }
    }
    function mergeCats(remote) {
      const alive = new Set(remote.filter(r=>!r.deleted_at).map(r=>r.id));
      // احذف محلياً الأقسام المحذوفة على السحابة (المكررة 455→229)
      for(let i=db.length-1;i>=0;i--) if(db[i].cid && !alive.has(db[i].cid) && !pendingHas(db[i].lid)) db.splice(i,1);
      for (const rc of remote) {
        if (rc.deleted_at) continue;
        let lc = localCatByCid(rc.id);
        if (!lc) {
          db.push({ name: rc.name, lid: genLid(), cid: rc.id, _ts: rc.updated_at, items: [] });
        } else if (!pendingHas(lc.lid) && rc.updated_at && (!lc._ts || rc.updated_at > lc._ts)) {
          lc.name = rc.name; lc._ts = rc.updated_at;
        }
      }
    }
    function mergeItems(remote) {
      const alive = new Set(remote.filter(r=>!r.deleted_at).map(r=>r.id));
      // احذف محلياً المنتجات المحذوفة (تكرار 455→229) — إصلاح فوري للصورة
      for(const c of db) for(let i=c.items.length-1;i>=0;i--) if(c.items[i].cid && !alive.has(c.items[i].cid) && !pendingHas(c.items[i].lid)) c.items.splice(i,1);
      // نظف التكرار المحلي بالاسم داخل نفس القسم (لو لسه 455)
      for(const c of db){
        const seen=new Set(); for(let i=c.items.length-1;i>=0;i--){ const k=c.items[i].n.trim(); if(seen.has(k)) c.items.splice(i,1); else seen.add(k); }
      }
      for (const ri of remote) {
        if (ri.deleted_at) continue;
        let owner = null, local = null;
        for (const c of db) for (const it of c.items) if (it.cid === ri.id) { owner = c; local = it; break; }
        if (!local) {
          let cat = localCatByCid(ri.category_id);
          if (!cat) continue;
          cat.items.push({
            n: ri.name, p: ri.price_text, pn: ri.price_num, q: ri.stock_q, qs: ri.display_qs,
            min: ri.min_alert, b: ri.barcode || '', img: ri.image_url || '', imgUrl: ri.image_url || '',
            lid: genLid(), cid: ri.id, _ts: ri.updated_at
          });
        } else if (!pendingHas(local.lid) && ri.updated_at && (!local._ts || ri.updated_at > local._ts)) {
          const targetCat = localCatByCid(ri.category_id) || owner;
          if (targetCat !== owner) { owner.items.splice(owner.items.indexOf(local), 1); targetCat.items.push(local); }
          local.n = ri.name; local.p = ri.price_text; local.pn = ri.price_num;
          local.q = ri.stock_q; local.qs = ri.display_qs; local.min = ri.min_alert;
          local.b = ri.barcode || '';
          if (ri.image_url !== undefined) { local.img = ri.image_url || ''; local.imgUrl = ri.image_url || ''; }
          local._ts = ri.updated_at;
        }
      }
    }
    function mergeInvoices(remote) {
      for (const ri of remote) {
        const existing = invoices.find(x => x.cid === ri.id);
        if (existing) {
          if (ri.status && ri.status !== existing.status && !outbox.some(o=> o.t==='inv-status' && o.cid===ri.id)) {
            existing.status = ri.status;
          }
          if (ri.updated_at && (!existing.updated_at || ri.updated_at > existing.updated_at)) existing.updated_at = ri.updated_at;
          if (ri.stock_applied !== undefined && !outbox.some(o => o.t === 'inv-status' && o.cid === ri.id)) {
            existing.stockApplied = ri.stock_applied || false;
          }
          if (ri.status && !existing.status) existing.status = ri.status;
          continue;
        }
        invoices.push({
          id: ri.id, lid: genLid(), cid: ri.id, no: ri.invoice_no, date: ri.created_at,
          customer: ri.customer_name, user: (ri.profiles && ri.profiles.username) || '—',
          items: (ri.invoice_items || []).map(x => ({ name: x.item_name, cat: x.category_name, qty: x.qty, price: x.price })),
          subtotal: ri.subtotal, discount: ri.discount, tax: ri.tax, total: ri.total, status: ri.status || 'قيد المعالجة', updated_at: ri.updated_at || ri.created_at,
          stockApplied: ri.stock_applied || false
        });
      }
      const maxNo = remote.reduce((m, r) => Math.max(m, r.invoice_no || 0), 0);
      if (maxNo > invCounter) { invCounter = maxNo; localStorage.setItem('al_sayed_invno', String(invCounter)); }
    }
    function mergeSettings(remote) {
      const map = {
        store_name: 'store', address: 'address', phone: 'phone', footer: 'footer', tax_pct: 'tax',
        // 🔧 T3.5: قواعد البيع من السحابة — تتغير لكل الأجهزة معًا
        store_desc: 'desc', return_days: 'returnDays', return_note: 'returnNote',
        shipping_fee: 'shipping', free_shipping_over: 'freeShip',
        coupon_code: 'couponCode', coupon_pct: 'couponPct',
        // 📦 T3.3: قواعد المخزون
        stock_mode: 'stockMode', oversell_policy: 'oversell'
      };
      const numeric = { tax_pct: 1, shipping_fee: 1, free_shipping_over: 1, coupon_pct: 1 };
      for (const rs of remote) {
        if (rs.key === 'role_perms') {
          try {
            const cp = JSON.parse(rs.value);
            if (cp && typeof cp === 'object' && !Array.isArray(cp)) {
              customPerms = cp;
              try { localStorage.setItem('al_sayed_role_perms', rs.value); } catch (e) {}
            }
          } catch (e) {}
          continue;
        }
        if (map[rs.key] === undefined) continue;
        settings[map[rs.key]] = numeric[rs.key] ? (parseFloat(rs.value) || 0) : rs.value;
      }
    }

    // ── ترحيل البيانات المحلية لأول مرة ──
    function migrateIfNeeded() {
      if (!cloudReady()) return;
      if (dbIsFactory) return; // بيانات المصنع مش دي المصدر — متُرفعش qs=0 للسحابة
      let n = 0;
      db.forEach((c, i) => {
        if (!c.cid) { queue({ t: 'cat-ins', lid: c.lid, so: i }); n++; }
        c.items.forEach(it => {
          if (!it.cid) { queue({ t: 'item-ins', lid: it.lid, catLid: c.lid }); n++; }
        });
      });
      invoices.forEach(inv => { if (!inv.cid) { queue({ t: 'inv-ins', lid: inv.lid }); n++; } });
      if (!localStorage.getItem('al_sayed_settings_synced')) {
        queue({ t: 'set', lid: 's1', key: 'store_name', value: settings.store });
        queue({ t: 'set', lid: 's2', key: 'address', value: settings.address });
        queue({ t: 'set', lid: 's3', key: 'phone', value: settings.phone });
        queue({ t: 'set', lid: 's4', key: 'footer', value: settings.footer });
        queue({ t: 'set', lid: 's5', key: 'tax_pct', value: String(settings.tax) });
        // 🔧 T3.5: رفع قواعد البيع في الترحيل الأول أيضًا
        queue({ t: 'set', lid: 's6', key: 'shipping_fee', value: String(settings.shipping || 0) });
        queue({ t: 'set', lid: 's7', key: 'free_shipping_over', value: String(settings.freeShip || 0) });
        queue({ t: 'set', lid: 's8', key: 'coupon_code', value: String(settings.couponCode || '') });
        queue({ t: 'set', lid: 's9', key: 'coupon_pct', value: String(settings.couponPct || 0) });
        // 📦 T3.3: قواعد المخزون في الترحيل الأول أيضًا
        queue({ t: 'set', lid: 's10', key: 'stock_mode', value: String(settings.stockMode || 'both') });
        queue({ t: 'set', lid: 's11', key: 'oversell_policy', value: String(settings.oversell || 'warn') });
        // 🏪 T4.2 + ⚖️ T4.3: الوصف وسياسة الإرجاع تسريان على كل الأجهزة
        queue({ t: 'set', lid: 's12', key: 'store_desc', value: String(settings.desc || '') });
        queue({ t: 'set', lid: 's13', key: 'return_days', value: String(settings.returnDays || 0) });
        queue({ t: 'set', lid: 's14', key: 'return_note', value: String(settings.returnNote || '') });
        if (Object.keys(customPerms).length > 0) queue({ t: 'set', lid: 'rp0', key: 'role_perms', value: JSON.stringify(customPerms) });
        localStorage.setItem('al_sayed_settings_synced', '1');
        n += 5;
      }
      if (n > 0) toast('☁️ يتم ترحيل ' + n + ' عنصر إلى Supabase...');
    }

    // ── رفع المتجر للسحابة (يحدّث الكميات المعروضة على كل الأجهزة) ──
    async function pushStoreToCloud() {
      if (!cloudReady()) return loginErr('⚠️ الاتصال بالسحابة مش متاح');
      if (!confirm('☁️ ده هيرفع بياناتك المحلية (الأقسام + الأصناف + الكميات المعروضة) للسحابة ويحدّثها على كل الأجهزة. متابعة؟')) return;
      await cloudFullReplace();
      toast('✅ تم رفع المتجر للسحابة — الكميات المعروضة هتظهر على التليفون دلوقتي');
      openSettingsModal();
    }

    // ── استيراد كامل: يستبدل السحابة بالبيانات المحلية ──
    // 🔒 T3.4 (2026-09-21): كان هذا الزر **يمسح نهائيًا** كل الفواتير
    // والأصناف والأقسام من السحابة (delete) بضغطة وتأكيد واحد — وبيانات
    // جهاز آخر تختفي بلا رجعة. الآن: أرشفة (حذف ناعم قابل للاستعادة)،
    // والفواتير لا تُمسّ إطلاقًا، مع تأكيد مزدوج ونسخة احتياطية قبل التنفيذ.
    async function cloudFullReplace() {
      if (!cloudReady()) return;
      if (!can('dash')) return toast('⚠️ استبدال بيانات السحابة للمدير فقط');

      const localCats  = db.length;
      const localItems = db.reduce((n, c) => n + (c.items || []).length, 0);
      if (localItems === 0) return toast('⚠️ لا توجد أصناف محلية لرفعها');

      const warnMsg =
        '⚠️⚠️ عملية كبيرة — استبدال بيانات السحابة\n\n' +
        'ماذا سيحدث:\n' +
        '  • كل الأقسام والأصناف الحالية على السحابة تُؤرشف (حذف ناعم) — تُستعاد من «سلة المحذوفات»\n' +
        '  • تُرفع بيانات هذا الجهاز: ' + localCats + ' قسم · ' + localItems + ' صنف\n' +
        '  • أي جهاز آخر لم يزامن تعديلاته قد يفقد تعديلات لم تُرفع بعد\n' +
        '  • ✅ الفواتير لا تُمسّ إطلاقًا (سجلات مالية)\n\n' +
        'اكتب كلمة «استبدال» للمتابعة:';
      const typed = prompt(warnMsg);
      if (typed !== 'استبدال') return toast('⛔ أُلغيت العملية — لم يُمسّ شيء');

      // نسخة احتياطية محلية قبل أي تغيير
      try { autoBackup(); } catch (e) {}
      toast('☁️ جاري الاستبدال...');

      try {
        const now = new Date().toISOString();
        // أرشفة بدل المسح — الحذف ناعم فيمكن الاسترجاع
        await sb.from('items').update({ deleted_at: now }).is('deleted_at', null);
        await sb.from('categories').update({ deleted_at: now }).is('deleted_at', null);

        // فك ارتباط المعرّفات السحابية فقط (الفواتير تبقى كما هي)
        db.forEach(c => { delete c.cid; c._ts = null; c.items.forEach(it => { delete it.cid; it._ts = null; }); });
        logAction('استبدال بيانات السحابة (أرشفة + رفع)', localCats + ' قسم · ' + localItems + ' صنف');
        migrateIfNeeded();
        toast('✅ تم — البيانات المرفوعة الآن على السحابة، والقديمة في «سلة المحذوفات»', 5000);
      } catch (e) { toast('❌ فشل استبدال بيانات السحابة: ' + (e.message || '')); }
    }

    // ── مصادقة سحابية ──
    function hideLoginNote() {
      const e = document.getElementById('loginError'); if (e) { e.style.display = 'none'; e.textContent = ''; }
      const o = document.getElementById('loginOk'); if (o) { o.style.display = 'none'; o.textContent = ''; }
    }
    function loginErr(msg) {
      const e = document.getElementById('loginError');
      if (!e) return;
      const o = document.getElementById('loginOk'); if (o) o.style.display = 'none';
      e.textContent = msg; e.style.display = 'block';
      try { const c = document.getElementById('loginCard'); if (c && c.classList) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } } catch (err) {}
    }
    function loginOk(msg) {
      const o = document.getElementById('loginOk');
      if (!o) return;
      const e = document.getElementById('loginError'); if (e) e.style.display = 'none';
      o.textContent = msg; o.style.display = 'block';
    }
    async function fetchCloudProfile(uid) {
      try {
        const { data } = await sb.from('profiles').select('*').eq('id', uid).single();
        return data || null;
      } catch (e) { return null; }
    }
    async function onCloudSession(session) {
      if (!session) return;
      setCloudStatus('connect'); // مربوط بالسحابة فوراً — مش أوفلاين
      cloudProfile = await fetchCloudProfile(session.user.id);
      if (!cloudProfile) cloudProfile = { id: session.user.id, username: session.user.email, display_name: session.user.email, role: 'customer' };
      sessionUser = cloudProfile.username;
      sessionRole = cloudProfile.role || 'customer';
      logAction('تسجيل دخول (سحابي)', sessionUser);
      ensureLids();
      afterLogin();
      // جهاز جديد/بيانات مصنع: السحابة هي المصدر الوحيد — متُرفعش بيانات وهمية qs=0
      subscribeRealtime();
      if (dbIsFactory) { db = []; }
      else { migrateIfNeeded(); }
      flushOutbox();
      await pullAll(); // سحب فوري يظهر المتجر مباشرة
    }
    async function cloudDoLogin() {
      hideLoginNote();
      const email = (document.getElementById('cl-email').value || '').trim();
      const pw = document.getElementById('cl-pass').value;
      if (!email || !pw) return loginErr('✍️ اكتب الإيميل وكلمة المرور');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return loginErr('✍️ الإيميل غير صحيح — مثال: name@gmail.com');
      if (!sb && !initCloudClient()) return loginErr('⚠️ الاتصال بالسحابة مش جاهز — اتأكد من الإنترنت وحاول تاني');
      const btn = document.getElementById('btnCloudLogin');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحقق...'; }
      try {
        const cloudGate = await gateBeforeLogin(email);
        if (cloudGate.block) { loginErr('⛔ ' + cloudGate.message); loginShake(); return; }
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) {
          let msg = error.message || 'خطأ في الدخول', extra = '';
          const g = await serverFail(email);
          if (/Invalid login credentials/i.test(msg)) {
            msg = '❌ الإيميل أو كلمة المرور غير صحيحة';
            extra = (g && !g.allowed) ? ' · ' + lockMessage(g.seconds, g.scope)
                  : (g && typeof g.left === 'number') ? ' — بقي ' + g.left + ' محاولات' : '';
            loginShake();
          } else if (/Email not confirmed/i.test(msg)) {
            msg = '📧 الإيميل غير مؤكد — افتح رابط التأكيد في بريدك ثم حاول تاني';
          } else if (/Too many requests|rate limit/i.test(msg)) {
            msg = '⏳ محاولات كثيرة — استنى دقيقة وحاول تاني';
          } else if (/Failed to fetch|Network|network/i.test(msg)) {
            msg = '📡 مشكلة في الاتصال — راجع الإنترنت وحاول تاني';
          } else { msg = '❌ ' + msg; }
          return loginErr(msg + extra);
        }
        await serverOk(email);
        await onCloudSession(data.session);
        return true;
      } catch (e) {
        return loginErr('❌ خطأ غير متوقع: ' + ((e && e.message) ? e.message : 'حاول تاني'));
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔓 تسجيل الدخول'; }
      }
    }
    async function cloudDoRegister() {
      hideLoginNote();
      const username = (document.getElementById('reg-username').value || '').trim();
      const name = (document.getElementById('reg-name2').value || '').trim();
      const email = (document.getElementById('reg-email').value || '').trim();
      const pw = document.getElementById('reg-pass2').value;
      if (username.length < 2) { loginErr('✍️ اكتب اسم المستخدم (حرفان على الأقل)'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { loginErr('✍️ اكتب إيميل صحيح — مثال: name@gmail.com'); return; }
      if (pw.length < 6) { loginErr('🔑 كلمة المرور 6 أحرف على الأقل'); return; }
      if (!sb && !initCloudClient()) { loginErr('⚠️ الاتصال بالسحابة مش جاهز — اتأكد من الإنترنت وحاول تاني'); return; }
      const btn = document.getElementById('btnCloudRegister');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري إنشاء الحساب...'; }
      try {
        const { data, error } = await sb.auth.signUp({
          email, password: pw,
          options: { data: { username, display_name: name || username, role: 'customer' } }
        });
        if (error) {
          const m = error.message || '';
          if (/already registered|already been registered|already exists|User already/i.test(m)) { switchLoginTab('login'); return loginErr('📧 الإيميل ده مسجّل بالفعل — سجّل الدخول من تبويب «تسجيل الدخول»، أو استخدم إيميل تاني'); }
          if (/Password should be|weak password|at least/i.test(m)) return loginErr('🔑 كلمة المرور ضعيفة — استخدم 6 أحرف على الأقل');
          if (/Unable to validate email|invalid format|invalid email/i.test(m)) return loginErr('✍️ الإيميل غير صالح — راجع كتابته');
          if (/rate limit|Too many/i.test(m)) return loginErr('⏳ طلبات كثيرة — استنى دقيقة وحاول تاني');
          if (/Database error saving new user/i.test(m)) return loginErr('⚠️ اسم المستخدم ده مستخدم بالفعل — جرّب اسمًا آخر، أو سجّل الدخول لو عندك حساب');
          if (/Failed to fetch|Network|network/i.test(m)) return loginErr('📡 مشكلة في الاتصال — راجع الإنترنت وحاول تاني');
          return loginErr('❌ ' + m);
        }
        if (data && data.session) { await onCloudSession(data.session); loginOk('✅ تم إنشاء حسابك وتسجيل الدخول — أهلًا بيك!'); return; }
        switchLoginTab('login');
        const le = document.getElementById('cl-email'); if (le && !le.value) le.value = email;
        loginOk('📧 بعتنالك إيميل تأكيد على ' + email + ' — افتح الرسالة واضغط الرابط، ثم سجّل الدخول من هنا.');
      } catch (e) {
        loginErr('❌ خطأ غير متوقع: ' + ((e && e.message) ? e.message : 'حاول تاني'));
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✅ إنشاء الحساب والدخول'; }
      }
    }
    async function cloudInit() {
      if (!initCloudClient()) { setCloudStatus('connect'); return; }
      setCloudStatus('on');
      subscribeRealtime();
      pullAll().catch(() => {});
      try {
        const { data } = await sb.auth.getSession();
        if (data && data.session) { await onCloudSession(data.session); return; }
      } catch (e) {}
      setCloudStatus('on');
      showLanding();
    }
    function cloudLogout() {
      if (sb) { try { sb.auth.signOut(); } catch (e) {} }
      cloudProfile = null;
    }
    // ── 🔒 T0.5 (2026-09-21): أُلغي الدخول السريع بحساب زائر مشترك ──
    // السبب: كان يحمل كلمة مرور مكتوبة في كود الموقع العلني، أي أن أي زائر
    // يستطيع الدخول بهذا الحساب. الحساب نفسه (guest@2m-stor.app) يجب حذفه من
    // Supabase → Authentication → Users.
    async function cloudQuickLogin() {
      return loginErr('⛔ الدخول السريع أُلغي لأسباب أمنية — سجّل دخولك بحسابك أو أنشئ حسابًا جديدًا');
    }
    // ── 🔒 T0.5 (2026-09-21): أُلغي إنشاء الحسابات العشوائية بضغطة واحدة ──
    // السبب: كان يسمح لأي زائر بإنشاء حسابات سحابية بلا حدود (بلا CAPTCHA ولا
    // تحقق بريدي) — وهو ما كان يُستغل في ثغرة تصعيد الصلاحيات A1.
    // الحسابات الجديدة الآن تُنشأ من تبويب «+ حساب جديد» بإيميل حقيقي + تأكيد بريدي.
    async function cloudCreateRandomAccount() {
      toast('⛔ إنشاء الحسابات العشوائية أُلغي — استخدم تبويب «+ حساب جديد» بإيميلك', 6000);
      return loginErr('استخدم «+ حساب جديد» وسجّل بإيميلك الحقيقي');
    }

    // 🚫 T-A3 (2026-09-22): أُزيل «الوضع المحلي» بالكامل — لا حساب ولا بيانات بدون سحابة.
    // ── ☁️ واجهة شاشة الدخول — سحابي فقط (T-A3: أُزيل الحساب المحلي) ──
    // ملاحظة T-A2: صندوق الرسائل صار خارج التبويبين — كان داخل تبويب «دخول» فقط
    // فكانت رسائل التسجيل تُكتب في مكان مخفي ⇒ «الزر لا يعمل» من وجهة نظر المستخدم.
    function renderLogin() {
      const inner = document.getElementById('loginInner');
      if (!inner) return;
      const clr = "hideLoginNote()";
      inner.innerHTML =
        '<div class="login-tabs">' +
          '<button class="login-tab active" id="tabLogin" onclick="switchLoginTab(\'login\')">🔓 تسجيل الدخول</button>' +
          '<button class="login-tab" id="tabRegister" onclick="switchLoginTab(\'register\')">➕ حساب جديد</button>' +
        '</div>' +
        '<div class="login-error" id="loginError" style="display:none"></div>' +
        '<div class="login-ok" id="loginOk" style="display:none"></div>' +
        '<div id="paneLogin" style="display:block">' +
          '<div class="form-group"><label>الإيميل</label><input type="email" id="cl-email" placeholder="you@example.com" autocomplete="email" inputmode="email" style="direction:ltr;text-align:left" oninput="' + clr + '" onkeydown="if(event.key===\'Enter\')cloudDoLogin()"></div>' +
          '<div class="form-group"><label>كلمة المرور</label><input type="password" id="cl-pass" placeholder="••••••" autocomplete="current-password" oninput="' + clr + '" onkeydown="if(event.key===\'Enter\')cloudDoLogin()"></div>' +
          '<button class="btn btn-primary" id="btnCloudLogin" style="width:100%" onclick="cloudDoLogin()">🔓 تسجيل الدخول</button>' +
          '<button class="btn btn-ghost" style="width:100%;margin-top:8px" onclick="hideLogin()">🛍️ تصفّح المتجر بدون حساب</button>' +
        '</div>' +
        '<div id="paneRegister" style="display:none">' +
          '<div class="form-group"><label>اسم المستخدم (بيظهر للناس)</label><input type="text" id="reg-username" placeholder="اسم المستخدم" style="direction:ltr;text-align:left" oninput="' + clr + '"></div>' +
          '<div class="form-group"><label>الاسم الكامل</label><input type="text" id="reg-name2" placeholder="مثال: أحمد السيد" oninput="' + clr + '"></div>' +
          '<div class="form-group"><label>الإيميل</label><input type="email" id="reg-email" placeholder="you@example.com" inputmode="email" style="direction:ltr;text-align:left" oninput="' + clr + '"></div>' +
          '<div class="form-group"><label>كلمة المرور (6+ أحرف)</label><input type="password" id="reg-pass2" placeholder="••••••" autocomplete="new-password" oninput="' + clr + '" onkeydown="if(event.key===\'Enter\')cloudDoRegister()"></div>' +
          '<button class="btn btn-primary" id="btnCloudRegister" style="width:100%" onclick="cloudDoRegister()">✅ إنشاء الحساب والدخول</button>' +
        '</div>' +
        '<p style="font-size:0.72rem;color:var(--text-muted);font-weight:700;margin-top:14px">☁️ حساب سحابي واحد يفتح على كل أجهزتك · الحسابات الجديدة تكون عميل · العاملون والمدير يدخلون بإيميلهم وكلمة مرورهم</p>';
    }
    // ── إعدادات السحابة (من مودال الإعدادات) ──
    function cloudStatusLabel() {
      return { on: '✅ متصل بالسحابة', offline: '📡 أوفلاين — بيتزامن أول ما النت يرجع', connect: ' جاري الاتصال', off: '📱 تخزين محلي' }[cloudStatus] || cloudStatus;
    }
    function cloudSectionHtml() {
      return '<div class="form-group"><label>☁️ الاتصال السحابي (Supabase) — تلقائي</label>' +
        '<input type="text" id="set-cloud-url" value="' + esc(cloudCfg.url || '') + '" placeholder="https://xxxx.supabase.co" style="direction:ltr;text-align:left;margin-bottom:8px">' +
        '<input type="password" id="set-cloud-key" value="' + esc(cloudCfg.key || '') + '" placeholder="anon public key (تبدأ بـ eyJ)" style="direction:ltr;text-align:left;margin-bottom:8px">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
          '<button class="btn btn-primary" style="padding:8px 14px;font-size:0.8rem" onclick="saveCloudConfig()">💾 حفظ وتفعيل</button>' +
          '<button class="btn btn-outline" style="padding:8px 14px;font-size:0.8rem" onclick="testCloud()">🧪 اختبار الاتصال</button>' +
          (cloudCfg.on ? '<button class="btn btn-outline" style="padding:8px 14px;font-size:0.8rem;color:#e17055;border-color:#e17055" onclick="disableCloud()">⏹ إيقاف (عود للمحلي)</button>' : '') +
        '</div>' +
        '<div style="font-size:0.75rem;font-weight:700;color:var(--text-muted)">' + cloudStatusLabel() + (lastSync ? ' · آخر مزامنة: ' + new Date(lastSync).toLocaleTimeString('ar-EG') : '') + '</div>' +
        '<div style="font-size:0.72rem;color:#00b894;font-weight:700;margin-top:6px">⚡ المزامنة تلقائية — أي تعديل من المدير يظهر فوراً على كل الأجهزة (Realtime)</div>' +
        '</div>';
    }
    function saveCloudConfig() {
      const url = (document.getElementById('set-cloud-url').value || '').trim().replace(/\/+$/, '');
      const key = (document.getElementById('set-cloud-key').value || '').trim();
      if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) return toast('⚠️ الـ URL لازم يكون مثل https://xxxx.supabase.co');
      if (!key.startsWith('eyJ') && !key.startsWith('sb_publishable_') && key.length < 20) return toast('⚠️ مفتاح الـ anon key غير صالح');
      cloudCfg = { url, key, on: true };
      localStorage.setItem('al_sayed_cloud', JSON.stringify(cloudCfg));
      initCloudClient();
      setCloudStatus(sb ? 'on' : 'connect');
      toast('☁️ تم تفعيل الوضع السحابي — بياناتك هتتترحّل');
      ensureLids();
      migrateIfNeeded();
      flushOutbox();
      renderLogin();
      renderAll();
      openSettingsModal();
    }
    async function testCloud() {
      const url = (document.getElementById('set-cloud-url').value || '').trim().replace(/\/+$/, '');
      const key = (document.getElementById('set-cloud-key').value || '').trim();
      if (!url || !key) return toast('⚠️ اكتب الـ URL والـ key الأول');
      if (!window.supabase) return toast('⚠️ مكتبة Supabase لسه ما حملتش (شبكة؟)');
      toast('⏳ جاري اختبار الاتصال...');
      try {
        const tmp = window.supabase.createClient(url, key);
        const { error } = await tmp.from('settings').select('*').limit(1);
        if (error) return toast('❌ فشل الاتصال: ' + error.message);
        toast('✅ الاتصال شغال! قاعدة البيانات متوصلة');
      } catch (e) { toast('❌ ' + (e.message || 'خطأ في الاتصال')); }
    }
    function disableCloud() {
      if (!confirm('إيقاف الوضع السحابي؟ التطبيق هيكمل بالتخزين المحلي، وبياناتك السحابية بتفضل في Supabase.')) return;
      cloudCfg.on = false;
      localStorage.setItem('al_sayed_cloud', JSON.stringify(cloudCfg));
      sb = null;
      cloudProfile = null;
      setCloudStatus('off');
      openSettingsModal();
      renderLogin();
    }

    // ── تعديل الصلاحيات (مدير) ──
    const PERM_LABELS = {
      stock: '📦 صفحة المخزن',
      add: '➕ إضافة منتجات/أقسام',
      del: '✏️ تعديل وحذف منتجات',
      dash: '📊 لوحة التحكم',
      history: '📋 سجل الفواتير',
      exp: '📥 تصدير/استيراد',
      invoice: '🧾 إنشاء فواتير'
    };
    const ROLE_PERM_KEYS = { worker: ['stock', 'add', 'del', 'dash', 'history', 'exp', 'invoice'], customer: ['invoice', 'history'] };
    function effectivePerm(role, key) {
      const base = (ROLE_PERMS[role] || {})[key];
      const c = customPerms[role];
      if (c && key in c) return !!c[key];
      return !!base;
    }
    function persistRolePerms() {
      try { localStorage.setItem('al_sayed_role_perms', JSON.stringify(customPerms)); } catch (e) {}
      queue({ t: 'set', lid: 'rp', key: 'role_perms', value: JSON.stringify(customPerms) });
    }
    function setRolePerm(role, key, val) {
      if (!can('dash') || role === 'admin') return;
      customPerms[role] = customPerms[role] || {};
      customPerms[role][key] = !!val;
      persistRolePerms();
      toast('✅ تم تحديث صلاحيات ' + (role === 'worker' ? 'العامل' : 'العميل'));
      renderStaffPage();
    }
    function resetRolePerms(role) {
      if (!can('dash') || role === 'admin') return;
      if (!confirm('إرجاع صلاحيات ' + (role === 'worker' ? 'العامل' : 'العميل') + ' الافتراضية؟')) return;
      delete customPerms[role];
      persistRolePerms();
      toast('↩ تمت الإعادة الافتراضية');
      renderStaffPage();
    }

    // ── صفحة العاملين والعملاء ──
    function toggleStaffPage() {
      if (!can('dash')) return;
      const ov = document.getElementById('staffOverlay');
      const open = ov.classList.toggle('open');
      if (open) renderStaffPage();
      closeBurger();
    }
    async function renderStaffPage() {
      const body = document.getElementById('staffBody');
      if (!body) return;
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-weight:700">⏳ جاري التحميل...</div>';
      let usersList = [];
      if (cloudReady()) {
        try {
          const { data } = await sb.from('profiles').select('*').order('created_at');
          usersList = (data || []).map(p => ({ id: p.id, name: p.display_name || p.username, username: p.username, role: p.role, created: p.created_at }));
        } catch (e) {}
      } else {
        // 🚫 T-A3: لا قائمة حسابات محلية — القائمة تأتي من السحابة فقط
        usersList = [];
      }
      const roleNames = { admin: '🛡️ مدير', worker: '👷 عامل', customer: '👤 عميل' };
      const workersN = usersList.filter(u => u.role === 'worker').length;
      const customersN = usersList.filter(u => u.role === 'customer').length;
      const permCardHtml = role =>
        '<div class="perm-role-card">' +
          '<div class="perm-role-title">' + (role === 'worker' ? '👷 صلاحيات العامل (' + workersN + ')' : '👤 صلاحيات العميل (' + customersN + ')') +
            '<button class="perm-reset" onclick="resetRolePerms(\'' + role + '\')">↩ إعادة الافتراضي</button></div>' +
          '<div class="perm-grid">' +
            ROLE_PERM_KEYS[role].map(k =>
              '<label class="perm-toggle"><input type="checkbox" ' + (effectivePerm(role, k) ? 'checked' : '') +
              ' onchange="setRolePerm(\'' + role + '\', \'' + k + '\', this.checked)">' + PERM_LABELS[k] + '</label>'
            ).join('') +
          '</div>' +
        '</div>';
      const rows = usersList.length ? usersList.map(u => {
        const isSelf = (cloudReady() && cloudProfile && u.id === cloudProfile.id) || (!cloudReady() && u.username === sessionUser);
        const roleCtl = isSelf
          ? '<span class="staff-role-badge">' + roleNames[u.role] + ' (أنت)</span>'
          : '<select onchange="' + 'changeUserRole' + '(\'' + u.id + '\', this.value)" ' +
            'style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-main);font-weight:700;font-size:0.8rem">' +
            ['admin', 'worker', 'customer'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + roleNames[r] + '</option>').join('') +
            '</select>';
        const created = u.created ? new Date(u.created).toLocaleDateString('ar-EG') : '';
        const av = u.role === 'admin' ? '🛡️' : (u.role === 'worker' ? '👷' : '👤');
        return '<div class="staff-row">' +
          '<div class="staff-avatar">' + av + '</div>' +
          '<div class="staff-info"><div class="staff-name">' + esc(u.name) + '</div><div class="staff-meta">@' + esc(u.username) + (created ? ' · انضم ' + created : '') + '</div></div>' +
          roleCtl +
        '</div>';
      }).join('') : '';
      body.innerHTML =
        '<div class="dash-card"><h3>🔐 الصلاحيات (عدّلها كما يناسب محلك)</h3>' +
          permCardHtml('worker') + permCardHtml('customer') +
        '</div>' +
        '<div class="dash-card"><h3>👥 القائمة الكاملة (' + usersList.length + ' حساب)</h3>' +
          (rows || '<div style="color:var(--text-muted);font-weight:700;font-size:0.85rem;padding:10px">لا توجد حسابات بعد</div>') +
        '</div>';
    }
    async function manualSync() {
      if (!cloudReady()) return toast('⚠️ السحابة مش مفعلة');
      toast('🔄 جاري المزامنة...');
      try {
        await flushOutbox();
        await pullAll();
        toast(lastSync ? '✅ اكتملت المزامنة — البيانات محدثة' : '⚠️ ما قدرنا نكمّل المزامنة — اتأكد من الاتصال');
      } catch (e) { toast('⚠️ خطأ في المزامنة'); }
      openSettingsModal();
    }

    // ── إدارة مستخدمين سحابية (تغيير أدوار) ──
    async function changeUserRole(profileId, role) {
      if (!cloudReady() || !can('dash')) return;
      const { error } = await sb.from('profiles').update({ role }).eq('id', profileId);
      if (error) return toast('❌ ' + (error.message || 'خطأ'));
      toast('✅ تم تغيير الدور');
      logAction('تغيير دور مستخدم', role);
    }


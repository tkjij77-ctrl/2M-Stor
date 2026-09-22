    // ════════════════════════════════════════════════════════
    //  🔒 قفل الكاونتر السريع (T-A7)
    //  كانت الواجهة (lockOverlay + مفتاح الأرقام + زر الهيدر + بند القائمة) موجودة
    //  في الصفحة والتصميم، لكن الدوال quickLock / unlockWithPasswordPrompt /
    //  logoutFromLock غير معرَّفة في أي ملف ⇒ الزرّان كانا ميّتين تمامًا.
    //  هنا تُنفَّذ كاملة: رمز PIN لكل مستخدم على جهازه (مُخزَّن مُشفَّرًا SHA-256)
    //  مع مسار احتياطي بكلمة المرور السحابية.
    // ════════════════════════════════════════════════════════
    let lockPinBuf = '';
    let lockPinTries = 0;
    let lockMode = 'pin';   // 'pin' | 'pass' — يمنع أن يمسح الإدخال التلقائي شكل كلمة المرور

    function lockUserKey() {
        // الرمز خاص بكل مستخدم على هذا الجهاز (المستخدم بعد دخول كلمة المرور)
        const u = (typeof sessionUser === 'string' && sessionUser) ? sessionUser : 'me';
        return 'al_sayed_counter_pin_' + u;
    }
    function pinRecord() {
        try {
            const r = JSON.parse(localStorage.getItem(lockUserKey()) || 'null');
            return (r && r.h && r.len) ? r : null;
        } catch (e) { return null; }
    }
    function savePinRecord(rec) {
        try { localStorage.setItem(lockUserKey(), JSON.stringify(rec)); } catch (e) {}
    }
    function clearPinRecord() { try { localStorage.removeItem(lockUserKey()); } catch (e) {} }

    async function pinHash(pin) {
        const raw = '2m-stor|' + pin;
        try {
            if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}
        // بديل بسيط لو تعذّر crypto.subtle (سياق غير آمن)
        let h = 0;
        for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
        return 'w' + h.toString(16);
    }

    // ── قسم إعداد الرمز (يُستخدم في الإعدادات وفي نافذة كلمة المرور) ──
    function counterPinSectionHtml() {
        const has = !!pinRecord();
        return '<div style="border-top:1px solid var(--border);margin:14px 0 8px;padding-top:10px;font-weight:800;font-size:.85rem">🔒 الأمان — رمز PIN لقفل الكاونتر</div>' +
            (has ? '<p style="font-size:.78rem;color:var(--primary);font-weight:800;margin-bottom:8px">✅ رمز PIN مُعيَّن على هذا الجهاز — اكتب رمزًا جديدًا لتغييره</p>'
                 : '<p style="font-size:.78rem;color:var(--text-muted);font-weight:700;margin-bottom:8px">لا يوجد رمز بعد — بدونه يفتح القفل بكلمة المرور فقط</p>') +
            '<div class="form-group"><label>رمز PIN (4–6 أرقام)</label>' +
            '<input type="password" id="set-pin" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••"></div>' +
            '<div class="form-group"><label>تأكيد الرمز</label>' +
            '<input type="password" id="set-pin-conf" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••"></div>' +
            '<p style="font-size:.73rem;color:var(--text-muted);font-weight:700">اتركه فارغًا لإلغاء الرمز. الرمز يُخزَّن مشفَّرًا على هذا الجهاز وحده — الحماية الحقيقية تبقى كلمة المرور.</p>' +
            '<div style="margin:8px 0 4px"><button class="btn btn-outline" onclick="saveCounterPin()">🔒 حفظ رمز PIN</button></div>';
    }

    async function saveCounterPin() {
        const a = document.getElementById('set-pin');
        const b = document.getElementById('set-pin-conf');
        if (!a) return false;
        const pin = String(a.value || '').trim();
        const cf = String(b ? b.value : '').trim();
        if (!pin && !cf) { clearPinRecord(); toast('🔓 أُلغي رمز PIN — القفل سيفتح بكلمة المرور'); return true; }
        if (!/^\d{4,6}$/.test(pin)) { toast('🔒 رمز PIN يجب أن يكون 4 إلى 6 أرقام'); return false; }
        if (pin !== cf) { toast('❌ تأكيد الرمز غير مطابق'); return false; }
        savePinRecord({ h: await pinHash(pin), len: pin.length });
        if (a) a.value = ''; if (b) b.value = '';
        toast('✅ تم تعيين رمز PIN لقفل الكاونتر');
        return true;
    }

    // ── شاشة القفل ──
    function lockRoleLabel() {
        return sessionRole === 'admin' ? 'مدير النظام' : (sessionRole === 'worker' ? 'عامل' : 'مستخدم');
    }
    function renderLockPinArea(msg) {
        const area = document.getElementById('lockPinArea');
        if (!area) return;
        lockMode = 'pin';
        const rec = pinRecord();
        if (!rec) {
            area.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted);font-weight:700;margin:6px 0 2px">' +
                'لا يوجد رمز PIN على هذا الجهاز — ادخل بكلمة المرور، أو عيّن رمزًا من «كلمة المرور والـ PIN» في القائمة.</p>';
            return;
        }
        let dots = '';
        for (let i = 0; i < rec.len; i++) dots += '<div class="pin-dot' + (i < lockPinBuf.length ? ' filled' : '') + '"></div>';
        let btns = '';
        for (let n = 1; n <= 9; n++) btns += '<button class="pin-btn" onclick="lockPadPress(\'' + n + '\')">' + n + '</button>';
        btns += '<button class="pin-btn action" onclick="lockPadClear()" aria-label="مسح">⌫</button>' +
                '<button class="pin-btn" onclick="lockPadPress(\'0\')">0</button>' +
                '<button class="pin-btn action" onclick="lockPinSubmit()" aria-label="تأكيد">✓</button>';
        area.innerHTML =
            '<div class="pin-container"><div class="pin-dots">' + dots + '</div>' +
            (msg ? '<div style="font-size:.78rem;font-weight:800;color:var(--danger)">' + msg + '</div>' : '') +
            '<div class="pin-pad">' + btns + '</div>' +
            '<button class="login-switch-mode" onclick="lockShowPassword()">نسيت الرمز؟ ادخل بكلمة المرور</button></div>';
    }
    function lockPadPress(d) {
        const rec = pinRecord();
        if (!rec || lockPinTries >= 5 || lockMode !== 'pin') return;
        if (lockPinBuf.length >= rec.len) return;
        lockPinBuf += d;
        renderLockPinArea('');
        if (lockPinBuf.length === rec.len) setTimeout(lockPinSubmit, 120);   // إدخال تلقائي عند اكتمال الطول
    }
    function lockPadClear() { if (lockMode !== 'pin') return; lockPinBuf = lockPinBuf.slice(0, -1); renderLockPinArea(''); }
    async function lockPinSubmit() {
        if (lockMode !== 'pin') return;   // المستخدم فتح مسار كلمة المرور — لا نُعيد رسم اللوحة فوقه
        const rec = pinRecord();
        if (!rec) return lockShowPassword();
        if (lockPinBuf.length < rec.len) return renderLockPinArea('أدخل الرمز كاملًا');
        const h = await pinHash(lockPinBuf);
        if (h === rec.h) { unlockCounter(); return; }
        lockPinTries++;
        lockPinBuf = '';
        if (lockPinTries >= 5) {
            renderLockPinArea('٥ محاولات خاطئة — ادخل بكلمة المرور');
            return;
        }
        renderLockPinArea('رمز غير صحيح (' + lockPinTries + '/5)');
    }
    function lockShowPassword() {
        const area = document.getElementById('lockPinArea');
        if (!area) return;
        lockMode = 'pass';
        area.innerHTML =
            '<div class="form-group" style="text-align:right"><label style="font-size:.78rem">كلمة المرور</label>' +
            '<input type="password" id="lock-pass" autocomplete="current-password" placeholder="••••••" ' +
            'onkeydown="if(event.key===\'Enter\')lockPasswordSubmit()"></div>' +
            '<button class="btn btn-primary" id="btnLockUnlock" onclick="lockPasswordSubmit()" style="width:100%">🔓 فتح</button>' +
            '<button class="login-switch-mode" style="margin-top:8px" onclick="renderLockPinArea(\'\')">↩ رجوع إلى رمز PIN</button>';
        const el = document.getElementById('lock-pass');
        if (el) el.focus();
    }
    function unlockWithPasswordPrompt() { lockShowPassword(); }   // الزر القديم في الصفحة
    async function lockPasswordSubmit() {
        const el = document.getElementById('lock-pass');
        const pass = el ? el.value : '';
        const err = document.getElementById('lockError');
        const fail = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } else { toast(m); } };
        if (!pass) return fail('❌ اكتب كلمة المرور');
        if (err) err.style.display = 'none';
        if (typeof sb === 'undefined' || !sb || !sb.auth) return fail('❌ فتح بكلمة المرور يحتاج اتصالًا بالإنترنت');
        const btn = document.getElementById('btnLockUnlock');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحقق...'; }
        try {
            const { data: u } = await sb.auth.getUser();
            const email = (u && u.user && u.user.email) || (cloudProfile && cloudProfile.email) || '';
            if (!email) throw new Error('تعذّر قراءة بريد حسابك');
            const { error } = await sb.auth.signInWithPassword({ email: email, password: pass });
            if (error) throw new Error('كلمة المرور غير صحيحة');
            unlockCounter();
            logAction('فتح القفل بكلمة المرور', sessionUser);
        } catch (e) {
            if (btn) { btn.disabled = false; btn.textContent = '🔓 فتح'; }
            fail('❌ ' + ((e && e.message) ? e.message : 'تعذّر التحقق'));
        }
    }
    function unlockCounter() {
        lockPinBuf = '';
        lockPinTries = 0;
        const ov = document.getElementById('lockOverlay');
        if (ov) ov.style.display = 'none';
        const err = document.getElementById('lockError');
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        renderLockPinArea('');
        toast('🔓 تم فتح الكاونتر');
    }
    function logoutFromLock() {
        const ov = document.getElementById('lockOverlay');
        if (ov) ov.style.display = 'none';
        lockPinBuf = ''; lockPinTries = 0;
        logout(true);   // بلا تأكيد: المستخدم طلب التبديل صراحة
    }
    function quickLock() {
        const signedIn = !!(sessionUser || cloudProfile);
        if (!signedIn) { toast('🔒 القفل متاح للعاملين والمدير بعد تسجيل الدخول'); return; }
        if (!can('stock')) { toast('🔒 القفل متاح للعاملين والمدير'); return; }
        lockPinBuf = '';
        lockPinTries = 0;
        const av = document.getElementById('lockAvatar');
        const un = document.getElementById('lockUserName');
        const ur = document.getElementById('lockUserRole');
        if (av) av.textContent = sessionRole === 'admin' ? '👑' : '🧑‍💼';
        if (un) un.textContent = sessionUser || (cloudProfile && (cloudProfile.display_name || cloudProfile.u)) || 'المستخدم';
        if (ur) ur.textContent = lockRoleLabel();
        renderLockPinArea('');
        const ov = document.getElementById('lockOverlay');
        if (ov) ov.style.display = 'flex';
        const err = document.getElementById('lockError');
        if (err) { err.style.display = 'none'; err.textContent = ''; }
    }

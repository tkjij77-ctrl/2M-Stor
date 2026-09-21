// ═══════════════════════════════════════════════════════════════════
//  T3.2 — اختبار طابور المزامنة في متصفح حقيقي
//  نحاكي سيرفر Supabase (نجاح/فشل عابر/فشل دائم) ونتأكد أن:
//   • عملية فاشلة دائمًا لا تحجز الطابور كله (كانت تعلّقه للأبد)
//   • العابر يُعاد ترتيبه · والدائم ينتقل لقائمة الفشل مع سبب
//   • لا فاتورة مكرّرة عند إعادة المحاولة (نجاح جزئي سابق)
//   • التعديلات المكرّرة على نفس الصنف لا تتضاعف في الطابور
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');

const SEED = [{
  name: "قسم الاختبار", lid: "Lc1", cid: 1, items: [
    { n: "منتج أ", p: "60", pn: 60, q: 10, qs: 10, min: 2, b: "", img: "", lid: "La", cid: 101 },
    { n: "منتج ب", p: "50", pn: 50, q: 5, qs: 5, min: 2, b: "", img: "", lid: "Lb", cid: 102 }
  ]
}];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 140)));

  // ── سيرفر Supabase وهمي قابل للتحكم ──
  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('al_sayed_db', JSON.stringify(seed));
    localStorage.setItem('al_sayed_invoices', '[]');
    localStorage.setItem('al_sayed_session_user', 'admin');
  }, SEED);

  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => setUser({ u: 'admin', role: 'admin', name: 'مدير' }));

  let allPass = true;
  const check = (name, pass, detail) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
    allPass = allPass && pass;
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  T3.2 — طابور مزامنة لا يعلق (متصفح حقيقي)');
  console.log('═══════════════════════════════════════════════════════════════');

  // ═══ 1) تصنيف الأخطاء (الحجر الأساس) ═══
  const cls = await page.evaluate(() => ({
    net:   classifyError({ message: 'TypeError: Failed to fetch' }),
    five:  classifyError({ code: '503', message: 'service unavailable' }),
    dup:   classifyError({ code: '23505', message: 'duplicate key value violates unique constraint' }),
    col:   classifyError({ code: '42703', message: 'column "x" does not exist' }),
    rls:   classifyError({ code: '42501', message: 'permission denied' }),
    token: classifyError({ message: 'JWT expired' }),
    jwt:   classifyError({ code: '429', message: 'rate limited' })
  }));
  check('انقطاع الشبكة = عابر (يُعاد لاحقًا)', cls.net === 'transient', cls.net);
  check('خطأ سيرفر 5xx = عابر', cls.five === 'transient', cls.five);
  check('انتهاء صلاحية الرمز = عابر', cls.token === 'transient', cls.token);
  check('تجاوز المعدل 429 = عابر', cls.jwt === 'transient', cls.jwt);
  check('مفتاح مكرر = دائم (لا فائدة من التكرار)', cls.dup === 'permanent', cls.dup);
  check('عمود غير موجود = دائم', cls.col === 'permanent', cls.col);
  check('منع RLS = دائم', cls.rls === 'permanent', cls.rls);

  // ═══ 2) تنظيف التكرار في الطابور ═══
  const dd = await page.evaluate(() => {
    // وضع «سحابي» وهمي حتى يقبل الطابور الإدخالات
    sb = { from: () => ({}) };
    cloudProfile = { id: 1, username: 'admin' };
    outbox = []; outboxFailed = [];
    const q = (t, lid) => queue({ t, lid, catLid: 'Lc1' });
    q('item-upd', 'La'); q('item-upd', 'La'); q('item-upd', 'La');   // نفس الصنف 3 مرات
    q('item-upd', 'Lb');
    q('set', 's1'); q('set', 's1');                                  // نفس الإعداد مرتين
    q('item-del', 'La'); q('item-del', 'La');                        // حذف: لا يُنظَّف
    return { total: outbox.length, types: outbox.map(e => e.t + ':' + (e.lid || e.key)) };
  });
  check('3 تعديلات لنفس الصنف → عملية واحدة', dd.types.filter(x => x === 'item-upd:La').length === 1,
    dd.types.join(' · '));
  check('نفس الإعداد مرتين → مرة واحدة', dd.types.filter(x => x === 'set:s1').length === 1);
  check('عمليات الحذف لا تُدمج (الترتيب مهم)', dd.types.filter(x => x === 'item-del:La').length === 2, `${dd.total} في الطابور`);

  // ═══ 3) عملية فاشلة دائمًا لا تحجز الطابور كله ═══
  const block = await page.evaluate(async () => {
    outbox = []; outboxFailed = [];
    // الطابور: [دائم الفشل، ناجح، ناجح]
    outbox.push({ t: 'item-upd', lid: 'La', catLid: 'Lc1', attempts: 0, ts: Date.now() });
    outbox.push({ t: 'set', key: 'k1', value: '1', attempts: 0, ts: Date.now() });
    outbox.push({ t: 'set', key: 'k2', value: '2', attempts: 0, ts: Date.now() });

    const applied = [];
    const origApply = window.applyEntry;
    window.applyEntry = async (e) => {
      if (e.t === 'item-upd') { const err = new Error('column "nope" does not exist'); err.code = '42703'; throw err; }
      applied.push(e.key || e.t);
    };
    flushing = false;
    await flushOutbox();
    window.applyEntry = origApply;
    return { applied, failed: outboxFailed.map(f => f.t + ':' + (f.key || f.lid)), failedErr: outboxFailed[0] && outboxFailed[0].lastError, remaining: outbox.length };
  });
  check('🔒 عملية فاشلة دائمًا نُقلت لقائمة الفشل', block.failed.length === 1 && block.failed[0] === 'item-upd:La', block.failed.join(','));
  check('🎯 العمليتان التاليتان نُفِّذتا رغم ذلك (كانت تعلق قبلهما)', block.applied.length === 2, block.applied.join(' · '));
  check('سبب الفشل محفوظ للنظر فيه', /does not exist/.test(block.failedErr || ''), block.failedErr);

  // ═══ 4) الفشل العابر: يحفظ الترتيب ويعيد المحاولة ═══
  const trans = await page.evaluate(async () => {
    outbox = []; outboxFailed = [];
    outbox.push({ t: 'set', key: 'first', value: '1', attempts: 0, ts: Date.now() });
    outbox.push({ t: 'set', key: 'second', value: '2', attempts: 0, ts: Date.now() });
    const applied = [];
    const origApply = window.applyEntry;
    window.applyEntry = async (e) => {
      if (e.key === 'first' && !window.__netTried) { window.__netTried = true; throw new Error('Failed to fetch'); }
      applied.push(e.key);
    };
    flushing = false;
    await flushOutbox();
    const afterFirst = { remaining: outbox.length, first: outbox[0] && outbox[0].key, attempts: outbox[0] && outbox[0].attempts };
    window.__netTried = true;              // الشبكة رجعت
    flushing = false;
    await flushOutbox();
    window.applyEntry = origApply;
    return { applied, afterFirst, finalRemaining: outbox.length, finalApplied: applied.slice() };
  });
  check('العابر يحفظ الترتيب (الأول يبقى في المقدمة)', trans.afterFirst.first === 'first', `المقدمة: ${trans.afterFirst.first}`);
  check('ويُسجَّل عدد المحاولات', trans.afterFirst.attempts === 1, `attempts=${trans.afterFirst.attempts}`);
  check('وبعد رجوع الشبكة يُنفَّذ الجميع بالترتيب',
    trans.finalApplied.join(',') === 'first,second' && trans.finalRemaining === 0, trans.finalApplied.join(' · '));

  // ═══ 5) لا فاتورة مكرّرة (نجاح جزئي سابق) ═══
  const idem = await page.evaluate(async () => {
    const insCalls = [];
    const existing = { id: 777, invoice_no: 42 };
    sb = {
      from(table) {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: table === 'invoices' ? existing : null, error: null }); },
          insert(rows) { insCalls.push({ table, rows }); return { select: () => ({ single: () => Promise.resolve({ data: { id: 999, updated_at: 'x' }, error: null }) }) }; }
        };
      }
    };
    cloudProfile = { id: 1, username: 'admin' };
    invoices = [{ lid: 'Lx', no: 42, customer: 'نقدي', items: [{ name: 'منتج أ', qty: 1, price: 60 }], total: 60, status: 'قيد المعالجة', stockApplied: 'both' }];
    outbox = []; outboxFailed = [];
    outbox.push({ t: 'inv-ins', lid: 'Lx', attempts: 0, ts: Date.now() });   // ⚠️ لازم نضع الطلب في الطابور
    flushing = false;
    await flushOutbox();
    return { insCalls: insCalls.length, cid: invoices[0].cid, remaining: outbox.length };
  });
  check('🔒 فاتورة موجودة مسبقًا لا تُدرج مرتين', idem.insCalls === 0, `محاولات إدراج: ${idem.insCalls}`);
  check('ويُربط المعرّف السحابي الموجود بدلًا من الإدراج', idem.cid === 777 && idem.remaining === 0, `cid=${idem.cid}`);

  // ═══ 6) الواجهة: لوحة حالة المزامنة ═══
  const ui = await page.evaluate(async () => {
    outbox = [{ t: 'item-upd', lid: 'La', attempts: 2, lastError: 'Failed to fetch', ts: Date.now() }];
    outboxFailed = [{ t: 'inv-ins', lid: 'Lz', attempts: 5, lastError: 'column "x" does not exist', failedAt: Date.now() }];
    await openSyncStatus();
    const txt = document.getElementById('modalBody').innerText;
    return {
      showsPending: /بانتظار الرفع/.test(txt) && /تعديل صنف/.test(txt),
      showsFailed: /عمليات فشلت/.test(txt) && /فاتورة جديدة/.test(txt),
      showsReason: /does not exist/.test(txt),
      hasRetry: !!document.querySelector('button[onclick*="retryFailedOps"]'),
      hasIgnore: !!document.querySelector('button[onclick*="clearFailedOps"]'),
      // إعادة المحاولة اليدوية
      retried: null
    };
  });
  check('اللوحة تعرض ما ينتظر الرفع مع عدد المحاولات', ui.showsPending, '');
  check('وتعرض العمليات الفاشلة مع سبب واضح', ui.showsFailed && ui.showsReason, '');
  check('وفيها زرّا «أعد المحاولة» و«تجاهل»', ui.hasRetry && ui.hasIgnore, '');

  const retry = await page.evaluate(() => {
    const origApply = window.applyEntry;
    let done = [];
    window.applyEntry = async (e) => { done.push(e.t); };
    flushing = false;
    retryFailedOps();
    window.applyEntry = origApply;
    return { failedLeft: outboxFailed.length, backInQueue: outbox.length, chip: (document.getElementById('cloudChip') || {}).textContent };
  });
  check('«أعد المحاولة» تُرجع الفاشل للطابور', retry.failedLeft === 0 && retry.backInQueue >= 1, `عاد ${retry.backInQueue}`);

  // ═══ 7) سقف الطابور: لا نمو غير محدود ═══
  const cap = await page.evaluate(() => {
    outbox = []; outboxFailed = [];
    for (let i = 0; i < 810; i++) queue({ t: 'set', key: 'k' + i, value: String(i) });
    return { len: outbox.length, failed: outboxFailed.length };
  });
  check('سقف الطابور يعمل (لا نمو غير محدود)', cap.len <= 800, `الطابور: ${cap.len} · الفاشلة: ${cap.failed}`);

  // ═══ 8) المؤشر في الشريط ═══
  const chip = await page.evaluate(() => {
    outbox = [{ t: 'set', key: 'x', value: '1', attempts: 0 }]; outboxFailed = [];
    updateSyncChip();
    const pending = document.getElementById('cloudChip').textContent;
    outbox = []; outboxFailed = [{ t: 'set', key: 'y', attempts: 5, lastError: 'x' }];
    updateSyncChip();
    const failed = document.getElementById('cloudChip').textContent;
    outbox = []; outboxFailed = []; cloudStatus = 'on';
    updateSyncChip();
    return { pending, failed, normal: document.getElementById('cloudChip').textContent };
  });
  check('المؤشر يبيّن العمليات المنتظرة', /بانتظار الرفع/.test(chip.pending), chip.pending);
  check('ويبيّن الفشل بوضوح', /فشلت/.test(chip.failed), chip.failed);
  check('ويعود طبيعيًا بعد الفراغ', chip.normal.includes('سحابي'), chip.normal);

  const realErrors = pageErrors.filter(e => !/ERR_FAILED|401|404|Failed to load resource/.test(e));
  check('لا أخطاء جافاسكربت', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'نظيف');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(allPass ? '  ✅ نجحت كل فحوص طابور المزامنة' : '  ❌ يوجد فشل — راجع أعلاه');
  console.log('═══════════════════════════════════════════════════════════════');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();

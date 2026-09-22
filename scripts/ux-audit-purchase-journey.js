// ═══════════════════════════════════════════════════════════════════
//  رحلة شراء كاملة كعميل حقيقي (حتى تثبيت الفاتورة على السحابة)
//  ⚠️ يُنشئ فاتورة اختبار واحدة على قاعدة حقيقية ⇒ ينظّفها
//  scripts/cleanup-ux-audit.sh بمجرد الانتهاء.
// ═══════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const fs = require('fs');
const log = console.log;
const SHOT = '/home/user/audit-shots';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 150)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 150)); });

  await p.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const email = fs.readFileSync('/tmp/ux_email', 'utf8').trim();
  // 🏠 T-A1: البداية صفحة ترحيب — نفتح شاشة الدخول كما يفعل المستخدم نفسه
  await p.evaluate(() => showLogin());
  await p.waitForSelector('#cl-email', { state: 'visible', timeout: 10000 });
  await p.fill('#cl-email', email); await p.fill('#cl-pass', 'Test12345');
  await p.click('#btnCloudLogin');
  await p.waitForTimeout(7000);

  // ── 1) نختار صنفًا متاحًا ──
  await p.evaluate(() => setView('shop'));
  await p.waitForTimeout(2500);
  const picked = await p.evaluate(() => {
    const out = [];
    db.forEach((c, ci) => c.items.forEach((it, ii) => { if (getQs(it) > 0) out.push({ ci, ii, id: it.cid, name: it.n, q: getQ(it), qs: getQs(it), price: it.p, cat: c.name }); }));
    const first = out[0];
    if (first) { const el = [...document.querySelectorAll('#appContent .shop-card')].find(x => (x.getAttribute('onclick') || '').includes(`openProductDetail(${first.ci},${first.ii})`)); if (el) el.click(); }
    return { count: out.length, first };
  });
  log('① أصناف متاحة للبيع: ' + picked.count + ' · اخترت: ' + JSON.stringify(picked.first));
  await p.waitForTimeout(2000);
  await p.screenshot({ path: SHOT + '/11-customer-product-top.png' });

  // ── 2) نضيف للسلة ──
  await p.click('#productDetailCard .amz-btn-cart');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: SHOT + '/12-cart.png' });
  const cart = await p.evaluate(() => {
    const ov = document.querySelector('.cart-overlay');
    return { open: ov && getComputedStyle(ov).display !== 'none', text: (ov ? ov.innerText : '').replace(/\s+/g, ' ').slice(0, 700), btns: ov ? [...ov.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean) : [] };
  });
  log('② السلة:\n' + cart.text);
  log('   أزرار السلة: ' + JSON.stringify(cart.btns));

  // ── 3) إتمام الطلب (قد تظهر نافذة اسم العميل) ──
  const btn = cart.btns.find(t => /إتمام|فاتورة|تأكيد|حفظ|إنشاء/.test(t));
  log('③ سأضغط زر الإتمام: «' + btn + '»');
  if (btn) {
    await p.click(`.cart-overlay button:has-text("${btn.replace(/"/g, '')}")`).catch(async () => {
      await p.evaluate(t => { const b2 = [...document.querySelectorAll('.cart-overlay button')].find(x => x.innerText.includes(t)); if (b2) b2.click(); }, btn);
    });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: SHOT + '/13-receipt.png' });
    const rec = await p.evaluate(() => {
      const m = document.getElementById('modal');
      return { open: m && getComputedStyle(m).display !== 'none', text: (m ? m.innerText : '').replace(/\s+/g, ' ').slice(0, 900), btns: m ? [...m.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean) : [] };
    });
    log('④ الإيصال:\n' + rec.text);
    log('   أزرار الإيصال: ' + JSON.stringify(rec.btns));

    // ── 4) الحفظ الفعلي على السحابة ──
    const save = rec.btns.find(t => /حفظ/.test(t));
    if (save) {
      await p.evaluate(() => { const b3 = [...document.querySelectorAll('#modalBody button')].find(x => x.innerText.includes('حفظ')); if (b3) b3.click(); });
      await p.waitForTimeout(9000);
      await p.screenshot({ path: SHOT + '/14-after-save.png' });
      const after = await p.evaluate(() => ({
        toast: [...document.querySelectorAll('.toast, #toast')].map(x => x.innerText).join(' | ').slice(0, 200),
        modal: document.getElementById('modal') ? getComputedStyle(document.getElementById('modal')).display : null,
        cartLen: typeof invoiceCart !== 'undefined' ? invoiceCart.length : -1,
        invs: (typeof invoices !== 'undefined' ? invoices.slice(-1) : []).map(i => ({ no: i.no, total: i.total, status: i.status, customer: i.customer, noTemp: i.noTemp, lid: i.lid })),
        bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
      }));
      log('⑤ بعد الحفظ: ' + JSON.stringify(after));
      fs.writeFileSync('/tmp/ux-invoice.json', JSON.stringify({ item: picked.first, inv: after.invs[0] || null }, null, 2));
    }
  }

  // ── 5) شاشة «حسابي» كما يراها العميل ──
  await p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); if (typeof closeCart === 'function') closeCart(); setView('account'); });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: SHOT + '/15-account.png', fullPage: false });
  const acc = await p.evaluate(() => document.getElementById('accountView').innerText.replace(/\s+/g, ' ').slice(0, 700));
  log('⑥ «حسابي» للعميل:\n' + acc);

  log('⑦ أخطاء JS: ' + (errs.filter(e => !/supabase|favicon|net::|Failed to load|400|401/.test(e)).slice(0, 4).join(' | ') || 'لا شيء'));
  await b.close();
})();

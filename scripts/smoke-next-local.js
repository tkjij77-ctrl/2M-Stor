// فحص سريع لنسخة Next.js محليًا: هل تُفتح الصفحات ويظهر المتجر؟
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  for (const [path, name] of [['/', 'next-shop'], ['/stock', 'next-stock'], ['/cart', 'next-cart'], ['/privacy', 'next-privacy']]) {
    const r = await p.goto('http://127.0.0.1:3000' + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
    await p.waitForTimeout(1200);
    const txt = (await p.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 120);
    console.log(`  ${r && r.status() === 200 ? '✅' : '❌'} ${path} → ${r ? r.status() : 'ERR'} :: ${txt}`);
    await p.screenshot({ path: `/home/user/shots/${name}.png` });
  }
  console.log('  أخطاء JS:', errs.length ? errs.join(' | ') : 'لا شيء');
  await b.close();
})();

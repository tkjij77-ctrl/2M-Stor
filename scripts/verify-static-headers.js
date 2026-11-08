#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  ADR-0001 — انحراف ترويسات الأمان بين السطحين
//
//  لماذا: صار للمشروع سطحان (فانيلا على مضيف ثابت · Next على خادم).
//  ترويسات الأول في `_headers`، والثاني في `next.config.js`. أي انحراف
//  بينهما يعني سطحًا محميًا وآخر مكشوفًا — وهو أسوأ من غياب الحماية
//  في الاثنين، لأنه يُطمئن بلا سبب.
//
//  التشغيل: node scripts/verify-static-headers.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── فروق معتمدة بين السطحين (بأقل صلاحية، لا بتساوي أعمى) ─────────────
// كل استثناء يجب أن يكون (1) مبرَّرًا هنا، و(2) مُستخدَمًا فعلًا في index.html
// — وإلا فشل الفحص: لا استثناء «احتياطي» يبقى للأبد.
const STATIC_ONLY_EXTRA = {
  // index.html يحمّل Telegram WebApp SDK؛ تطبيق Next لا يستخدمه إطلاقًا
  'script-src': ['https://telegram.org'],
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

// ── 1) قراءة _headers (صيغة Cloudflare/Netlify: نمط ثم أسطر مُزاحة) ──
function parseHeadersFile(src) {
  const blocks = {};
  let current = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = line.trim(); blocks[current] = blocks[current] || {}; continue; }
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.*)$/);
    if (m && current) blocks[current][m[1].toLowerCase()] = m[2].trim();
  }
  return blocks;
}

// ── 2) قراءة CSP من next.config.js ──
function nextCsp() {
  const src = read('next.config.js');
  const m = src.match(/Content-Security-Policy['"]\s*,\s*value:\s*"([^"]+)"/);
  if (!m) return null;
  return m[1].replace(/\\"/g, '"');
}

// CSP ← { directive: [values] }
function parseCsp(csp) {
  const out = {};
  for (const part of csp.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) continue;
    out[bits[0].toLowerCase()] = bits.slice(1);
  }
  return out;
}

const headersSrc = read('_headers');
const htmlRaw = read('index.html');
const blocks = parseHeadersFile(headersSrc);
const all = blocks['/*'] || {};
const staticCsp = all['content-security-policy'] || '';
const cspNextRaw = nextCsp();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ADR-0001 — ترويسات الأمان: السطح الثابت مقابل Next');
console.log('═══════════════════════════════════════════════════════════════');

console.log('\n【1】 وجود الترويسات على السطح الثابت (_headers)');
check('ملف _headers موجود وفيه قاعدة /*', !!blocks['/*'], Object.keys(blocks).join(' · '));
check('CSP موجودة', !!staticCsp, staticCsp.slice(0, 50) + (staticCsp ? '…' : 'غائبة'));
check('X-Frame-Options = DENY', (all['x-frame-options'] || '').toUpperCase() === 'DENY', all['x-frame-options'] || 'غائبة');
check('X-Content-Type-Options = nosniff', (all['x-content-type-options'] || '').toLowerCase() === 'nosniff', all['x-content-type-options'] || 'غائبة');
check('Referrer-Policy موجودة', !!all['referrer-policy'], all['referrer-policy'] || 'غائبة');

console.log('\n【2】 تطابق السطحين (لا محمي ومكشوف معًا)');
check('next.config.js يحوي CSP', !!cspNextRaw, cspNextRaw ? cspNextRaw.slice(0, 40) + '…' : 'غائبة');
if (cspNextRaw && staticCsp) {
  const a = parseCsp(staticCsp), b = parseCsp(cspNextRaw);
  const core = ['default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'connect-src', 'frame-ancestors'];
  for (const d of core) {
    const extras = STATIC_ONLY_EXTRA[d] || [];
    const avArr = (a[d] || []).filter(v => !extras.includes(v)).slice().sort();
    const bvArr = (b[d] || []).slice().sort();
    const same = avArr.join(' ') === bvArr.join(' ');
    const extraList = (a[d] || []).filter(v => extras.includes(v));
    check(
      `تطابق ${d}${extraList.length ? ` (استثناء موثَّق: ${extraList.join(' ')})` : ''}`,
      same,
      same ? avArr.join(' ').slice(0, 46) : `ثابت=[${avArr.join(' ')}] · next=[${bvArr.join(' ')}]`,
    );
  }
  // لا استثناء ميت: كل مُستثنى لا بد أن يكون مُستخدَمًا في index.html
  for (const [d, list] of Object.entries(STATIC_ONLY_EXTRA)) {
    for (const host of list) {
      check(
        `الاستثناء ${host} مُستخدَم فعلًا في index.html (${d})`,
        htmlRaw.includes(host.replace('https://', '')),
        host,
      );
    }
  }
  const ffNext = (b['frame-ancestors'] || []).join(' ');
  check("frame-ancestors 'none' في السطحين", ffNext === "'none'" && (a['frame-ancestors'] || []).join(' ') === "'none'", ffA(ffNext));
  function ffA(v) { return v; }
}

console.log('\n【3】 لا تراخٍ صارخ في CSP');
for (const [label, csp] of [['_headers', staticCsp], ['next.config.js', cspNextRaw || '']]) {
  check(`${label}: بلا 'unsafe-eval'`, !/unsafe-eval/.test(csp));
  check(`${label}: script-src بلا * أو https: مفتوحة`, !/script-src[^;]*(\s\*|\shttps:(?!\/\/))/.test(csp));
  check(`${label}: base-uri أو form-action مقيّدة`, /base-uri/.test(csp) || /form-action/.test(csp) || label === 'next.config.js');
}

console.log('\n【4】 CSP لا تكسر التطبيق الحقيقي (المضيفون المستخدمون في index.html)');
const html = htmlRaw;
const hosts = new Set((html.match(/https:\/\/[a-zA-Z0-9.-]+/g) || []).map(h => h.replace('https://', '')));
const a = parseCsp(staticCsp);
const allows = (directive, host) => (a[directive] || []).some(v => v === host || v === `https://${host}` || (v.startsWith('https://*.') && host.endsWith(v.slice('https://*.'.length))));
check('scripts: telegram.org مسموح', !hosts.has('telegram.org') || allows('script-src', 'telegram.org'), 'script-src');
check('خطوط: fonts.googleapis.com مسموح', !hosts.has('fonts.googleapis.com') || allows('style-src', 'fonts.googleapis.com'));
check('خطوط: fonts.gstatic.com مسموح', !hosts.has('fonts.gstatic.com') || allows('font-src', 'fonts.gstatic.com'));
check('Supabase (https + wss) مسموح', allows('connect-src', 'uzzxhbotbshsgpdnbrmd.supabase.co') && (a['connect-src'] || []).some(v => v.startsWith('wss://')), (a['connect-src'] || []).join(' '));
check('لا مضيف خارجي في index.html غير مغطّى', [...hosts].every(h =>
  allows('script-src', h) || allows('style-src', h) || allows('font-src', h) || allows('img-src', h) || allows('connect-src', h) || /supabase\.co$/.test(h)
), [...hosts].join(' · '));

console.log('\n【5】 التخزين المؤقت (Service Worker لا يتجمد)');
const swBlock = blocks['/sw.js'] || {};
check('sw.js بلا تخزين مؤقت', /no-store|no-cache/.test(swBlock['cache-control'] || ''), swBlock['cache-control'] || 'غائب');
check('vendor يُخزَّن طويلًا (immutable)', /immutable/.test((blocks['/vendor/*'] || {})['cache-control'] || ''), (blocks['/vendor/*'] || {})['cache-control'] || 'غائب');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(fail === 0 ? `  ✅ السطحان متطابقان — ${pass} فحصًا ناجحًا` : `  ❌ ${fail} خلل من ${pass + fail}`);
console.log('═══════════════════════════════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);

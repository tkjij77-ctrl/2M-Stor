// Service Worker — 2M-Stor v34 (مكتبات محلية + CSP + كود التطبيق مفكوك في web/)
const CACHE = 'al-sayed-v34';   // 🔒 T5.1 — الكود مفكوك في web/*.js (تُخزَّن مسبقًا)
const URLS = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  // 🔒 T1.3: مكتبات محلية بدل CDN — تُخزَّن مسبقًا فيعمل التطبيق أوفلاين بالكامل
  'vendor/jsqr.min.js',
  'vendor/qrcode.min.js',
  'vendor/chart.umd.min.js',
  'vendor/supabase.min.js',
  // 🧩 T5.1 (2026-09-22): كود التطبيق انفصل عن index.html إلى ملفات بحسب المسؤولية —
  // تُخزَّن مسبقًا كلها وإلا عمل التطبيق ناقصًا بلا إنترنت.
  'web/core.js',
  'web/views.js',
  'web/ui.js',
  'web/ops.js',
  'web/admin.js',
  'web/lock.js',
  'web/cloud.js',
  'web/boot.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        if (self.clients && self.clients.matchAll) {
          return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            list.forEach(c => { try { c.postMessage({ type: 'sw-update-ready' }); } catch {} });
          });
        }
      })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch { return; }
  const isSupaImg = url.hostname.includes('supabase.co') && url.pathname.includes('/storage/');
  if (isSupaImg) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => { const cp=res.clone(); caches.open(CACHE).then(c=>c.put(e.request, cp)); return res; }).catch(()=> r))
    );
    return;
  }
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');
  const isLib = url.hostname.includes('cdn.jsdelivr.net');
  if (isFont || isLib) {
    // كاش وقت التشغيل: الشبكة الأول + تخزين أوفلاين
    e.respondWith(
      fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  if (e.request.mode === 'navigate') {
    // صفحة التطبيق: الشبكة دايماً الأول → أي نشر جديد يوصل فوراً، والكاش للأوفلاين بس
    e.respondWith(
      fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put('index.html', cp)).catch(() => {});
        return r;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('index.html')))
  );
});

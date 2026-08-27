// Service Worker — 2M-Stor v18 (إصلاح تداخل أمازون عند النزول)
const CACHE = 'al-sayed-v18';
const URLS = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
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
            list.forEach(c => { try { c.postMessage({ type: 'sw-update-ready' }); } catch (err) {} });
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
  try { url = new URL(e.request.url); } catch (err) { return; }
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

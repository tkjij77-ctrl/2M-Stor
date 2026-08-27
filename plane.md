# 2M-Stor — الخطة الاحترافية v2 (بحث 2026)

> **الهدف:** تحويل `index.html:3710` (214KB) + `sw.js v15` + `cloud-schema.sql:240` من PWA بسيط على GitHub Pages إلى نظام احترافي Next.js 15 + Supabase Realtime v3 + Offline-First IndexedDB، مع الحفاظ على 229 صنف و Supabase `uzzxhbotbshsgpdnbrmd` بدون فقدان بيانات.

## 0- نتائج البحث (2026)

### Next.js 15 + Supabase Realtime
- **المصادر:** `noqta.tn 2026-02-16`, `stacknotice 2026-04-28`, `johal.in 2026-04-26`, `supabase/docs realtime-with-nextjs`
- **الخلاصة:** 
  - Next.js 15 يقلل كود الـ subscription من 42 → 12 سطر (-71%) عبر App Router + Server Components + Server Actions
  - Supabase Realtime v3 يستخدم MQTT 5.0 → p99 latency 11ms (كان 87ms) على 100 مستخدم متزامن، Free Tier 200 اتصال متزامن (كان 100)
  - **Dual clients إجباري:** `createBrowserClient` (client) + `createServerClient` مع `await cookies()` (server) عبر `@supabase/ssr` — لا تستخدم `supabase-js` مباشرة في App Router
  - **Middleware** لتجديد الـ session تلقائياً على كل request
  - **Realtime:** `sb.channel('db-changes').on('postgres_changes', {event:'*', schema:'public', table:'items'}, handler).subscribe()` + `return () => sb.removeChannel(channel)` + `eventsPerSecond:10` + `maxRetries` مع jitter و `on('system',{event:'disconnect'}, reconnect)`
  - **RLS** هي الأمن الحقيقي — لا تمرر `service_role` للعميل

### PWA Offline-First + IndexedDB
- **المصادر:** `needlecode 2025-12-27`, `veduis 2025-12-28`, `bytejournal 2026-07-15`, `pixelfreestudio 2024-07-20`
- **الخلاصة:**
  - `localStorage` حد 5MB متزامن → `IndexedDB` غير متزامن + معاملات + فهارس + سعة كبيرة (idb/Dexie)
  - **Pattern:** `Pending Sync Queue` + `Background Sync API` (عند عودة النت) + `Periodic Background Sync` (تحديث المخزون ليلاً) + `Navigation Preload` (إزالة تأخير بدء SW)
  - **CRDTs** للدمج بدون كتابة فوق — أو ببساطة `updated_at` يربح + `pendingHas(lid)` له أولوية (موجود `index.html:3362`)
  - **UI:** شارة Greyscale + `Sync Status` يوضح ما يُرفع
  - **اختبار:** Lighthouse PWA + `offline` في Network tab

### Inventory PWA + Barcode
- **المصدر:** `needlecode 2026-01-26` (Inventory Management PWA)
- **الخلاصة:**
  - **Shape Detection API** (ناتيف 2026) بدل `jsQR` الثقيل: `new BarcodeDetector({formats:['code_128','qr_code']})` → 60fps حتى في إضاءة ضعيفة
  - **Bin Location:** مسح `bin barcode` ثم `product barcode` لتتبع الرف
  - **Offline audit:** كل المخزون في IndexedDB → جرد كامل بدون شبكة + `Background Sync` عند العودة
  - **توفير:** لا حاجة لـ handheld بـ $1500 — أي هاتف يكفي

---

## 1- الوضع الحالي (مُحدّث بعد fحص 2026-08-27)

- **الإنتاج:** `index.html:3826` (بعد إصلاح `renderCats:1331` و `v15`) + `sw.js:15` NetworkFirst للـ navigate — يعمل لكن مونوليث 3826 سطر (CSS 851 + JS 2771) بلا HMR
- **السحابة:** `categories 5 / items 229 (77/49/45/45/13) / 26 متاح qs=12` بعد `dedupe 455→229` + `perf_indexes_v2` (pg_trgm + idx_items_category/display/updated) + `supabase_realtime` publication
- **Scaffold الجديد:** `app/page.tsx:12` placeholder + `app/product/[id]/page.tsx:7` وحيدة مكتملة + `components/shop-card.tsx` مع `Link` + `lib/db/indexedDB.ts` جاهز لكن غير مُستخدم في legacy + `lib/sync/outbox.ts:63` `throw not yet`
- **نقطة حرجة:** لا تحذف `index.html` قبل إكمال `useShop()` + `flushOutbox batch` + `dual clients` + `middleware`

---

## 2- المبادئ (ثابتة)

1. **السحابة مصدر الحقيقة** — `dbIsFactory:1070` guard + `onCloudSession:3474 if(dbIsFactory) db=[]`
2. **Idempotent + RLS** — `cloud-schema.sql:135` هو الأمن، `cats_read/items_read using(true)` يبقى
3. لا كسر بيانات — كل migration `if not exists`

---

## 3- المرحلة 1 — الأساسيات (3 أيام) — High

### 1.1 تفكيك index.html → Next.js 15 (يوم 1)
**كيف:**
1. `lib/supabase/client.ts` (browser) — `createBrowserClient(URL, KEY)` من `@supabase/ssr`
2. `lib/supabase/server.ts` (server) — `createServerClient(URL, KEY, {cookies:{getAll:()=>cookieStore.getAll(), setAll:(c)=>cookieStore.setAll(c)}})` — نحتاج `npm i @supabase/ssr`
3. `middleware.ts` — `createServerClient` + `await supabase.auth.getUser()` + `NextResponse.next({request})` لتجديد session (من `noqta.tn`)
4. `app/layout.tsx` يبقى `html lang ar dir rtl` + `app/globals.css` ينقل `:root` من `index.html:18-53`
5. `lib/db/types.ts` + `lid.ts` (getQ/qs/min/firstNum/genLid) + `defaultDB.ts` (يستورد `seed.json`)
6. `components/*` — `shop-card.tsx` (مع `loading=lazy` + `Link /product/[id]`) + `product-card.tsx` + `stat-row.tsx` + `cat-bar.tsx`
7. `app/(shop)/page.tsx` — Server Component يسحب `supabase.from('items').select('*').eq('deleted_at',null).limit(40)` + Client `ShopGrid` مع `useShop()` hook

**معيار النجاح:** `npm run build` أخضر، `app/page.tsx` يعرض 40 صنف من السحابة بدون `index.html`

### 1.2 Supabase migrations مسيّرة (يوم 1)
**كيف:**
- `supabase link --project-ref uzzxhbotbshsgpdnbrmd`
- `supabase migration list` → يجب 6: `secure_handle_new_user`, `harden_functions`, `remove_first_user_admin`, `open_shop_for_anon`, `dedupe_455_229`, `perf_indexes_v2`
- نقل `CACHE v15` لا يمس DB
- `.env.local` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ليس `ANON_KEY` القديم) + `SUPABASE_SERVICE_ROLE_KEY` للـ server فقط
- `supabase gen types typescript --linked > lib/supabase/database.types.ts` (موجود `296 سطر`)

**معيار النجاح:** `supabase db lint --linked` أخضر (تحذير واحد `my_role` مقصود)

### 1.3 CI/CD + PWA أوتوماتيك (يوم 2)
**كيف:**
- `.github/workflows/ci.yml` موجود — أضف `supabase db lint` يحتاج `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` في Secrets
- `vercel.json` موجود — اربط `tkjij77-ctrl/2M-Stor` في Vercel، ضع `NEXT_PUBLIC_*` في Project Env، `git push` → Preview
- `next.config.js` `next-pwa` → `dest:public, register:true, skipWaiting:true, runtimeCaching:[{urlPattern:/supabase\.co\/rest\/v1\/.*/, handler:'NetworkFirst', options:{cacheName:'supabase-cache', expiration:{maxEntries:64, maxAgeSeconds:300}}}]` (من البحث)
- احذف `sw.js` اليدوي بعد تفعيل `next-pwa` (يولد hash)

**معيار النجاح:** push → CI أخضر → Vercel Preview → Production

---

## 4- المرحلة 2 — الموثوقية (4 أيام) — High

### 2.1 Realtime بدل polling (يوم 3)
**كيف (من johal.in + supabase/docs):**
```ts
// lib/supabase/realtime.ts
export function subscribeShop(onChange:()=>void){
  const ch = supabase.channel('al-sayed-live', {config:{broadcast:{self:false}}})
    .on('postgres_changes',{event:'*', schema:'public', table:'categories'}, onChange)
    .on('postgres_changes',{event:'*', schema:'public', table:'items'}, onChange)
    .on('postgres_changes',{event:'*', schema:'public', table:'settings'}, onChange)
    .on('system',{event:'disconnect'}, ()=> setTimeout(()=>subscribeShop(onChange), 1000+Math.random()*2000))
    .subscribe((s)=>{ if(s==='SUBSCRIBED') console.log('realtime ok') });
  return ()=> supabase.removeChannel(ch);
}
```
- في `index.html:3135 subscribeRealtime()` موجود لكن ناقص `removeChannel` + `eventsPerSecond:10` + `on disconnect`
- في Next.js: `useEffect(()=>{ const unsub=subscribeShop(()=>queryClient.invalidateQueries(['items'])); return unsub; },[])`
- قلل `schedulePush 500ms` موجود، و `pullAll 30s:3835` → `5s` fallback فقط عند `!realtime`
- **لا** تسحب الكل على كل حدث — استخدم `payload.new` لتحديث صف واحد بدل `pullAll()` الكامل (تحسين لاحق)

**معيار النجاح:** تعديل سعر على الكمبيوتر يظهر على الهاتف <1ث، لا `Network` 4 requests كل مرة

### 2.2 IndexedDB + صور (يوم 4)
**كيف (من needlecode + veduis):**
- `lib/db/indexedDB.ts` موجود `idb` ثلاث stores `db/invoices/outbox` — فعّله في `index.html`: استبدل `localStorage.setItem('al_sayed_db')` بـ `await setIDB('db', db)` مع fallback
- `lib/sync/image.ts` + `index.html:3168 compressImageDataUrl` → `canvas 1024px 0.7` قبل `sb.storage.from('products').upload(path, blob, {upsert:true})` — موجود لكن لم يُعمم على كل `item-ins/item-upd`
- `supabase storage transform` للـ thumbnails: `sb.storage.from('products').getPublicUrl(path, {transform:{width:200, height:200}})`
- `lib/sync/outbox.ts:63` أكمل `applyEntry` بالـ batch: `const payloads = outbox.filter(o=>o.t==='item-ins').map(...); await sb.from('items').insert(payloads).select()`

**معيار النجاح:** صورة 3MB → <200KB، لا `quota exceeded`، جرد 229 صنف يعمل أوفلاين

### 2.3 مراقبة (يوم 5)
**كيف:** `lib/sentry.ts:3` موجود `tracesSampleRate 0.2` — أضف `Sentry.init({dsn: process.env.NEXT_PUBLIC_SENTRY_DSN})` في `app/layout.tsx`
- `PostHog` لأحداث `add_to_cart`, `checkout`, `stock_low`
- `audit_log` يبقى لكن أضف `user_agent`

**معيار النجاح:** خطأ `applyEntry` يظهر في Sentry مع `outbox` snapshot

---

## 5- المرحلة 3 — التوسع (5 أيام) — Medium

### 3.1 فصل المتجر/الإدارة (يوم 6)
**كيف:**
- `app/(shop)/layout.tsx` — `cats_read/items_read using(true)` بدون `middleware`
- `app/admin/*` — `middleware.ts:6` يفحص `sb-access-token` + `my_role in ('admin','worker')` → redirect `/login` لو `customer`
- `PERM_LABELS:2727` يدار من `settings.role_perms` عبر UI `app/admin/perms/page.tsx`

### 3.2 باركود + مواقع (يوم 7) — من needlecode 2026-01-26
**كيف:**
```ts
// lib/barcode/detector.ts
let detector: any = null;
try{ detector = new (window as any).BarcodeDetector({formats:['code_128','qr_code','ean_13']}); } catch{}
export async function scanNative(video: HTMLVideoElement){
  if(detector) return detector.detect(video);
  return window.jsQR ? [window.jsQR(...)] : [];
}
```
- استبدل `jsQR@1.4.0` الثقيل بـ `BarcodeDetector` الناتيف (60fps) مع fallback
- `Bin Location` — جدول `bins(id, barcode, location)` + عند المسح: أولاً `bin barcode` ثم `product barcode`

### 3.3 تقارير ومخزون ذكي (يوم 8)
**كيف:**
- `app/admin/dashboard/page.tsx` — `supabase.from('invoices').select('created_at,total').gte('created_at', startOfDay)` → مبيعات يوم/شهر
- `supabase.from('invoice_items').select('item_name, qty').order('qty',{ascending:false}).limit(5)` → الأكثر مبيعاً
- `supabase.from('items').select('*').lte('stock_q', supabase.raw('min_alert')).eq('deleted_at',null)` → على وشك النفاد
- تصدير `PDF` عبر `jsPDF` + طباعة حرارية `80mm` عبر `window.print()` مع `@media print`

**معيار النجاح:** مدير يرى "5 منتجات على وشك النفاد" في `dash-card`

---

## 6- خطة التنفيذ المتوازي (مُحدّثة)

| المسار | الملفات | يعتمد | مدة |
|-------|---------|-------|-----|
| A — dual clients + middleware | `lib/supabase/client.ts`, `server.ts`, `middleware.ts` | — | 0.5ي |
| B — تفكيك shop | `app/(shop)/page.tsx`, `components/shop-card.tsx`, `useShop.ts` | A | 1ي |
| C — Realtime v3 | `lib/supabase/realtime.ts`, `index.html:3135` | A,B | 0.5ي |
| D — IndexedDB | `lib/db/indexedDB.ts`, `lib/sync/*` | A | 1ي |
| E — barcode native | `lib/barcode/*` | D | 0.5ي |
| F — admin/reports | `app/admin/*`, `middleware.ts` | A | 1ي |

كل المسارات تنطلق بعد `plane.md v2`، مزامنة يومية.

---

## 7- المخاطر والتخفيف (مُحدّث)

- **Realtime يقطع:** استخدم `on('system','disconnect')` + `removeChannel` + `maxRetries` — لا `retry` على `RLS denied`
- **IndexedDB quota:** نظف `deleted_at` كل `pullAll` (موجود `alive Set:3328`) + `Periodic Background Sync` ليلاً
- **BarcodeDetector غير مدعوم:** fallback `jsQR` موجود `index.html:9`
- **PWA cache قديم:** `next-pwa` hash بدل `CACHE v15` اليدوي

---

## 8- التسليم

- `main` محمي + CI أخضر + `supabase db lint` + `tests/e2e/shop.spec.ts`
- Vercel `2m-stor.vercel.app` + GitHub Pages redirect
- وثائق `docs/sync.md` (outbox→Realtime→BackgroundSync) + `docs/rls.md` (anon read, worker write)

---
*تم التحديث: 2026-08-27 — بعد فحص `index.html:3826` + `supabase` + `Next.js scaffold` + بحث ويب 2026 (Next.js 15, Supabase Realtime v3, PWA Offline-First, BarcodeDetector)*

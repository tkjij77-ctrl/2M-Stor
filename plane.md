# 2M-Stor — خطة الترقية الاحترافية (plane.md)

> **الهدف:** تحويل التطبيق الحالي (ملف واحد `index.html:3721` + `sw.js` + `cloud-schema.sql:240`) من PWA بسيط على GitHub Pages إلى نظام احترافي قابل للصيانة والتوسع، مع الحفاظ على البيانات الحالية في Supabase `uzzxhbotbshsgpdnbrmd`.

## الوضع الحالي (Baseline)

- **الواجهة:** ملف واحد `index.html:3721` (214KB) + CSS inline + JS vanilla، `manifest.json`، `sw.js:70` (v11 حالياً)، `icon-*.png`
- **الخلفية:** Supabase (Auth + Postgres + Storage `products` + RLS). `cloud-schema.sql` يعمل idempotent لكن خارج `supabase/migrations/`
- **المزامنة:** outbox محلي `localStorage al_sayed_db` → `flushOutbox:3187` كل 1.5s → `pullAll:3213` كل 30s (polling)، `itemPayload:3079` يحمل `display_qs`
- **النشر:** GitHub Pages `tkjij77-ctrl/2M-Stor`، `CANONICAL_CLOUD` يحوي anon key مضمن، لا CI/CD، لا اختبارات
- **المشاكل المثبتة:** تكرار بيانات المصنع `dbIsFactory:1047` → أوفلاين→سحابة، عرض `غير متوفر` بسبب `display_qs=0` على السحابة، مفاتيح ظاهرة في الشات

## المبادئ

1. **السحابة مصدر الحقيقة** للعملاء؛ الجهاز الجديد لا يرفع بيانات المصنع (`dbIsFactory` guard)
2. **Idempotent migrations** + RLS هو الأمن الحقيقي، المفتاح العام بالتصميم
3. لا كسر للبيانات الحالية — الترحيل يحافظ على `categories`/`items`/`invoices`

---

## المرحلة 1 — الأساسيات (أسبوع 1) — High Priority

### 1.1 تفكيك `index.html` → هيكلة احترافية
- **Stack:** Next.js 15 (App Router) + TypeScript strict + Tailwind + shadcn/ui + Tajawal
- **الهيكلة:**
  ```
  /app/(shop)/page.tsx       — واجهة المتجر `renderShopView:1423`
  /app/(stock)/page.tsx      — المخزن `renderAll:1286` + `getFilteredItems`
  /app/cart/page.tsx         — السلة `cart-overlay`
  /app/dashboard/page.tsx    — لوحة التحكم `toggleDashboard`
  /components/*              — product-card, shop-card, login, burger-menu, stat-row
  /lib/supabase/*            — client, auth, sync (outbox/pullAll)
  /lib/db/*                  — types, getDefaultDB, getQ/getQs/getMin
  /lib/sync/*                — outbox, itemPayload, mergeItems/mergeCats
  ```
- **الخطوات:**
  1. `npx create-next-app@latest 2m-stor --ts --tailwind --app`
  2. نقل CSS من `<style>:17-868` إلى `app/globals.css` + متغيرات `:root`
  3. فصل JS إلى modules: `lib/db.ts` (getDefaultDB), `lib/sync.ts` (queue/schedulePush/flushOutbox/pullAll/merge), `lib/auth.ts` (cloudDoLogin etc.)
  4. استبدال `localStorage` المباشر بـ hook `useLocalDB()` + IndexedDB fallback
- **معيار النجاح:** `npm run build` ينجح، Lighthouse >90، لا `index.html` مونوليث

### 1.2 نقل قاعدة البيانات لـ `supabase/migrations`
- `supabase init` + `supabase link --project-ref uzzxhbotbshsgpdnbrmd`
- `supabase migration new baseline` — نقل `cloud-schema.sql` كاملاً (handle_new_user:87, touch_updated_at:119, RLS:137-235, Storage buckets:217)
- إضافة `supabase/config.toml` + `.env.local` (لا `CANONICAL_CLOUD` مضمن)
- تدوير المفاتيح: `supabase keys` جديدة + تحديث Vercel env
- `supabase db push` + `supabase gen types typescript --local > lib/supabase/types.ts`
- **معيار النجاح:** `supabase db lint` أخضر، `get_advisors: performance/security` = 1 تحذير مقصود (`my_role` authenticated)

### 1.3 CI/CD + نشر احترافي + PWA أوتوماتيك
- **.github/workflows/ci.yml:** `lint` + `typecheck` + `vitest` + `playwright` + `supabase db lint --linked`
- **Vercel:** ربط `tkjij77-ctrl/2M-Stor`، env `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`، Preview Deployments لكل PR
- **PWA:** `next-pwa` يولد `sw.js` بـ hash بدل `CACHE='al-sayed-v11:4'` اليدوي
- **معيار النجاح:** push → CI أخضر → Preview URL → merge → Production

---

## المرحلة 2 — الموثوقية (أسبوع 2) — Medium Priority

### 2.1 مزامنة Realtime بدل polling
- **حالي:** `schedulePush 1500ms:3070` + `pullAll 30s:3648` + `setInterval`
- **جديد:** `sb.channel('db-changes').on('postgres_changes', {event:'*', schema:'public', table:'items'}, handleRealtime)` + `categories`/`invoices`
- تقليل `1500ms → 500ms` + `30s → 5s` fallback + `isOnline()` مع `navigator.onLine` و exponential backoff
- **Batch inserts:** `sb.from('items').insert(payloads).select()` بدل حلقة `await applyEntry` واحدة واحدة
- **معيار النجاح:** تعديل على الكمبيوتر يظهر على الهاتف <1ث، لا تكرار `qs:0`

### 2.2 IndexedDB + تحسين الصور
- استبدال `localStorage al_sayed_db` (حد 5MB) بـ **IndexedDB** (`idb` أو `dexie`) — يحل مشكلة الحجم للصور base64 `item.img`
- `uploadItemImage:3094`: ضغط قبل الرفع (`canvas.toBlob(0.7)`, max 1024px) + `image_url` بدل `img` base64
- `Storage bucket products` يبقى public read، لكن تحويل لـ `supabase storage transform` للـ thumbnails
- **معيار النجاح:** صورة 3MB → <200KB قبل الرفع، لا `localStorage quota exceeded`

### 2.3 المراقبة
- **Sentry** (أخطاء JS) + **PostHog** (أحداث: login, add_to_cart, checkout)
- `logAction` الحالي → `audit_log:74` يبقى لكن يضاف `user_agent`, `ip`
- **معيار النجاح:** خطأ في `applyEntry` يظهر في Sentry مع `outbox` snapshot

---

## المرحلة 3 — التوسع (أسبوع 3) — Medium Priority

### 3.1 فصل المتجر / الإدارة
- `/ (shop)` — للعميل: تصفح + سلة، RLS `cats_read/items_read: using (true)` (تم بالفعل `open_shop_for_anon`)
- `/admin/*` — للمدير/العامل: `stock`, `add`, `del`, `dash`, `history` محمية بـ `my_role in ('admin','worker')` + middleware Next.js
- `PERM_LABELS:3573` يبقى لكن يدار من `settings.role_perms` عبر UI
- زر **"ارفع متجري للسحابة"** `pushStoreToCloud:3332` يبقى كـ admin action

### 3.2 تقارير ومخزون ذكي
- Dashboard: مبيعات يومية/شهرية (`invoices:44` + `invoice_items:57`)، أكثر مبيعاً، تنبيه `min_alert:34` و `stock_q/display_qs`
- تصدير PDF/Excel للفواتير، طباعة حرارية 80mm
- **معيار النجاح:** مدير يشوف "منتجات على وشك النفاد" < `min_alert` في `dash-card:445`

### 3.3 الجودة
- **اختبارات:** Vitest (unit: getQ/getQs/firstNum) + Playwright (E2E: login → add item → sync → phone shows)
- **أمان:** تدوير المفاتيح، `my_role` revoke/grant:156-159 يبقى، CSP headers في `next.config.js`
- **أداء:** `product-grid:271` و `shop-grid:347` مع virtualization لو >500 صنف

---

## خطة التنفيذ المتوازي

| المسار | المسؤول | الملفات | يعتمد على |
|-------|---------|---------|-----------|
| A — هيكلة الواجهة | FE | `app/*`, `components/*`, `lib/*` | — |
| B — Supabase migrations | BE | `supabase/migrations/*`, `supabase/config.toml`, `.env` | — |
| C — CI/CD + PWA | DevOps | `.github/workflows/*`, `next-pwa`, `vercel.json` | A |
| D — Realtime + IndexedDB | FE/BE | `lib/sync/*`, `lib/db/indexedDB.ts` | A,B |
| E — Store/Admin فصل | FE | `app/(shop)`, `app/admin`, `middleware.ts` | A |
| F — مراقبة وتقارير | Full | `lib/sentry.ts`, `app/dashboard/*` | A,B |

كل المسارات تنطلق متوازية بعد تثبيت `plane.md`، مع مزامنة يومية (merge).

## المخاطر والتخفيف

- **فقدان بيانات المصنع:** `dbIsFactory` guard موجود؛ `cloudFullReplace:3332` يحذف السحابة — يُستخدم فقط من جهاز المدير الأساسي بعد تأكيد
- **RLS يكسر القراءة:** `cats_read/items_read using (true)` تم اختباره anon يقرأ — لا رجعة لـ `auth.uid() is not null`
- **حجم الصور:** حد 2MB + ضغط يمنع `localStorage quota`

## التسليم

- `main` محمي، PRs + CI أخضر
- Supabase project `uzzxhbotbshsgpdnbrmd` على migrations مسيّرة
- Vercel Production: `2m-stor.vercel.app` (أو نفس دومين GitHub Pages مع redirect)
- وثائق: `README.md` + `docs/sync.md` + `docs/rls.md`

---
*تم إنشاؤه: 2026-08-26 — بناءً على تحليل مباشر لـ `index.html:3721` و `cloud-schema.sql:240` و `sw.js:70`*

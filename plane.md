# 2M-Stor — الخطة الاحترافية v3 (بحث 2026 + لاندنج مرجعية)

> **الهدف:** ترقية `index.html:3888` (240KB) + `sw.js v19` + `cloud-schema.sql` من نظام مخزن وظيفي إلى متجر احترافي بلاندنج تسويقية، مع الحفاظ على 229 صنف + Supabase `uzzxhbotbshsgpdnbrmd` + Realtime + أوفلاين. لا حذف لـ `index.html` قبل اكتمال الترحيل.

## 0- نتائج البحث (2026) — تحديث 2026-08-27

### Landing Hero + Blob Morph 2026
- **المصادر:** `empire-ui 2026-08-04` (Landing Page Patterns), `effect-labs 2026-02-04` (Fluid Blob), `landingpageflow 2026-02-03` (Animation Best Practices)
- **الخلاصة:**
  - Split 60/40 (نص 60% / بصري 40%) يتفوق على 50/50 — عنوان + CTA يأخذ وزن أكبر
  - Blob Morph بـ `border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%` + `@keyframes blobMorph 8s ease-in-out infinite` + `will-change:transform` — بدون SVG/Three.js، GPU فقط
  - `float-card` طافية `translateY(-14px) 4s infinite` + تأخير 1.5s للثانية
  - عدادات متحركة `requestAnimationFrame` بزيادة `Math.ceil(target/60)` حتى الهدف
  - قاعدة 2026: حركة هادفة فقط، مدة طويلة 8-12s، `prefers-reduced-motion:reduce` يوقفها، تجنب parallax المعقد

### Ecommerce Shop: Filters + Sort + Wishlist 2026
- **المصادر:** `savetowishlist 2026-06-15` (Baymard + NNG), `wisepim 2026-03-15`, `hypotenuse 2026-05-30`
- **الخلاصة:**
  - **5 فلاتر أساسية:** قسم + سعر + تقييم + توفر + بحث نصي
  - **4 ترتيبات متوقعة:** سعر منخفض→مرتفع، مرتفع→منخفض، تقييم، الأكثر مبيعاً/جديد — 64% من المتاجر تفتقد واحداً
  - **لا Infinite Scroll** (NNG تحذر) — استخدم `Load More` + pagination رقمّي (مطبق `shopPageSize 40:1119`)
  - **Sidebar على ديسكتوب + Modal كامل على موبايل** — لا شريط أفقي (يُهمل ويكسر مع فلاتر كثيرة)
  - **Wishlist** تزيد عودة الزوار + AOV — زر `fav-btn` على كل `product-img` + badge `favCount`
  - **No-Code DDD:** الفلاتر تمثيل لجودة البيانات — taxonomy مسطحة تقتل التحويل

### PWA Ecommerce 2026
- **المصدر:** `shopify 2026-07-02`
- **الخلاصة:** 3 تقنيات: `Service Worker` (وسيط شبكة/كاش/أوفلاين) + `Web App Manifest` (name/icon/display) + `App Shell` (هيكل/هيدر/تنقل كاش فوري، محتوى لاحق)
- **Next.js 15 + Supabase Realtime v3** (من v2): Dual clients + Middleware + `channel.on(postgres_changes).subscribe()` + `removeChannel` + `eventsPerSecond:10`

### المرجعية المحلية (landing HTML المرسل)
- هيدر `scrolled` + `hero-grid 1.1/.9` + `features 4` + `products 4` + `testimonials 3` + `footer 4` + `shop controls` + `cart-layout 1fr 360px` + `account-grid 240/1fr` + `admin stats 4`
- نقاط قوة نأخذها، نقاط ضعف نتجنبها (`localStorage` فقط بلا Supabase)

---

## 1- الوضع الحالي (فحص 2026-08-27)

- **الإنتاج:** `index.html:3888` (CSS 953 + JS 2935) مونوليث، `sw.js v19` (NetworkFirst للـ navigate + كاش صور Storage + runtime)، `manifest.json:906`
- **السحابة:** `categories 5 / items 229 (مكررة كانت 455) / qs=12` بعد `dedupe` + `perf_indexes_v2` + `supabase_realtime`
- **تحسينات v19 المنفذة:** `preconnect/preload/defer` + `content-visibility:auto` + `lazy/decoding async` + `ResizeObserver+RAF` + `requestIdleCallback` + `overscroll:contain` + استجابة `320/360/480/768/1024/1280`
- **Scaffold Next.js:** `app/page.tsx`, `app/product/[id]/page.tsx`, `components/shop-card.tsx`, `lib/*` جاهز لكن غير مستخدم — **لا تحذف `index.html` قبل اكتمال `useShop`**
- **المشكلة الحالية:** بلا لاندنج تسويقية، shop بدون sort/fav/خصم، cart بلا شحن، لا wishlist، لا `breadcrumb`

---

## 2- المبادئ (ثابتة)

1. **السحابة مصدر الحقيقة** — `dbIsFactory:1114` guard + `onCloudSession if(dbIsFactory) db=[]`
2. **RLS هو الأمن** — `cats_read/items_read using(true)` يبقى
3. لا كسر بيانات — كل migration `if not exists`
4. **هجين ذكي:** نأخذ UI المرجعية + نُبقي sync/أدوارنا

---

## 3- المرحلة 1 — لاندنج + هيدر (يوم 1) — High

### 3.1 كيف ننفذ (تفصيلي)
1. **CSS جديد في `index.html:17` (قبل `</style>`):**
   - `hero{padding:50px 0 70px; position:relative} + ::before radial-gradient` (نسخ من مرجعية `hero::before`)
   - `.hero-grid{grid-template-columns:1.1fr .9fr; gap:50px}` + `@media 900px → 1fr`
   - `.blob{width:360px;height:360px; background:linear-gradient(primary,primary-2); border-radius:42% 58% 63% 37%/41% 44% 56% 59%; animation:morph 8s infinite}` + `@keyframes morph`
   - `.float-card{position:absolute; background:var(--card); border:1px solid var(--border); animation:floaty 4s}` + `.fc1 top20 right-10 + .fc2 bottom40 left-20 delay1.5s`
   - `.features{grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:24px}` + `.feature:hover translateY(-8px)`
   - `.testimonials`, `.footer-grid` كما المرجعية مع `var(--*)` الحالية

2. **HTML/JS `viewHome`:**
   - دالة `renderHome()` تُحقن في `view-root` عند `currentView==='home'` (view جديد ثالث بجانب stock/shop)
   - `hero h1: 3.2rem → 2.2rem @768px` + `badge ⭐ المنصة الأولى`
   - عدادات: `document.querySelectorAll('[data-count]').forEach(el=>{let c=0,t=+el.dataset.count, step=Math.ceil(t/60); tick()=>{c+=step; if(c>=t) el.textContent=t else requestAnimationFrame(tick)}})`
   - featured: `DB.products.slice(0,4)` + `productCard` الموجود + زر `عرض كل المنتجات → setView('shop')`

3. **الهيدر:**
   - إضافة `nav-links` أفقية على `>768px` (الرئيسية/المتجر/من نحن/تواصل) — تختفي على `<768px` وتصبح `burger-menu` الحالية
   - `scroll` listener: `header.classList.toggle('scrolled', scrollY>40)` + `to-top` يظهر `>500px` (من مرجعية `scroll`)
   - `loader #loader.hide` بعد `load+500ms`

**معيار النجاح:** `home` تظهر أولاً لغير المسجل، `shop` تبقى كما هي، لا كسر `renderAll`

### 3.2 ترقية Shop (نفس اليوم)
1. **Controls:** إضافة `sort-select` (افتراضي/سعر↓/سعر↑/تقييم) + الاحتفاظ بـ `cat-bar` كفلتر (5 أنواع)
   - `getFilteredItems` يضيف `sort: low/high/stars/best` (best = `qs` الأعلى)
2. **Cards:** إضافة `product-tag خصم` (إذا `old` موجود) + `fav-btn ❤️` (يخزن `localStorage al_sayed_fav` + `badge favCount`)
   - `fav` يToggle بدون Supabase (مرحلة لاحقة: جدول `favorites`)
3. **No infinite scroll:** الإبقاء على `Load More:40` (مرجعية تؤكد صحته)

---

## 4- المرحلة 2 — سلة/تفاصيل/حساب (يوم 2) — High

### 4.1 سلة + شحن
- `cart-layout: grid 1fr 360px @900px → 1fr` + `summary sticky top100px` + `shipping 20 مجاني>200`
- إضافة `coupon` input (واجهة فقط حالياً)

### 4.2 تفاصيل منتج
- إضافة `breadcrumb الرئيسية/المتجر/الاسم` فوق `amz-layout`
- `pd-meta 3` (توصيل/مخزون/إرجاع) تحت السعر

### 4.3 حساب بسيط
- `account-grid 240/1fr` + تبويب `profile/orders` (orders = `invoices` الحالية مؤقتاً)

---

## 5- المرحلة 3 — Next.js ترحيل (يوم 3-5) — Medium

- **3a:** `lib/supabase/client.ts` + `server.ts` + `middleware.ts` (من v2)
- **3b:** تفكيك `index.html` → `app/(shop)/page.tsx` + `components/*` + `useShop()`
- **3c:** Realtime `removeChannel` + `IndexedDB` + `BarcodeDetector` (كما v2)

---

## 6- خطة التنفيذ المتوازي (محدثة v3)

| المسار | الملفات | يعتمد | مدة |
|-------|---------|-------|-----|
| A — landing hero | `index.html` CSS+JS `renderHome` | — | 0.5ي |
| B — header/footer | `index.html` header/nav + `footer` | A | 0.25ي |
| C — shop upgrade | `shop-controls` + `fav` + `sort` | A | 0.25ي |
| D — cart/pd | `cart-layout` + `breadcrumb` | C | 0.5ي |
| E — Next.js dual | `lib/supabase/*`, `middleware` | — | 1ي |

A-D تنفذ في `index.html` مباشرة (لا تعطيل المتجر)، E بالتوازي.

---

## 7- المخاطر

- **Blob ثقيل على موبايل ضعيف:** `prefers-reduced-motion` يوقف + `will-change:transform` فقط
- **Fav بدون sync:** مقبول مؤقتاً — لاحقاً جدول `favorites(user_id, item_id)`
- **PWA cache:** `sw v19` يبقى — لا `next-pwa` قبل اكتمال Next.js

---

## 8- التسليم v3

- `index.html` بلاندنج + shop محسن + cart شحن + footer (كل الشاشات)
- `sw v20` + CI أخضر + `plane.md v3`
- لاحقاً: Vercel + Next.js ترحيل

---
*تم التحديث: 2026-08-27 — بعد فحص `index.html:3888` + `sw v19` + بحث 2026 (Landing 08-04, Filters 06-15, PWA 07-02) + لاندنج مرجعية*

# 2M-Stor — الخطة الاحترافية v3.1 (بحث 2026 + لاندنج مرجعية) — مكتملة

> **الهدف:** ترقية `index.html:4153` (257KB) + `sw.js v21` + `cloud-schema.sql` من نظام مخزن وظيفي إلى متجر احترافي بلاندنج تسويقية + سلة/حساب متكاملة، مع الحفاظ على 229 صنف + Supabase `uzzxhbotbshsgpdnbrmd` + Realtime + أوفلاين. لا حذف لـ `index.html` قبل اكتمال الترحيل إلى Next.js.

---

## 0- نتائج البحث (2026) — تحديث 2026-08-27

### A. Landing Hero + Blob Morph 2026
- **المصادر:** `empire-ui 2026-08-04` (Landing Patterns: split 60/40 يفوق 50/50)، `effect-labs 2026-02-04` (Fluid Blob: `border-radius` morph)، `landingpageflow 2026-02-03` (Animation: هادفة 8-12s، `prefers-reduced-motion`)
- **الخلاصة العملية:**
  - `hero-grid: 1.1fr .9fr` (نص 60% / بصري 40%) + `@media 900px → 1fr` + `hero::before radial-gradient` خلفية
  - `blob: 340px → 240px @900px` + `border-radius: 42% 58% 63% 37%/41% 44% 56% 59%` + `@keyframes morph 8s ease-in-out infinite` + `will-change:transform` — GPU فقط، لا SVG/Three.js
  - `float-card: translateY(-14px) 4s infinite` + `fc2 delay 1.5s`
  - عدادات: `requestAnimationFrame` بزيادة `Math.ceil(target/60)` حتى الهدف + `toLocaleString('ar-EG')`
  - قاعدة: حركة واحدة كبيرة per section، `prefers-reduced-motion:reduce` يوقفها

### B. Ecommerce Shop: Filters + Sort + Wishlist 2026
- **المصادر:** `savetowishlist 2026-06-15` (Baymard 64% تفتقد ترتيب + NNG: لا infinite scroll)، `wisepim 2026-03-15` (Sidebar ديسكتوب + Modal موبايل، taxonomy تقتل التحويل)، `hypotenuse 2026-05-30` (5 فلاتر أساسية)
- **الخلاصة العملية:**
  - **5 فلاتر:** قسم + سعر + تقييم + توفر + بحث نصي — عندنا 3 فقط (قسم/توفر/بحث)
  - **4 ترتيبات متوقعة:** سعر ↓↑، تقييم، الأكثر مبيعاً/جديد — ناقصة عندنا
  - **لا Infinite Scroll** — استخدم `Load More:40` (مطبق `shopPageSize 40:1183` صحيح، نحتفظ به)
  - **Wishlist** تزيد عودة الزوار + AOV — زر `fav-btn ❤️` على كل `product-img` + `badge favCount` + `localStorage al_sayed_fav` (لاحقاً جدول `favorites`)
  - **منتج خصم:** `product-tag` + `old price مشطوب` (`امازون يطبق`، نحن بلا `old`)

### C. PWA Ecommerce 2026
- **المصدر:** `shopify 2026-07-02` — 3 ركائز: `Service Worker` (وسيط/كاش/أوفلاين) + `Web App Manifest` + `App Shell` (هيكل كاش فوري، محتوى لاحق) — عندنا `sw v21` NetworkFirst للـ navigate + كاش صور Storage + runtime للخطوط

### D. Next.js 15 + Supabase Realtime v3 (من v2)
- **المصادر:** `noqta.tn 2026-02-16`, `stacknotice 2026-04-28`, `johal.in 2026-04-26`, `supabase/docs`
- **الخلاصة:** Dual clients (`createBrowserClient` + `createServerClient` مع `await cookies()`) + `middleware` تجديد session + `channel.on(postgres_changes).subscribe()` + `removeChannel` + `eventsPerSecond:10` + `on('system','disconnect')` مع jitter

### E. المرجعية المحلية (landing HTML المرسل 2026-08-27)
- **نأخذ:** هيدر `scrolled` + `hero-grid 1.1/.9` + `features 4` + `products 4` + `testimonials 3` + `footer 4` + `shop-controls` (search+sort+filters) + `cart-layout 1fr 360px sticky` + `account-grid 240/1fr` + `admin stats 4 + table-wrap`
- **نتجنب:** `localStorage` فقط بلا Supabase — نبقي `lid/cid/outbox/Realtime/RLS`

---

## 1- الوضع الحالي (فحص دقيق 2026-08-27 بعد b562420)

| الملف | الحالة |
|-------|--------|
| `index.html:4153` (257KB) | مونوليث: CSS `~1050` سطر (حتى `1017` + لاندنج `~120` سطر جديد) + JS `~3100` سطر. لاندنج v3 منفذة جزئياً: `hero/blob/features/testimonials` + `homeView` + `header scrolled` + `footer` + `loader/to-top`. ناقص: `shop sort/fav/خصم`, `cart شحن/coupon`, `pd breadcrumb/meta`, `account/orders`, `admin table` |
| `sw.js v21` | NetworkFirst للـ navigate + كاش `supabase.co/storage` (cache-first) + runtime للخطوط + `CACHE al-sayed-v21` |
| `manifest.json` | `name 2M-Stor`, `icons 192/512`, `display standalone`, `theme #0d4f6c` |
| `cloud-schema.sql` | `categories/items/invoices/invoice_items/profiles/settings` + `RLS` + `supabase_realtime` publication + `storage products` |
| السحابة | `categories 5 / items 229` (كانت 455) بعد `dedupe:74b87dc` + `perf_indexes_v2` (pg_trgm + 3 idx) + `qs` متاح `~12` فقط (تحتاج تعبئة) |
| محلي | `al_sayed_db` + `al_sayed_db` + `al_sayed_outbox` + `al_sayed_fav` (جديد) + `al_sayed_role_perms` |
| تحسينات v21 | `preconnect 4` + `preload` + `supabase blocking` (إصلاح `defer` bug) + `content-visibility:auto` + `lazy/decoding async` كل الصور + `ResizeObserver+RAF` للهيدر + `requestIdleCallback` للسحب + `overscroll:contain` + استجابة `320/360/480/768/1024/1280` + لاندنج |
| Scaffold Next.js | `app/page.tsx:12` placeholder + `app/product/[id]/page.tsx:7` + `components/shop-card.tsx` + `lib/supabase/*` (+ `middleware.ts:1216`) + `lib/db/indexedDB.ts` + `lib/sync/outbox.ts` (`throw` غير مكتمل) — **غير مستخدم** |
| المشكلة الحالية | لاندنج موجودة لكن `shop` بلا ترتيب/مفضلة/خصم، `cart` بلا شحن، `login defer` مصلح حديثاً `b562420`، `home` افتراضي `home` قد يربك المدير (يحتاج `stock` افتراضي للمدير) |

---

## 2- المبادئ (ثابتة لا تُكسر)

1. **السحابة مصدر الحقيقة** — `dbIsFactory:1177` guard: `if(dbIsFactory) db=[]` قبل `pullAll`، لا ترفع `qs=0` وهمي
2. **RLS هو الأمن** — `cats_read/items_read using(true)` تبقى، `service_role` لا يمر للعميل
3. **لا كسر بيانات** — كل migration `if not exists` + `alive Set` في `mergeCats:3380` / `mergeItems:3394` يحذف المكرر `455→229`
4. **هجين ذكي:** UI من المرجعية + Sync/أدوارنا (`lid/cid/outbox/Realtime`)
5. **محافظ على التوافق:** أي تغيير يحافظ على `localStorage al_sayed_db` كـ fallback + `fallback local login` عبر `forceLocalLogin()`

---

## 3- المرحلة 1 — إكمال اللاندنج + ترقية المتجر (يوم 1-2) — High — **متبقي 60%**

### 3.1 لاندنج — مكتمل 90% (b562420) — ما تبقى
- **منجز:** `hero` + `blob morph` + `float-card` + `features 4` + `products مميزة 4` + `testimonials 3` + `footer 4` + `header scrolled` + `to-top` + `loader` + `homeView toggle` في `index.html:1018-1112` + `renderHome():~1410`
- **متبقي دقيق:**
  1. اجعل `home` افتراضي للزائر فقط، و `stock` للمدير/عامل: في `applyRoleUI():~3100` إضافة `if(sessionRole==='admin'||sessionRole==='worker' && currentView==='home') setView('stock')` أو احتفظ `home` للجميع مع زر واضح `→ المخزن` للمدير
  2. أضف `about/contact` كـ `landing-section` داخل `homeView` (نسخ من مرجعية `viewAbout/viewContact`) — يُنفذ كـ `div id="about"` + `scrollIntoView` الموجود
  3. صحح `hero p` اتجاه `rtl` + `grad` يظهر في `dark` (أضف `color:var(--text-main)` fallback)

- **كود مباشر (انسخ):**
  ```js
  // في applyRoleUI() بعد setCloudStatus
  if((sessionRole==='admin'||sessionRole==='worker') && currentView==='home' && !localStorage.getItem('al_sayed_seen_home')){
    localStorage.setItem('al_sayed_seen_home','1');
    // اترك home للمرة الأولى ثم يمكن للمدير التبديل
  }
  ```

- **معيار النجاح:** زائر يرى `hero` أولاً + مدير يرى `stock` بضغطة واحدة، لا كسر `renderAll`

### 3.2 ترقية المتجر `shop` — 0% — تنفيذ اليوم
- **الملفات:** `index.html:1388 renderFilterRow` + `1421 getFilteredItems` + `1564 renderShopView` + `productCard` CSS `366-425`
- **الخطوات التفصيلية (بالترتيب):**
  1. **Controls:** في `renderFilterRow()` للـ `shop` استبدل `select stockFilter` الوحيد بـ:
     ```html
     <div class="shop-controls" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
       <select id="stockFilter" onchange="renderAll()">..الكل/متوفر/غير متوفر..</select>
       <select id="sortSelect" onchange="shopSort=this.value;renderAll()">
         <option value="default">الترتيب الافتراضي</option>
         <option value="qs-desc">المتاح: الأعلى</option>
         <option value="price-asc">السعر: الأقل → الأعلى</option>
         <option value="price-desc">السعر: الأعلى → الأقل</option>
         <option value="name-asc">الاسم: أ→ي</option>
       </select>
       <span id="favToggle" style="margin-right:auto"><label style="display:flex;gap:6px;align-items:center;font-weight:700"><input type="checkbox" id="favOnly" onchange="renderAll()"> ❤️ المفضلة فقط</label></span>
     </div>
     ```
     + متغير عالمي `let shopSort='default'` بجانب `shopPageSize:1183`

  2. **getFilteredItems:** لا تغيير (يصفّي قسم+بحث). الترتيب والـ fav يُطبق في `renderShopView`

  3. **renderShopView:** بعد `items.sort((a,b)=>getQs(b.item)-getQs(a.item))` استبدل بـ:
     ```js
     if(document.getElementById('favOnly')?.checked) items=items.filter(({ci,ii})=> isFav(ci,ii));
     if(shopSort==='price-asc') items.sort((a,b)=> itemPrice(a.item)-itemPrice(b.item));
     else if(shopSort==='price-desc') items.sort((a,b)=> itemPrice(b.item)-itemPrice(a.item));
     else if(shopSort==='name-asc') items.sort((a,b)=> a.item.n.localeCompare(b.item.n,'ar'));
     else if(shopSort==='qs-desc') items.sort((a,b)=> getQs(b.item)-getQs(a.item));
     else items.sort((a,b)=> getQs(b.item)-getQs(a.item)); // default
     ```

  4. **Fav:** إضافة `lib/fav.js` بسيط داخل `index.html`:
     ```js
     let favs=JSON.parse(localStorage.getItem('al_sayed_fav')||'[]'); // ["ci:ii", ...]
     function favKey(ci,ii){ return ci+':'+ii; }
     function isFav(ci,ii){ return favs.includes(favKey(ci,ii)); }
     function toggleFav(ci,ii){ const k=favKey(ci,ii); if(favs.includes(k)) favs=favs.filter(x=>x!==k); else favs.push(k); localStorage.setItem('al_sayed_fav',JSON.stringify(favs)); updateFavBadge(); renderAll(); toast(isFav(ci,ii)?'❤️ أُضيف للمفضلة':'💔 أُزيل'); }
     function updateFavBadge(){ const el=document.getElementById('favCount'); if(el) el.textContent=favs.length; }
     ```
     + badge في الهيدر: بجانب `cartFab` أضف `favBtn` صغير أو في `nav-links-desktop` (`❤️ <span id="favCount">0</span>`) — المرجعية `id="favCount"`

  5. **Cards:** في `renderShopView` حلقة `shop-card` أضف فوق `shop-img`:
     ```html
     <button class="fav-btn ${isFav(ci,ii)?'active':''}" style="position:absolute;top:8px;left:8px;width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.9);cursor:pointer" onclick="event.stopPropagation();toggleFav(${ci},${ii})">❤️</button>
     ```
     + CSS: `.fav-btn.active{background:var(--danger);color:#fff}`

  6. **خصم:** إذا `item.old` موجود (من المرجعية `p.old`) اعرض `product-tag`: `<span class="product-tag">خصم</span>` + سعر قديم مشطوب `price small {text-decoration:line-through}` — حالياً `item.pn` فقط، أضف `item.old` اختياري في `saveItem()`

- **معيار النجاح:** `shop` يرتب بـ 5 طرق + فلتر `❤️` يعمل + `Load More` يبقى + لا infinite scroll

### 3.3 إصلاح عاجل سابق (تم b562420)
- `supabase` من `defer` → `blocking` + polling `400ms×20` + `renderLogin()` toggle + ترجمة أخطاء — لا تلمسه مجدداً

---

## 4- المرحلة 2 — سلة/تفاصيل/حساب/إدارة (يوم 3-4) — High

### 4.1 سلة + شحن + كوبون
- **الملفات:** `index.html:660 cart-overlay` + `1680 renderCart` + CSS `659-720`
- **كيف (من مرجعية `cart-layout`):**
  1. CSS: `.cart-layout{display:grid;grid-template-columns:1fr 360px;gap:30px;align-items:start} @media 900px {grid-template-columns:1fr} .summary{position:sticky;top:100px}`
  2. `renderCart`: غيّر `cart-layout` الحالي (لا يوجد) إلى شبكة + أضف `shipping = total>200?0:20` (كما في مرجعية `shipping 20 مجاني>200`) + صف `الشحن` + صف `الإجمالي total+shipping`
  3. `coupon` واجهة فقط: `<div class="coupon"><input id="coupon" placeholder="كود الخصم"><button onclick="applyCoupon()">تطبيق</button></div>` + `applyCoupon(){ const v=document.getElementById('coupon').value.trim(); if(v==='2M10') toast('✅ خصم 10%'); }`
  4. حافظ على `cart-totals` الحالية (خصم/ضريبة) + أضف `الشحن` كصف جديد

- **معيار النجاح:** سلة على `>900px` عمودين + `sticky` + شحن صحيح + لا كسر `confirmSaveInvoice`

### 4.2 تفاصيل منتج — breadcrumb + meta
- **الملفات:** `index.html:975 product-detail-overlay` + `1623 openProductDetail` + `amz-* 979-1016`
- **كيف:**
  1. في `openProductDetail` قبل `amz-layout` أضف: `<div class="breadcrumb" style="padding:12px 18px;color:var(--text-muted)"><a onclick="setView('home')">الرئيسية</a> / <a onclick="setView('shop')">المتجر</a> / ${esc(item.n)}</div>`
  2. بعد السعر أضف `pd-meta`: `<div class="pd-meta" style="display:flex;flex-direction:column;gap:8px;margin:14px 0;padding:12px;background:var(--bg-soft);border-radius:12px"><div>🚚 توصيل خلال 24 ساعة</div><div>📦 المتوفر: ${qs}</div><div>🔄 إرجاع مجاني 14 يوم</div></div>`
  3. أبق `amz-layout` كما هو + `related` + `bullets`

- **معيار النجاح:** تفاصيل تظهر `breadcrumb` قابلة للنقر + `meta` 3 أسطر

### 4.3 حساب بسيط `account` — جديد
- **الملفات:** جديد `div id="accountView"` أو استخدم `dash-overlay` الحالي
- **كيف (من مرجعية `account-grid 240/1fr`):**
  1. أضف `view account` ثالث: `function renderAccount(){ ... }` يعرض `profile-head` + `order-card` من `invoices.filter(inv=>inv.user===sessionUser)` (كما `viewAccount:3930` لكن نبسط)
  2. `account-nav` 4 أزرار: `ملفي / طلباتي / المفضلة / خروج` — `طلباتي` تستخدم `invoices` الحالية مؤقتاً
  3. رابط في `burger-menu` + `nav-links-desktop`: `حسابي → setView('account')` (أو `go('account')`)

- **معيار النجاح:** عميل يرى `3 طلبات` من `invoices` + `profile` + لا كسر `dash`

### 4.4 إدارة — جدول بدل canvas فقط
- **الملفات:** `index.html:454 dash-overlay` + `2596 renderDashboard`
- **كيف:** أبق `stats 4` + `canvas`، وأضف `table-wrap` (نسخ من مرجعية `table-wrap` CSS `+ th/td`):
  ```html
  <div class="table-wrap"><table><thead><tr><th>المنتج</th><th>القسم</th><th>السعر</th><th>المخزون</th><th>إجراءات</th></tr></thead><tbody>
    ${db.flatMap((cat,ci)=>cat.items.map((it,ii)=>`<tr><td>${esc(it.n)}</td><td>${esc(cat.name)}</td><td>${fmt(itemPrice(it))}</td><td>${getQ(it)}</td><td><button onclick="openModal('edit',${ci},${ii})">✏️</button></td></tr>`)).join('')}
  </tbody></table></div>
  ```
- **معيار النجاح:** لوحة تحكم تعرض جدول 229 صف مع `overflow:auto` على موبايل

---

## 5- المرحلة 3 — Next.js ترحيل احترافي (يوم 5-8) — Medium — **لا يبدأ قبل استقرار index.html**

### 5.1 Dual clients + Middleware (يوم 5)
- **كيف (من v2 وابحاث 2026):**
  1. `npm i @supabase/ssr` (موجود `9.51.32`) + `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
  2. `lib/supabase/client.ts`:
     ```ts
     import {createBrowserClient} from '@supabase/ssr'
     export const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
     ```
  3. `lib/supabase/server.ts`:
     ```ts
     import {createServerClient} from '@supabase/ssr'; import {cookies} from 'next/headers'
     export async function createClient(){ return createServerClient(url,key,{cookies:{getAll:async()=>(await cookies()).getAll(), setAll:async(c)=> (await cookies()).setAll(c)}}) }
     ```
  4. `middleware.ts:1216` تحديث: `const supabase=createServerClient(url,key,{cookies}) ; const {data:{user}}=await supabase.auth.getUser(); if(!user && req.nextUrl.pathname.startsWith('/admin')) return NextResponse.redirect('/login')`

- **معيار النجاح:** `npm run build` أخضر + `supabase.auth.getUser()` في `middleware`

### 5.2 تفكيك `index.html` → `app/` (يوم 6)
- `app/layout.tsx` ينقل `html lang ar dir rtl` + `globals.css` من `index.html:24-1017`
- `components/shop-card.tsx` (موجود) + `product-card.tsx` + `stat-row.tsx` + `cat-bar.tsx` + `hero.tsx` (blob)
- `lib/db/types.ts` + `lib/db/lid.ts` (getQ/qs/min/firstNum/genLid)
- `app/(shop)/page.tsx` Server Component: `supabase.from('items').select('*').eq('deleted_at',null).limit(40)` + Client `ShopGrid` مع `useShop()`
- `app/product/[id]/page.tsx:7` توسيع لعرض `amz-layout`

- **معيار النجاح:** `/` يعرض 40 صنف من السحابة بدون `index.html`

### 5.3 Realtime + IndexedDB + Barcode (يوم 7-8)
- **Realtime:** `lib/supabase/realtime.ts` مع `removeChannel` + `eventsPerSecond:10` + `on('system','disconnect')` + `maxRetries` jitter (الكود في `plane 3.1 §5.3`)
- **IndexedDB:** `lib/db/indexedDB.ts` (`idb` 3 stores `db/invoices/outbox`) يحل محل `localStorage al_sayed_db` مع fallback
- **Barcode:** `lib/barcode/detector.ts` يحاول `new BarcodeDetector({formats:['code_128','qr_code','ean_13']})` ثم fallback `jsQR` + جدول `bins`

---

## 6- خطة التنفيذ المتوازي (محدثة v3.1)

| المسار | الملفات الأساسية | يعتمد على | مدة | حالة |
|--------|-----------------|-----------|------|------|
| A — landing hero | `index.html` CSS `hero/blob` + `renderHome` | — | 0.5ي | ✅ `b562420` |
| B — header/footer/loader | `appHeader` + `footer` + `loader` | A | 0.25ي | ✅ `b562420` |
| C — shop upgrade (sort/fav/خصم) | `renderFilterRow` + `renderShopView` + `fav` + `amz` | A | 0.5ي | ⏳ التالي |
| D — cart/pd/account | `cart-layout` + `breadcrumb` + `accountView` | C | 0.5ي | ⏳ بعد C |
| E — dash table | `renderDashboard` + `table-wrap` | D | 0.25ي | ⏳ |
| F — Next.js dual | `lib/supabase/*` + `middleware` | — | 1ي | ⏳ بالتوازي |
| G — تفكيك app | `app/(shop)/*` + `components/*` | F | 1ي | ⏳ بعد F |
| H — realtime/IDB/barcode | `realtime.ts` + `indexedDB.ts` | F | 1ي | ⏳ بعد F |

- A-B مكتملان، C-D-E تنفذ في `index.html` مباشرة (لا تعطيل)، F-H بالتوازي لا تلمس `index.html`

---

## 7- المخاطر والتخفيف (محدث v3.1)

| الخطر | الاحتمال | الأثر | التخفيف |
|-------|----------|-------|---------|
| `defer` يكسر `supabase` مرة أخرى | عالي | تسجيل يفشل | `supabase` blocking + polling `400ms×20` + `forceLocalLogin` toggle (`b562420`) |
| Blob ثقيل على موبايل ضعيف | متوسط | لاج | `prefers-reduced-motion:reduce` + `will-change:transform` فقط + `340→240px` |
| Fav بدون sync يضيع عند تغيير جهاز | متوسط | تجربة | مقبول مؤقتاً — لاحقاً جدول `favorites(user_id,item_id)` + `RLS` |
| `Load More` يصبح بطيئاً مع 229 | منخفض | أداء | `content-visibility:auto` + `shopPageSize 40` + `requestIdleCallback` للسحب |
| `home` يربك المدير | متوسط | UX | `applyRoleUI` يترك `home` للزوار + زر `→ المخزن` واضح للمدير |
| `sw v21` كاش قديم | منخفض | تحديث | `CACHE al-sayed-v21` + `postMessage sw-update-ready` + زر `تحديث دلوقتي` |
| `bins` BarcodeDetector غير مدعوم | متوسط | مسح يفشل | fallback `jsQR` موجود `index.html:15` |

---

## 8- التسليم v3.1

### 8.1 تسليم فوري (بعد C-E)
- `index.html` بلاندنج كاملة + `shop` بترتيب/مفضلة/خصم + `cart` شحن/كوبون + `pd` breadcrumb + `account` + `dash table` — كل الشاشات `320-1280` + `sw v22`
- `plane.md v3.1` (هذا الملف) + `git log` نظيف + `sw` يبث `update-ready`

### 8.2 تسليم لاحق (Next.js)
- `main` محمي + `CI` أخضر (`supabase db lint`) + `Vercel 2m-stor.vercel.app` + `tests/e2e/shop.spec.ts` + `docs/sync.md` + `docs/rls.md`
- `index.html` يبقى `fallback` حتى `app/(shop)` مستقر 100%

### 8.3 معايير القبول النهائية
1. زائر: `hero` → `shop sort` → `fav` → `cart شحن 20` → `checkout` → `orders` في `account`
2. مدير: `stock` → تعديل سعر → يظهر على هاتف العميل `<1s` عبر `Realtime`
3. أوفلاين: قطع النت → إضافة منتج → عودة النت → `outbox flush` + `pullAll` بدون فقدان
4. Lighthouse PWA `90+` + `offline` يعمل

---

## 9- سجل التغييرات

| التاريخ | الإصدار | التغيير |
|---------|---------|---------|
| 2026-08-27 | v2 | بحث Next.js15/Realtime/IDB + dual clients + middleware |
| 2026-08-27 | v3 | بحث لاندنج + shop/PWA + خطة 3 مراحل + `index.html 3888` |
| 2026-08-27 | v3 (landing) | تنفيذ `b562420`: `hero/blob/features` + `supabase blocking` fix |
| 2026-08-27 | v3.1 | إكمال كل التفاصيل المتبقية (shop/cart/pd/account/dash + Next.js) — **هذا الملف** |

---
*تم الإكمال: 2026-08-27 — بعد فحص `index.html:4153` + `sw v21` + بحث 2026 (Landing 08-04, Filters 06-15, PWA 07-02, No-Code DDD) + لاندنج مرجعية + إصلاح `defer` (`b562420`). المرجع الوحيد للتنفيذ هو هذا الملف.*

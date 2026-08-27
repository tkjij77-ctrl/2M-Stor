# 2M-Stor — الخطة الاحترافية v3.2 (بحث 2026 + فواتير QR + إحصائيات + أدوار) — مكتملة

> **الهدف:** ترقية `index.html:4250` (265KB) + `sw.js v28` + `cloud-schema.sql` من متجر `v25` (حالات الطلب + حساب) إلى نظام فواتير احترافي بنسختين و `QR` + وقت مفصل + `Chart.js` + لغة حسب الدور، مع الحفاظ على 229 صنف + Supabase `uzzxhbotbshsgpdnbrmd` + Realtime. لا حذف لـ `index.html` قبل استقرار.

---

## 0- نتائج البحث (2026) — تحديث 2026-08-27

### A. QR للفواتير 2026
- **المصادر:** `qr-platform/qr-code.js 2026` (custom colors/gradient/logo), `davidshimjs/qrcodejs` (no deps, `new QRCode(el, {text,width,height,correctLevel})`), `jqueryscript 2026-01-06` (10 Best QR Generators), `freecodecamp 2026-03-30` (`qr-code-styling` CDN `unpkg.com/qr-code-styling@1.5.0`)
- **الخلاصة العملية:**
  - `qrcodejs` أخف: `<div id="qr"></div> + new QRCode(el, {text: JSON.stringify({no,total,date}), width:128, height:128, correctLevel:QRCode.CorrectLevel.H})` — لا `npm`، `canvas` فوري
  - `qr-code-styling` أجمل (ألوان/لوغو) لكن أثقل — نستخدم `qrcodejs` للفاتورة
  - بيانات `QR`: `{"no":1005,"total":450,"date":"2026-08-27T15:45","customer":"نقدي","seller":"admin"}` + رابط تحقق اختياري `?verify=...` — تُطبع مع الفاتورة

### B. Chart.js للإحصائيات 2026
- **المصادر:** `yfin 2026-06-26` (Chart.js عبر CDN `cdn.jsdelivr.net/npm/chart.js` + `new Chart(ctx,{type:'bar'...})` + `gradient fill + centerText plugin`), `chartjs.org docs` (Performance: `parsing:false` للكميات الكبيرة), `thelinuxcode 2026-02-13` (Production: `register` + `interaction mode index` + `threshold shading`)
- **الخلاصة العملية:**
  - تحميل بـ `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>` — لا `npm`
  - `Bar` لمقارنة الأقسام، `Line` مع `gradient` لتتبع `آخر 30 يوم`، `Doughnut` لتوزيع الحالات `قيد/طريق/توصيل/رفض/ملغي` + `centerText plugin` يعرض المجموع
  - عندنا `canvas` يدوي (`drawStockChart` بـ `fillRect/roundRect`) — نستبدل/نضيف `Chart.js` لـ `chartStatus` دون كسر الحالي

### C. لغة حسب الدور 2026
- **المصادر:** `hypotenuse 2026-05-30` (personalized shopping), `savetowishlist 2026-06-15` (information scent: labels/breadcrumbs)
- **الخلاصة:** قاموس `roleLabels` + ` wordingMap[role]` يغير `طلباتي → الطلبات (الكل) / طلبات اليوم` في `account-nav/burger/sectionTitle/empty-state` — يُذخر في `customPerms` ويُزامن عبر `settings.role_perms`

### D. وقت مفصل
- **المصدر:** `Intl.DateTimeFormat` + `toLocaleString('ar-EG', {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'})` — `الخميس 27 أغسطس 2026، 03:45 م` — لا مكتبة

---

## 1- الوضع الحالي (فحص 2026-08-27 بعد 19bf367)

| الملف | الحالة |
|-------|--------|
| `index.html:4250` (265KB) | مونوليث: لاندنج + متجر `sort/fav` + سلة `شحن/كوبون` + تفاصيل `breadcrumb/meta` + حساب `profile/orders/fav` مع `status` (`قيد/طريق/توصيل/رفض/ملغي`) + إدارة `table` + `charts` يدوية + `login defer fix` + `image drop/capture` |
| `sw.js v28` | إصلاح إزالة الصورة (`imgUrl=''`) + `CACHE al-sayed-v28` |
| `cloud-schema.sql` + `migration add_invoice_status` | `invoices.status` + `updated_at` + `trigger trg_invoices_touch` + `policy inv_update` |
| السحابة | `categories 5 / items 229 / invoices N` مع حالات، `supabase_realtime` يشمل `invoices` |
| المشكلة الحالية | وقت الفاتورة مختصر (`toLocaleDateString` فقط)، لا `QR` ولا نسختين، إحصائيات بلا `doughnut` حالة، `طلباتي` ثابت لكل الأدوار |

---

## 2- المبادئ (ثابتة)

1. السحابة مصدر الحقيقة — `alive Set` + `pendingHas(lid)` له أولوية
2. RLS هو الأمن — `inv_update using(auth.uid() not null)` مضافة حديثاً
3. لا كسر بيانات — كل `add column if not exists`
4. هجين UI + Sync، `print` نسختين بـ `@media print`

---

## 3- المرحلة 4.5 — وقت مفصل + نسختين فاتورة + QR (يوم 1) — High

### 3.5.1 وقت مفصل
- **الملفات:** `index.html: showReceiptPreview ~3250` + `renderAccount orders` + `showInvoiceHistory` + `dailyReport`
- **كيف:**
  1. دالة مساعدة:
     ```js
     function fmtDateTime(iso){ return new Date(iso).toLocaleString('ar-EG', {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'}); }
     function fmtTime(iso){ return new Date(iso).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}); }
     ```
  2. في `showReceiptPreview` استبدل `d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString(...)` بـ `fmtDateTime(inv.date)` + `ساعة: ${fmtTime(inv.date)}`
  3. في `renderAccount` و `showInvoiceHistory` اعرض `fmtDateTime(o.date)` بدل `toLocaleDateString` فقط، مع `title` يظهر `ISO` كاملاً عند hover
  4. `dailyReport` يعرض `من ${fmtDateTime(start)} إلى ${fmtDateTime(end)}`

- **معيار النجاح:** المدير يرى `الخميس 27 أغسطس 2026، 03:45 م` + عند الطباعة نفس الوقت مفصل

### 3.5.2 نسختين فاتورة + QR
- **الملفات:** `index.html:3250 showReceiptPreview` + `receipt` CSS `426` + `head` لإضافة `qrcodejs` CDN
- **كيف:**
  1. في `head` أضف `<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>` (أو `qr-code-styling` لكن `qrcodejs` أخف)
  2. في `showReceiptPreview`:
     - بيانات `QR`: `const qrData = JSON.stringify({no:inv.no, total:inv.total, date:inv.date, customer:inv.customer, seller:inv.user, count:inv.items.length});`
     - HTML: بعد `receipt-totals` أضف `<div id="qrBox" style="text-align:center;margin-top:16px"><div id="qrcode" style="display:inline-block;padding:8px;background:#fff;border:1px solid var(--border);border-radius:12px"></div><div style="font-size:.7rem;color:var(--text-muted);margin-top:4px">امسح للتحقق • #${String(inv.no).padStart(4,'0')}</div></div>`
     - بعد `body.innerHTML = ...` أضف:
       ```js
       setTimeout(()=>{ try{ const el=document.getElementById('qrcode'); if(el && window.QRCode){ el.innerHTML=''; new QRCode(el, {text:qrData, width:128, height:128, correctLevel:QRCode.CorrectLevel.H}); } }catch{} }, 80);
       ```
     - نسختين للطباعة: غلّف `receipt` الحالي في `<div class="receipt-copy"><div class="copy-label">نسخة العميل</div>...receipt...<div id="qrBox">...</div></div><div class="receipt-copy" style="border-top:2px dashed var(--border);margin-top:16px;padding-top:16px"><div class="copy-label">نسخة المحل — ${esc(settings.store)}</div>...تكرار نفس الجدول...</div>`
     - CSS `@media print`: `.receipt-copy{ page-break-inside:avoid; } .no-print{display:none}`
  3. زر `📤 مشاركة` يستخدم `navigator.share` مع `qrData`، و `💾 حفظ QR` يحول `canvas` إلى `toDataURL` وتنزيل

- **معيار النجاح:** معاينة الفاتورة تظهر `QR` فوري + طباعة تخرج نسختين متطابقتين مع `QR` + `المدير/العميل` كلاهما يحصل نسخة

---

## 4- المرحلة 4.6 — رسم بياني حالة الطلبات (يوم 1) — High

- **الملفات:** `index.html:3206 renderDashboard` + `head` (Chart.js CDN) + `dash-card canvas`
- **كيف:**
  1. في `head` أضف `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>`
  2. في `renderDashboard` بعد `chartSales` أضف:
     ```html
     <div class="dash-card"><h3>📊 حالة الطلبات</h3><canvas id="chartStatus"></canvas></div>
     ```
  3. دالة `drawStatusChart()`:
     ```js
     function drawStatusChart(){
       const c=document.getElementById('chartStatus'); if(!c || !window.Chart) return;
       const counts={}; ORDER_STATUSES.forEach(s=>counts[s]=0); invoices.forEach(inv=>{ const s=inv.status||'قيد المعالجة'; counts[s]=(counts[s]||0)+1; });
       const labels=Object.keys(counts).filter(k=>counts[k]>0); const data=labels.map(k=>counts[k]);
       const colors={ 'قيد المعالجة':'#f5b62c','في الطريق':'#1a7fa0','تم التوصيل':'#00c9a7','تم رفض الطلب':'#e5484d','ملغي':'#9fb3bd'};
       new Chart(c, {type:'doughnut', data:{labels, datasets:[{data, backgroundColor:labels.map(l=>colors[l])}]}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{family:'Tajawal'}}}}}});
     }
     ```
  4. استدعها بعد `drawSalesChart()` + `drawStockChart()`

- **معيار النجاح:** لوحة التحكم تظهر `doughnut` بعدد `قيد 5 / طريق 2 / توصيل 10...` ويتحدث مع `Realtime`

---

## 5- المرحلة 4.7 — لغة حسب الدور (يوم 1) — Medium

- **الملفات:** `index.html: renderAccount + burger-menu + nav-links-desktop + sectionTitle`
- **كيف:**
  1. قاموس:
     ```js
     const wording={
       admin:{ orders:'📦 الطلبات (الكل)', ordersEmpty:'لا توجد طلبات حتى الآن', account:'👑 لوحة المدير', fav:'المفضلة', profile:'ملف المدير'},
       worker:{ orders:'📋 طلبات اليوم', ordersEmpty:'لا توجد طلبات اليوم', account:'👷 حساب العامل', fav:'المفضلة', profile:'ملفي'},
       customer:{ orders:'📦 طلباتي', ordersEmpty:'لم تطلب بعد', account:'👤 حسابي', fav:'مفضلتي', profile:'ملفي'}
     };
     function w(key){ return (wording[sessionRole]||wording.customer)[key] || key; }
     ```
  2. في `renderAccount` استبدل `طلباتي` الثابت بـ `w('orders')` + `empty-state` بـ `w('ordersEmpty')` + عنوان `w('account')`
  3. في `burger-menu` و `nav-links-desktop` غيّر `طلباتي` إلى `w('orders')` ديناميكياً عند `applyRoleUI()`
  4. `sectionTitle` للمتجر: للمدير `جميع الطلبات`، للعميل `طلباتي`

- **معيار النجاح:** عميل يرى `طلباتي`، عامل `طلبات اليوم`، مدير `الطلبات (الكل)` — نفس الكود، نص مختلف

---

## 6- خطة التنفيذ المتوازي v3.2

| المسار | الملفات | مدة | حالة |
|-------|---------|------|------|
| A — وقت مفصل | `fmtDateTime` + `showReceiptPreview` + `renderAccount` | 0.25ي | التالي |
| B — QR + نسختين | `head qrcodejs` + `showReceiptPreview` + `@media print` | 0.25ي | بعد A |
| C — رسم حالة | `head Chart.js` + `drawStatusChart` | 0.25ي | بعد B |
| D — لغة دور | `wording` + `burger/nav/account` | 0.25ي | بعد C |

كلها في `index.html` مباشرة، `sw v29` بعدها.

---

## 7- المخاطر

| الخطر | التخفيف |
|-------|----------|
| `qrcodejs` لا يحمّل (CDN) | `try/catch` + `if(window.QRCode)` + fallback رابط `qrserver.com` |
| `Chart.js` يتعارض مع `canvas` يدوي | تحميل `defer` + فحص `if(window.Chart)` قبل الرسم، لا نستبدل `drawStock/Sales` |
| وقت `ar-EG` يختلف باختلاف المتصفح | `toLocaleString` مع `options` ثابتة + `title` يظهر `ISO` الأصلي |
| لغة دور تربك المستخدم | `wording` بسيط + `roleLabels` يبقى بجانب الاسم |

---

## 8- التسليم v3.2

- `index.html` بوقت `الخميس 27 أغسطس 2026، 03:45 م` + فاتورة نسختين مع `QR` + `doughnut` حالة + لغة حسب الدور — كل الشاشات + `sw v29`
- `plane.md v3.2` (هذا الملف) + `migration add_invoice_status` موجودة

---

## 9- سجل التغييرات

| التاريخ | الإصدار | التغيير |
|---------|---------|---------|
| 2026-08-27 | v2 | بحث Next/IDB |
| 2026-08-27 | v3 | لاندنج + shop |
| 2026-08-27 | v3.1 | shop/sلة/pd/account/dash + Next |
| 2026-08-27 | v3.1 (status) | حالات الطلب + إلغاء + migration |
| 2026-08-27 | v3.2 | وقت مفصل + QR نسختين + Chart حالة + لغة دور — **هذا الملف** |

---
*تم التحديث: 2026-08-27 — بعد فحص `index.html:4250` + `sw v28` + بحث QR (qrcodejs) + Chart.js (yfin) + role wording.*

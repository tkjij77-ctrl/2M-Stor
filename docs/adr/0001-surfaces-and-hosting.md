# ADR-0001 — سطحان، ومضيفان: أين يعيش كل شيء ولماذا

- **الحالة:** مُعتمَد
- **التاريخ:** 7 نوفمبر 2026
- **يخصّ:** الاستضافة · حدود الثقة · ترتيب العمل في المراحل التالية
- **القرار المختصر:** الكاشير والمتجر يبقيان **فانيلا بلا إعادة كتابة**، لكن يُنقلان من
  GitHub Pages إلى **Cloudflare Pages** (مجاني· تجاري مسموح · ترويسات مخصّصة).
  وتطبيق **Next يبقى سطح الإدارة الداخلي** ولا يُنشر للعامة حتى تكتمل المطابقة.

---

## 1. الوقائع التي فُرضت علينا (لا آراء)

### أ) ما في المستودع فعلًا

| السطح | الملفات | ما يستخدمه المحل اليوم | الحالة |
|---|---|---|---|
| **فانيلا** | `index.html` (88 KB · 55 `onclick` مضمّن) + `web/` (12 ملفًا · 544 KB · 227 `onclick`) | ✅ هذا هو **الإنتاج** — البيع يجري عليه | يعمل · بلا اختبارات وحدة · بلا CSP ممكنة على Pages |
| **Next.js** | `app/` (10 مسارات) + `middleware.ts` + `next.config.js` | ❌ تجريبي | 7 مسارات ثابتة · `/product/[id]` ديناميكي · `/admin` و`/admin/dashboard` ديناميكيان · ترويسات أمان · middleware |

خرج البناء الحقيقي (`.next`) — هذه **قدرات وقت تشغيل** لا يمكن لموقع ثابت تقديمها:

```
routes-manifest : headers: 4 ترويسات أمنية على /(.*)  ·  redirects: 1 (توحيد الشرطة المائلة)
middleware-manifest : /admin  (matcher: ^\/admin… )
prerender : static [ / , /cart , /privacy , /returns , /stock , /terms , /_not-found ]
            dynamic [ /product/[id] , /admin , /admin/dashboard ]
```

### ب) قيود المضيفين (مُتحقَّق منها اليوم)

| المضيف | الاستخدام التجاري | ترويسات مخصّصة | Next + middleware |
|---|---|---|---|
| **GitHub Pages** | ❌ **ممنوع**: «not intended for or allowed to be used … to run your online business, e-commerce site» ([1](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages), [2](https://github.com/orgs/community/discussions/74742)) | ❌ لا | ❌ لا |
| **Vercel Hobby** | ❌ **ممنوع** — الترخيص شخصي غير تجاري؛ المتجر يحتاج Pro بـ 20$/شهر ([3](https://costbench.com/software/developer-tools/vercel/), [4](https://supadrop.host/blog/vercel-pricing-free-tier-limits/)) | ✅ | ✅ (الأفضل تقنيًا) |
| **Cloudflare Pages** | ✅ مسموح · نطاق ترددي **غير محدود** · 500 بناء/شهر ([5](https://www.sofast.host/blog/cloudflare-pages-vs-github-pages/), [6](https://computingforgeeks.com/deploy-static-site-cloudflare-pages/)) | ✅ `_headers` (100 قاعدة) · `_redirects` | جزئيًا (Workers/OpenNext — عمل إضافي) |
| **Netlify Free** | ✅ مسموح · 300 credit/شهر ([7](https://gainhq.com/blog/vercel-vs-netlify/)) | ✅ `_headers` | ✅ عبر OpenNext، مع قيود middleware |

**نتيجتان لا تحتملان التأجيل:**

1. **المتجر اليوم يعمل على مضيف يمنع صراحةً المواقع التجارية** — هذا خطر إيقاف خدمة، لا مسألة تفضيل.
2. **الواجهة الحقيقية (فانيلا) بلا ترويسات أمان إطلاقًا** — لا CSP ولا `X-Frame-Options` ولا `nosniff`، لأن Pages لا تدعمها. أي إصلاح أمني في `app/` لا يحمي المال الحقيقي.

---

## 2. القرار

> **سطح واحد لكل حزمة، ومضيف يطابق متطلباته — لا ترحيل شامل إلى React.**

```
┌─ Cloudflare Pages (مجاني · تجاري مسموح · بلا حد تردددي)
│   └─ index.html + web/ + vendor/ + sw.js
│      الكاشير والمتجر — فانيلا كما هي، بلا إعادة كتابة
│      ✅ ترويسات أمان حقيقية عبر _headers (CSP · XFO · nosniff · Referrer)
│      ✅ offline-first (Service Worker) يبقى كما هو
│
└─ سطح Next.js — إدارة/تقارير داخلية
    الآن: يعمل محليًا وعلى خادم ذاتي (next start) · محمي بـ middleware + RLS
    لاحقًا: Cloudflare Workers (OpenNext) أو Netlify — حين تكتمل المطابقة
    ❌ لا يُنشر على Vercel Hobby (غير تجاري)
```

### لماذا لا نُعيد كتابة الكاشير في React؟

- الكاشير يعمل، ويبيع، ويعمل بلا إنترنت. إعادة كتابته = مخاطرة إيراد مقابل **صفر** مكسب وظيفي.
- 282 `onclick` مضمّنة = مشكلة CSP داخلها؛ إصلاحها في React يعني نفس التكلفة تقريبًا.
- Next كان «تجريبيًا ولم يكتمل» بحسب README نفسه — لا يصح أن يصبح الأساس قبل أن يتفوّق.

### لماذا Cloudflare Pages تحديدًا؟

| السبب | الأثر |
|---|---|
| الاستخدام التجاري مسموح على المجاني | يزيل خطر الإيقاف فورًا |
| `_headers` | **أول مرة** تُحمى الواجهة الحقيقية بـ CSP/XFO/nosniff |
| بلا حد نطاق ترددي | لا فاتورة مفاجئة في موسم الخير |
| لا يتطلب إعادة بناء | نفس الملفات، تغيير مضيف فقط |
| Workers متاح لاحقًا | مسار إلى Next على نفس المنصة بلا مزوّد ثالث |

بديل مرفوض: **البقاء على Pages** — يترك خطر ToS + غياب الترويسات بلا حل.
بديل مرفوض: **Vercel Pro الآن (20$/شهر)** — يشتري راحة النشر قبل أن يوجد سطح Next جاهز للبيع.

---

## 3. ما نُفِّذ مع هذا القرار (قابل للتراجع، بلا مخاطرة)

1. **`_headers` في جذر المستودع** — نفس ترويسات `next.config.js` مطبَّقة على السطح الثابت:
   CSP مطابقة (مع `telegram.org` و`fonts.googleapis.com` التي يحتاجها `index.html`)،
   `X-Frame-Options: DENY`، `nosniff`، `Referrer-Policy`، و`sw.js` بلا تخزين مؤقت.
2. **`scripts/verify-static-headers.js`** — فحص انحراف: يفشل إذا اختلفت CSP بين
   `next.config.js` و`_headers`، أو ظهر `'unsafe-eval'`، أو غاب ترويسة أمنية من أحد السطحين.
   (يُشغَّل في CI ضمن `lint-typecheck`.)
3. **الـADR** هذا — مرجع واحد يمنع إعادة فتح النقاش بلا معطيات.

**ما لم يُنفَّذ بعد (يحتاج حسابك):** ربط Cloudflare بالمسودّة، وإصدار رمز API للنشر، وتحويل النطاق.
هذه خطوات لا يمكن (ولا يصح) أن أنفّذها عنك.

---

## 4. خطة الانتقال — 6 خطوات بلا توقف للبيع

| # | الخطوة | من ينفّذ | معيار النجاح |
|---|---|---|---|
| 1 | حساب Cloudflare + «Pages → Connect to Git» على `2M-Stor` | أنت | أول نشر يعطي رابط `*.pages.dev` |
| 2 | فتح الرابط وتجربة: متجر · سلة · كاشير · مخزن · مزامنة | أنت + أنا نراجع | لا فرق وظيفي |
| 3 | فحص الترويسات على الرابط: `curl -I` يظهر CSP وXFO | أنا | 4/4 ترويسات |
| 4 | تحويل النطاق (CNAME) أو البقاء على `pages.dev` أسبوعًا | أنت | 0 أخطاء، الكاشير يعمل من الهاتف |
| 5 | تعطيل نشر Pages القديم (لا تحذف المستودع) | أنت | Rollback متاح بأمر واحد |
| 6 | توثيق الرابط الجديد في README | أنا | README لا يشير إلى Pages |

**التراجع:** إعادة تفعيل Pages من الإعدادات (دقيقة واحدة) — لا تغيير في الشيفرة إطلاقًا.

---

## 5. متى نُعيد النظر

- **إذا انتقل المحل إلى Next كسطح بيع** ← يُعاد السؤال: Cloudflare Workers أم Netlify أم VPS.
- **إذا اقترب حجم `web/` من حدود Cloudflare** (20,000 ملف — نحن على ~50) ← لا خطر.
- **إذا صار للإدارة مستخدمون خارج الشبكة المحلية** ← يلزم نشر Next فعليًا (Netlify Free يكفي: تجاري مسموح).

---

## 6. عواقب هذا القرار (ما نخسره بصراحة)

| العاقبة | التخفيف |
|---|---|
| مضيف ثالث يُدار (GitHub + Cloudflare + Supabase) | إعداد لمرة واحدة؛ النشر تلقائي من Git |
| CSP على الفانيلا تتطلب `'unsafe-inline'` بسبب 282 `onclick` | مُوثَّق كدَين تقني؛ يُزال في مرحلة «ES modules + إزالة `onclick`» |
| سطحان يعنيان تكرارًا مؤقتًا للمنطق | حدّ أدنى: نفس مخطط القاعدة ونفس RLS — وهو الحدث الأمني الوحيد المهم |
| Next يبقى بلا مستخدمين حتى تكتمل المطابقة | واضح في README: «تجريبي» — لا ادّعاء |

---

## المراجع

1. GitHub — About GitHub Pages (قيود الاستخدام التجاري): https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
2. GitHub Community #74742 — نقاش شرط الاستخدام التجاري: https://github.com/orgs/community/discussions/74742
3. Vercel 2026 — Hobby غير تجاري · Pro 20$/شهر: https://costbench.com/software/developer-tools/vercel/
4. Vercel free-tier limits (Commercial use: not allowed): https://supadrop.host/blog/vercel-pricing-free-tier-limits/
5. Cloudflare Pages vs GitHub Pages — قيود وأسعار و`_headers`: https://www.sofast.host/blog/cloudflare-pages-vs-github-pages/
6. نشر موقع ثابت على Cloudflare Pages (`_headers` / `_redirects`): https://computingforgeeks.com/deploy-static-site-cloudflare-pages/
7. Netlify مقابل Vercel — الاستخدام التجاري على المجاني: https://gainhq.com/blog/vercel-vs-netlify/

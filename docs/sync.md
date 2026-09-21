# المزامنة — كيف تصل البيانات من جهاز إلى كل الأجهزة

> آخر تحديث: 21 سبتمبر 2026 (T3.1 · T3.2 · T3.3 · T3.7) — هذا الملف يصف **ما ينفّذه الكود الآن**،
> وليس ما كان مخططًا. كل مسار أدناه له ملف واسم دالة يمكن التحقق منهما.

## 1) الجداول التي تُبَثّ فوريًا (Realtime)

مُفعَّلة على publication `supabase_realtime`:

| الجدول | لماذا |
|---|---|
| `items` | تعديل صنف في جهاز يظهر في كل الأجهزة < ثانية |
| `categories` | قسم جديد يظهر في القائمة فورًا |
| `settings` | تغيير اسم المتجر/الأسعار يسري على الجميع |
| `invoices` | فاتورة جديدة/تغيير حالتها تظهر في لوحة الإدارة |

**ملاحظة:** الجداول الأخرى (`invoice_items` · `profiles` · `audit_log`) لا تُبَثّ؛
بنود الفاتورة تأتي مع فاتورتها، والسجل لا يحتاج لحظية.

**تفعيل Realtime نفسه مُسجَّل في المستودع** (`20260921000000_security_hardening.sql` قسم 6.3)
وليس يدويًا في لوحة Supabase — وهذه إحدى نتائج T3.7. يُفحَص آليًا.

**اختياري (غير مُنفَّذ):** `alter table … replica identity full` لإرسال القيم القديمة في
أحداث DELETE/UPDATE؛ مذكور كخيار في `security-fixes.sql:349`.

## 2) الرفع (من الجهاز إلى السحابة) — `lib/sync/outbox.ts`

```
تعديل محلي → حجز لـ500ms (decrement) → دفعة واحدة insert(...).select() → تأكيد أو إعادة محاولة
```

- **الطابور** في `localStorage` (`al_sayed_outbox`) والجهاز يعمل بلا إنترنت بلا فقدان.
- **إعادة المحاولة:** الخطأ «عابر» (شبكة/5xx/انقطاع) يُعاد 5 مرات بتأخير تصاعدي حتى 60 ثانية؛
  والخطأ «دائم» (مخالفة قيد/عمود غير موجود/صلاحية) يُنقل إلى `al_sayed_outbox_failed` بدل الدخول في حلقة لا تنتهي.
- **عند عودة الاتصال** (`online`) أو عند **فتح النظام** يُفرَّغ الطابور تلقائيًا،
  وهناك إعادة محاولة دورية (T3.2) حتى لو لم يحدث تعديل جديد.
- **حد الطابور:** 800 عنصر، وما يزيد يُنقل للسجل (منع تضخّم localStorage).

### مسارات حرجة داخل الرفع

| الحالة | المسار | القاعدة |
|---|---|---|
| فاتورة جديدة | `next_invoice_no` ثم `assign_invoice_no` | الرقم **يُسنده السيرفر** ويُعاد للجهاز؛ لا جهاز ان يخترع رقمًا (T3.1) |
| نقص مخزون | `rpc('decrement_stock')` | ذرّية على القاعدة عبر `decrement_stock` / `increment_stock` بدل حساب محلي (T3.3) |
| حذف صنف/قسم | `soft_delete_item` / `soft_delete_category` | حذف ناعم: `deleted_at` + إمكانية الاسترجاع (`restore_item` · `trash_list` · `purge_old_trash`) |
| تغيير إعداد | جدول `settings` | مفتاح/قيمة: `store_desc` · `return_days` · `return_note` … |

## 3) السحب (من السحابة إلى الجهاز) — `lib/sync/realtime.ts`

- قناة واحدة `sb.channel('db-changes')` على `postgres_changes` للجداول الأربعة → تحديث فوري.
- شبكة أمان: `pullAll()` عند بدء التشغيل وعند عودة الاتصال — فلا تبقى شاشة قديمة لو فات حدث.
- الصور: `lib/sync/image.ts` يضغط قبل الرفع (`canvas.toBlob(0.7)` وبحد 1024px) إلى دلو `products`.

## 4) حارس جهاز العرض (مقصود)

`dbIsFactory` — جهاز مصنع/معرض يرفع `display_qs = 0` فقط ولا يكتب الكمية الكاملة،
وإلا لَنقص مخزون المتجر الحقيقي عند كل فتح للواجهة.

## 5) فهارس تخدم المزامنة (من المستودع، تُفحَص آليًا)

`idx_items_updated` (آخر تعديل — أساس السحب الفارقي) ·
`idx_invoices_date` · `idx_invoices_customer` · `idx_invoices_seller` ·
`idx_items_category` و`idx_items_display` (شاشة المخزن) ·
`idx_items_name_trgm` و`idx_categories_name_trgm` (بحث عربي بالجذر) ·
`idx_items_deleted_at` و`idx_categories_deleted_at` (استثناء المحذوف من كل استعلام).

## 6) كيف تتحقق من أن هذا الوصف ما زال صحيحًا

```bash
node scripts/verify-schema-drift.js --repo        # الجداول/الفهارس/realtime مقابل ما يستدعيه التطبيق
node scripts/verify-outbox.js                     # 28 فحصًا لسلوك الطابور (متصفح حقيقي)
node scripts/verify-stock.js                      # 20 فحصًا لخصم/إرجاع المخزون
node scripts/verify-invoice-no.js                 # 15 فحصًا لترقيم الفواتير
```

## 7) ما لم يُنفَّذ بعد (بصراحة)

- `IndexedDB` بدل `localStorage`: الملف `lib/db/indexedDB.ts` موجود ويُستعمل كطبقة أولى،
  لكن `localStorage` يبقى شبكة أمان — لم نُزل الاعتماد عليه بعد (حد ~5MB).
- `replica identity full`: اختياري ولم يُفعَّل.
- Sentry/PostHog: بلا مفاتيح (T5.3).

# RLS — سياسات الأمان كما هي فعلًا

> هذا الملف **مُتحقَّق آليًا**: `node scripts/verify-schema-drift.js --repo`
> يفشل إن تغيّر عدد الجداول أو السياسات هنا ولم يُحدَّث الملف.
> آخر تحديث: 21 سبتمبر 2026 — بعد الموجات 0-4.

## الأرقام الحقيقية (من ملفات الترحيل لا من الذاكرة)

| البند | العدد | المصدر |
|---|---|---|
| جداول في `public` | **7** | `20260826200407_baseline.sql` |
| سياسات RLS | **22** | الترحيلات كلها بالترتيب |
| دوال | 23 | منها 4 مساعدة أمنية |
| مشغّلات (Triggers) | 8 | منها حارس تصعيد الدور |
| فهارس | 12 | منها فهرسان نصيان عربيان |

**الجداول السبعة:** `profiles` · `categories` · `items` · `invoices` · `invoice_items` · `settings` · `audit_log`
— كلها عليها `enable row level security` (يُفحَص آليًا).

## السياسات جدولًا جدولًا

السياسات مكتوبة **بلا `to <role>`** (أي تشمل `public`) لكنها مُقيَّدة بالدوال
`my_role()` / `my_username()` / `auth.uid()` — فالمنع يأتي من الشرط لا من الدور.

| الجدول | السياسات | القاعدة |
|---|---|---|
| `categories` | `cats_read` (select) · `cats_write` (all) | القراءة للجميع (المتجر مفتوح بلا تسجيل) · الكتابة لـ`admin`/`worker` |
| `items` | `items_read` (select) · `items_write` (all) | نفس القاعدة |
| `settings` | `settings_read` (select) · `settings_write` (all) | نفس القاعدة |
| `invoices` | `inv_read` · `inv_create` · `inv_update` · `inv_delete` | قراءة: الإدارة أو البائع نفسه أو العميل باسمه · إنشاء: أي مسجَّل · تعديل: الإدارة · حذف: المدير |
| `invoice_items` | `iitems_insert` · `iitems_update` · `iitems_delete` | إنشاء لأي مسجَّل · تعديل/حذف للإدارة (`iitems_rw` القديمة **محذوفة**) |
| `audit_log` | `audit_read` (select) · `audit_write` (insert) | كتابة للعامل والمدير فقط (كانت لأي مسجَّل) |
| `profiles` | `profiles_read` · `profiles_self_update` · `profiles_write` | القراءة للجميع · التعديل الذاتي بشرط أن يبقى الدور كما هو · الكتابة للإدارة |
| `storage.objects` | `products_public_read` · `products_staff_insert/update/delete` | القراءة عامة · الرفع/التعديل/الحذف للمدير والعامل فقط (كانت لأي مسجَّل) |

## الحُرّاس (لا يمكن تجاوزهم من الواجهة)

1. **`prevent_role_escalation`** — مشغّل `before update on profiles`: يكشف إن حاول أحدهم
   تغيير دوره إلى `admin` بنفسه. لا تُغني عنه سياسة `profiles_self_update` بل تسنده.
2. **`handle_new_user`** — كل حساب جديد يُولَد بدور `customer` دائمًا؛ لا «أول مستخدم = مدير».
3. **`my_role()` / `my_username()`** — `revoke execute` من `public, anon` و`grant` لـ`authenticated` فقط.
4. **`guard_item_category`** — يمنع نقل صنف إلى قسم غير موجود (يحفظ سلامة المراجع).
5. **حدود الصلاحيات على الأعمدة** (`profiles.role`): مذكورة كخيار في `security-fixes.sql:62`
   **ولم تُنفَّذ** لأنها قد تمنع التعديل الذاتي المشروع؛ الحماية الفعلية من المشغّل أعلاه.

## ما يعمل بدون تسجيل (مقصود)

الزائر (anon) يقرأ `categories` و`items` و`settings` فقط — المتجر يعمل بلا تسجيل.
أي كتابة، وأي قراءة لفاتورة أو حساب، تتطلّب `authenticated` + الدور المناسب.

## كيف تتحقق (ثلاث طبقات)

```bash
# 1) المستودع نفسه: هل السياسات/الجداول/الدوال متّسقة مع ما يستدعيه التطبيق؟
node scripts/verify-schema-drift.js --repo

# 2) القاعدة الحقيقية: هل عليها كائنات ليست في المستودع (العكس خطير)؟
#    نفّذ scripts/schema-inventory.sql في SQL Editor ثم:
node scripts/verify-schema-drift.js inventory.txt

# 3) الاختبار السلوكي: ماذا يستطيع كل دور أن يفعل فعلًا؟
#    نفّذ supabase/tests/rls-test-suite.sql على مشروع تجريبي واقرأ جدول النتائج
```

طبقات أخرى: `supabase db lint` · `get_advisors(security)` · قسم 8 من `security-fixes.sql`.

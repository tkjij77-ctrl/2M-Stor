#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  التحقق من scripts/apply-backend-all.sql — الملف الذي يُلصق مرة واحدة
#
#  نُقلّد حالة القاعدة الحيّة بالضبط كما قيست عن بُعد (21 سبتمبر 2026):
#     baseline + add_invoice_status + **سياسات مفتوحة** ⇒ الزائر يقرأ الفواتير ويكتب عليها
#  ثم نُطبّق الملف ونتحقق:
#     1) يُنفَّذ بلا خطأ على قاعدة مماثلة للحيّة
#     2) يُغلق التسريب فعلًا — بالقياس **بالأثر** لا برسالة الخطأ
#        (سياسة RLS لا تُصدر خطأً: تُصفّر عدد الصفوف المتأثرة فقط)
#     3) ينشئ كل الكائنات (8 جداول · الدوال · الحارس · Realtime)
#     4) تقريره النهائي يطبع أحكامًا ✅ (لا صفوف غامضة)
#     5) ثابت idempotency في الملف نفسه + تشغيله مرتين بلا خطأ
#
#  🔴 عطل إنتاجي أُضيف كسيناريو دائم (22 سبتمبر 2026):
#     على قاعدتك الحيّة pg_trgm منصَّبة في public (لا في extensions كما افترضنا)
#     ⇒ `create index … (name extensions.gin_trgm_ops)` فشل بـ42704 وأسقط الملف كله،
#     ولأن SQL Editor يلفّ الملف في معاملة واحدة **تراجعت كل الإصلاحات**.
#     صار القسم 【7】 يعيد تمثيل هذا الترتيب بالضبط ويتأكد أن الملف ينجح ويُصلح الأمان.
#
#  ⚠️ أول تشغيل لهذا الملف كشف **ثلاثة عيوب حقيقية** أُصلحت:
#     • ملف الترحيلات لم يكن idempotent (فشل «policy already exists») — وهو ما
#       يناقض وعدنا للمستخدم «أعد التشغيل بلا خوف»
#     • لم يكن يحذف السياسات المفتوحة المُنشأة يدويًا في اللوحة
#     • اختبارنا نفسه كان يقيس الخطأ لا الأثر، فأعطى «نجاحًا/فشلًا» مضلِّلًا
#
#  الاستخدام: bash scripts/verify-apply-backend-all.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

DB="t_apply_$$"
DB2="t_apply_pub_$$"      # السيناريو (ب): pg_trgm في public — نفس ترتيب قاعدتك الحيّة
PSQL_SU="sudo -n -u postgres psql"
FILE="scripts/apply-backend-all.sql"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1${2:+  → $2}"; FAIL=$((FAIL+1)); }
cleanup() { $PSQL_SU -q -c "drop database if exists $DB" >/dev/null 2>&1; $PSQL_SU -q -c "drop database if exists $DB2" >/dev/null 2>&1; }
trap cleanup EXIT
Q() { $PSQL_SU -d "$DB" -tAc "$1" 2>&1 | tr -d '\r' | grep -viE '^(begin|set|commit|rollback|do)$' | sed '/^$/d'; }

# تنفيذ باستخدام دور معيّن + هوية JWT (كما يفعل PostgREST)
as_role() { # as_role <دور> <uid|-> <sql>
  local role="$1" uid="$2" sql="$3" claims
  if [ "$uid" = "-" ]; then claims='{"role":"'"$role"'"}'
  else claims='{"role":"'"$role"'","sub":"'"$uid"'"}'; fi
  $PSQL_SU -d "$DB" -tA -c "begin;" -c "set local role $role;" \
    -c "set local request.jwt.claims = '$claims';" -c "$sql" -c "commit;" 2>&1 |
    grep -viE '^(begin|set|commit|rollback)$'
}

echo "═══════════════════════════════════════════════════════════════"
echo "  apply-backend-all.sql — تحقق على قاعدة تشبه الحيّة ($DB)"
echo "═══════════════════════════════════════════════════════════════"

$PSQL_SU -q -c "create database $DB" >/dev/null 2>&1 || { echo "تعذّر إنشاء قاعدة الاختبار"; exit 1; }
# محاكي Supabase + الأساس + حالة الفاتورة  = حالة القاعدة الحيّة اليوم
for f in scripts/supabase-stub.sql supabase/migrations/20260826200407_baseline.sql supabase/migrations/20260827104851_add_invoice_status.sql; do
  $PSQL_SU -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "❌ فشل تنفيذ $f"; exit 1; }
done

echo ""
echo "【0】 نُقلّد التسريب الموجود على القاعدة الحيّة"
Q "insert into auth.users(id,email) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','x@y.com')" >/dev/null
# ⚠️ لا نُمرّر id: إنه identity GENERATED ALWAYS (وقد فشل البذر أول مرة بسبب ذلك)
Q "insert into public.invoices(invoice_no, customer_name, total) values
     (1, 'sayed', 575), (2, 'نقدي', 112), (3, 'sayed', 135)" >/dev/null
# على الحيّة يمكن للزائر القراءة والكتابة على invoices (قاسها الفحص عن بُعد)
Q "create policy leak_probe_read on public.invoices for select using (true);
   create policy leak_probe_write on public.invoices for update using (true);
   create policy leak_probe_delete on public.invoices for delete using (true)" >/dev/null
# إعدادات مثل قاعدتك الحيّة (اسم المتجر · تذييل · كوبون · مفتاح داخلي)
Q "insert into public.settings (key, value) values
     ('store_name','آل السيد'), ('footer','شكراً لتسوقكم'), ('tax_pct','0'),
     ('coupon_code','SAVE10'), ('coupon_pct','10'), ('role_perms','{\"customer\":{}}'),
     ('baseline_synced','2026-08-26')" >/dev/null
ROWS=$(Q "select count(*) from public.invoices")
[ "$ROWS" = "3" ] && echo "  ✅ بذرنا 3 فواتير (كما على القاعدة الحيّة)" || echo "  ⚠️ البذر أنتج $ROWS صفًا"
BEFORE=$(as_role anon - "select count(*) from public.invoices" | tail -1)
[ "$BEFORE" = "3" ] && ok "الزائر يقرأ الفواتير فعليًا (3 صفوف) — نفس الحالة الحيّة" || bad "لم أستطع محاكاة التسريب (قرأ $BEFORE)"

echo ""
echo "【1】 تنفيذ الملف كاملًا كما سيفعل المستخدم"
$PSQL_SU -d "$DB" -v ON_ERROR_STOP=1 -f "$FILE" > /tmp/apply-run.txt 2>&1
if [ $? -eq 0 ]; then ok "نُفِّذ بلا خطأ ($(grep -c '' /tmp/apply-run.txt) سطر ناتج)"; else bad "فشل التنفيذ" "$(grep -iE 'error|خطأ' /tmp/apply-run.txt | head -2 | tr '\n' ' ')"; fi

echo ""
echo "【2】 هل أُغلق التسريب فعلًا؟"
AFTER=$(as_role anon - "select count(*) from public.invoices" | tail -1)
[ "$AFTER" = "0" ] && ok "الزائر يقرأ صفر فواتير" || bad "ما زال يقرأ $AFTER فاتورة"
# ⚠️ نقيس **الأثر** لا رسالة الخطأ: سياسة RLS لا تُصدر خطأً، بل تُصفّر عدد الصفوف
#    المتأثرة — فالاعتماد على ظهور «permission denied» هنا كان سيُعطي نتيجة مضلِّلة.
TOTAL_BEFORE=$(Q "select total from public.invoices order by id limit 1")
as_role anon - "update public.invoices set total = 1 where id = (select min(id) from public.invoices)" >/dev/null 2>&1
TOTAL_AFTER=$(Q "select total from public.invoices order by id limit 1")
[ "$TOTAL_BEFORE" = "$TOTAL_AFTER" ] && ok "الزائر لا يعدّل الفواتير (القيمة لم تتغيّر: $TOTAL_AFTER)" || bad "الزائر عدّل فاتورة! ($TOTAL_BEFORE → $TOTAL_AFTER)"
as_role anon - "delete from public.invoices where id = (select min(id) from public.invoices)" >/dev/null 2>&1
STILL=$(Q "select count(*) from public.invoices")
[ "$STILL" = "3" ] && ok "الزائر لا يحذف الفواتير (العدد ما زال 3)" || bad "الزائر حذف فاتورة! صار $STILL"
as_role anon - "insert into public.invoices(invoice_no, customer_name, total) values (9999, 'زائر', 1)" >/dev/null 2>&1
STILL2=$(Q "select count(*) from public.invoices")
[ "$STILL2" = "3" ] && ok "الزائر لا يُنشئ فاتورة" || bad "الزائر أنشأ فاتورة! صار $STILL2"

echo ""
echo "【2-ب】 واجهة الزائر لم تفقد إعداداتها (العطل الذي كاد يقع بصمت)"
PUB_KEYS=$(as_role anon - "select count(*) from public.settings" | tail -1)
[ "${PUB_KEYS:-0}" -ge 5 ] && ok "الزائر يقرأ المفاتيح العامة ($PUB_KEYS) — التذييل والكوبون باقيان" || bad "الزائر يقرأ $PUB_KEYS مفتاحًا ⇒ سيفقد التذييل والكوبون"
SEEN=$(as_role anon - "select count(*) from public.settings where key='baseline_synced'" | tail -1)
[ "${SEEN:-1}" = "0" ] && ok "المفتاح الداخلي غير مكشوف للزائر" || bad "المفتاح الداخلي مكشوف!"
COUPON=$(as_role anon - "select value from public.settings where key='coupon_code'" | tail -1)
[ "$COUPON" = "SAVE10" ] && ok "الكوبون متاح للزائر (كما تقرأه الواجهة)" || bad "الكوبون غير متاح للزائر" "$COUPON"

echo ""
echo "【3】 الكائنات أُنشئت"
T=$(Q "select count(*) from pg_tables where schemaname='public' and tablename not like 'spatial%'")
[ "$T" = "8" ] && ok "8 جداول (منها login_attempts)" || bad "عدد الجداول $T"
FN=$(Q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('next_invoice_no','assign_invoice_no','decrement_stock','increment_stock','public_settings','login_gate','login_fail','login_ok')")
[ "$FN" = "8" ] && ok "الدوال الثمانية الجديدة موجودة" || bad "عددها $FN بدل 8"
TR=$(Q "select count(*) from pg_trigger where tgname='trg_profiles_no_escalation'")
[ "$TR" = "1" ] && ok "حارس تصعيد الصلاحيات مُفعَّل" || bad "الحارس مفقود"
RT=$(Q "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'")
[ "$RT" = "4" ] && ok "Realtime على 4 جداول حيّة" || bad "Realtime على $RT جدول"
LP=$(Q "select count(*) from pg_policies where schemaname='public' and tablename='login_attempts'")
[ "$LP" = "0" ] && ok "login_attempts بلا سياسات (الوصول بالدوال فقط)" || bad "له $LP سياسة"

echo ""
echo "【4】 تقرير الملف النهائي يقول ✅"
# ملاحظة: psql لا يُظهر أسطر التعليقات (-- …) في ناتجه، فنتحقّق من **صفوف التقرير**
grep -q "① الجداول" /tmp/apply-run.txt && ok "التقرير مطبوع في ناتج التنفيذ" || bad "لا تقرير في الناتج"
grep -qE "صحيح|كلها موجودة|لا شيء|مُفعَّل|سليمة" /tmp/apply-run.txt && ok "صفوف التقرير تحمل أحكامًا ✅" || bad "التقرير بلا أحكام"
grep -qE "❌" /tmp/apply-run.txt && bad "التقرير يحتوي ❌" "$(grep -E '❌' /tmp/apply-run.txt | head -1)" || ok "لا ❌ في التقرير"

echo ""
echo "【5】 ثابت idempotency: كل create policy مسبوق بـdrop policy if exists"
MISSING=$(python3 - <<'PYEOF'
import re, pathlib
txt = pathlib.Path("scripts/apply-backend-all.sql").read_text(encoding="utf-8")
seen, missing = set(), []
for ln in txt.split("\n"):
    m = re.search(r'create policy\s+"?([^"\s]+)"?\s+on\s+([a-zA-Z_.]+)', ln, re.I)
    if m:
        name, tbl = m.group(1), m.group(2)
        if (name.lower(), tbl.lower()) not in seen:
            missing.append(name + " on " + tbl)   # لم يسبقه drop
    d = re.search(r'drop policy if exists\s+"?([^"\s]+)"?\s+on\s+([a-zA-Z_.]+)', ln, re.I)
    if d:
        seen.add((d.group(1).lower(), d.group(2).lower()))
print(" · ".join(missing[:4]))
PYEOF
)
[ -z "$MISSING" ] && ok "كل سياسة تُحذف قبل إنشائها (لا «already exists» أبدًا)" || bad "سياسات بلا drop قبلها" "$MISSING"

echo "【6】 آمن الإعادة: تشغيل ثانٍ بلا خطأ"
$PSQL_SU -d "$DB" -v ON_ERROR_STOP=1 -f "$FILE" > /tmp/apply-run2.txt 2>&1
if [ $? -eq 0 ]; then ok "التشغيل الثاني نجح (المستخدم يعيده بلا خوف)"; else bad "التشغيل الثاني فشل" "$(grep -iE 'error' /tmp/apply-run2.txt | head -2 | tr '\n' ' ')"; fi
T2=$(Q "select count(*) from pg_tables where schemaname='public' and tablename not like 'spatial%'")
[ "$T2" = "8" ] && ok "لا ازدواج كائنات بعد الإعادة (8 جداول)" || bad "الجداول صارت $T2"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "【7】 🔴 السيناريو (ب): pg_trgm منصَّبة في public — **نفس ترتيب قاعدتك الحيّة**"
echo "     (هذا العطل وقع فعلًا: ERROR 42704 operator class \"extensions.gin_trgm_ops\""
echo "      does not exist ⇒ تراجعت كل الإصلاحات لأن SQL Editor يلفّها في معاملة واحدة)"
$PSQL_SU -q -c "create database $DB2" >/dev/null 2>&1
sed 's/create extension if not exists pg_trgm with schema extensions;/create extension if not exists pg_trgm with schema public;/' \
  scripts/supabase-stub.sql > /tmp/stub_pub.sql
if grep -q "pg_trgm with schema public" /tmp/stub_pub.sql; then ok "بنينا محاكيًا فيه pg_trgm في public (كما قاعدتك)"; else bad "فشل تحضير المحاكي"; fi
for f in /tmp/stub_pub.sql supabase/migrations/20260826200407_baseline.sql supabase/migrations/20260827104851_add_invoice_status.sql; do
  $PSQL_SU -d "$DB2" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { bad "فشل تحضير $f"; }
done
OPC=$($PSQL_SU -d "$DB2" -tAc "select n.nspname from pg_opclass o join pg_namespace n on n.oid=o.opcnamespace where o.opcname='gin_trgm_ops' limit 1" | tr -d ' ')
[ "$OPC" = "public" ] && ok "الصنف gin_trgm_ops في public (لا في extensions)" || bad "الصنف في «$OPC» — المحاكي غير مطابق"
$PSQL_SU -d "$DB2" -tAc "create policy leak_probe_read on public.invoices for select using (true);
   insert into public.invoices(invoice_no, customer_name, total) values (1,'sayed',575)" >/dev/null 2>&1
# 🎯 الملف يجب أن ينجح رغم أن الامتداد في مخطط آخر — وهذا ما لم يكن يحدث قبل الإصلاح
$PSQL_SU -d "$DB2" -v ON_ERROR_STOP=1 -f "$FILE" > /tmp/apply-pub.txt 2>&1
if [ $? -eq 0 ]; then ok "الملف نُفِّذ بلا خطأ رغم أن pg_trgm في public"; else bad "ما زال يفشل" "$(grep -iE 'error' /tmp/apply-pub.txt | head -1)"; fi
grep -q "فهارس البحث التقريبي جاهزة (الصنف في مخطط public)" /tmp/apply-pub.txt && ok "الملف أدرك المخطط الصحيح وبنى الفهرس به" || bad "لم يُبنِ الفهرس بالمخطط الصحيح"
IDX=$($PSQL_SU -d "$DB2" -tAc "select count(*) from pg_indexes where schemaname='public' and indexname in ('idx_items_name_trgm','idx_categories_name_trgm')" | tr -d ' ')
[ "$IDX" = "2" ] && ok "الفهرسان موجودان فعلًا (public)" || bad "عدد الفهارس $IDX بدل 2"
AFTER2=$($PSQL_SU -d "$DB2" -tAc "begin; set local role anon; select count(*) from public.invoices; commit;" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)
[ "$AFTER2" = "0" ] && ok "الإصلاح الأمني نُفِّذ مع ذلك (الزائر يقرأ صفر فواتير)" || bad "التسريب باقٍ في هذا السيناريو ($AFTER2)"
# تحقق من عدم كسر أي شيء آخر في هذا السيناريو
PUBFN=$($PSQL_SU -d "$DB2" -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('login_gate','public_settings','next_invoice_no')" | tr -d ' ')
[ "$PUBFN" = "3" ] && ok "الدوال الجديدة أُنشئت في هذا السيناريو أيضًا" || bad "الدوال الناقصة ($PUBFN/3)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  النتيجة: $PASS ناجح · $FAIL فاشل"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ الملف جاهز للصق في SQL Editor"; else echo "  ❌ يحتاج إصلاحًا — لا تُسلّمه بعد"; fi
echo "═══════════════════════════════════════════════════════════════"
exit $(( FAIL > 0 ? 1 : 0 ))

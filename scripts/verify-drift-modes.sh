#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  T3.7 — الدورة الكاملة لأداة انحراف المخطط، على قاعدة حقيقية
#
#  ما يفحصه هذا الملف (لا يفترضه):
#   1) `schema-inventory.sql` يعمل فعلًا على قاعدة عليها كل الترحيلات
#   2) القاعدة المطابقة للمستودع ⇒ «لا انحراف» — بلا فروق كاذبة
#   3) تعديلات حقيقية في القاعدة ⇒ تُكتشف **وتُصنَّف في الاتجاه الصحيح**
#   4) `--emit-migration`: لا يدّعي مسوّدة حين لا يملك تعريفات، وحين يملكها
#      يكتبها آمنة الإعادة (idempotent) وتُنفَّذ فعلًا
#   5) وضع pg_dump (ملف SQL) يعمل أيضًا
#
#  ⚠️ هذا الملف ليس تمرينًا شكليًا: أول تشغيل له كشف **أربعة عيوب حقيقية**
#  في الأداة (تسبيق public. · أعمدة متعددة في عبارة واحدة · دوال الإضافات ·
#  مسوّدة تفشل بـalready exists) — وكلها كانت ستظهر للمستخدم كضجيج أو فشل.
#
#  الاستخدام: bash scripts/verify-drift-modes.sh
#  المتطلبات: postgresql + postgresql-contrib + sudo -n -u postgres
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

DB="t_drift_$$"
PSQL_SU="sudo -n -u postgres psql"
WORK="$(mktemp -d /tmp/t37-XXXXXX)"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1${2:+  → $2}"; FAIL=$((FAIL+1)); }
cleanup() { $PSQL_SU -q -c "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
Q() { $PSQL_SU -d "$DB" -tAc "$1" 2>&1 | tr -d '\r' | grep -viE '^(begin|set|commit|rollback|do)$' | sed '/^$/d'; }
INV="$WORK/inventory.txt"
DUMP="$WORK/dump.sql"

refresh_inv() { $PSQL_SU -d "$DB" -tA -f scripts/schema-inventory.sql > "$INV" 2>"$WORK/err.txt"; }

echo "═══════════════════════════════════════════════════════════════"
echo "  T3.7 — دورة الجرد الكاملة ($DB)"
echo "═══════════════════════════════════════════════════════════════"

$PSQL_SU -q -c "create database $DB" >/dev/null 2>&1 || { echo "تعذّر إنشاء قاعدة الاختبار"; exit 1; }
for f in scripts/supabase-stub.sql cloud-schema.sql supabase/migrations/*.sql; do
  $PSQL_SU -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "❌ فشل تنفيذ $f"; exit 1; }
done

echo ""
echo "【1】 استعلام الجرد يعمل على قاعدة كاملة الترحيلات"
refresh_inv
if [ -s "$INV" ]; then ok "أخرج $(wc -l < "$INV") سطرًا"; else bad "لم يُخرج شيئًا" "$(head -2 "$WORK/err.txt")"; fi
grep -qx 'table|public.login_attempts|'          "$INV" && ok "الجدول الجديد (login_attempts) ظاهر" || bad "login_attempts غائب"
grep -qx 'function|login_gate|'                  "$INV" && ok "دوال القفل (F2) ظاهرة" || bad "دوال F2 غائبة"
grep -qx 'function|crypt|'                       "$INV" && bad "دوال الإضافات (pgcrypto) تُلوّث الجرد" || ok "دوال الإضافات مُستثناة"
grep -q '^table|storage\.'                       "$INV" && bad "جداول storage ظاهرة (فروق كاذبة)" || ok "جداول storage مُستثناة (منصة لا مشروع)"
grep -q  '^trigger|users\.on_auth_user_created|' "$INV" && ok "مشغّل auth.users ظاهر (وإلا ظهر «ناقصًا» كذبًا)" || bad "مشغّل إنشاء الحساب غائب" "$(grep '^trigger|' "$INV" | head -2 | tr '\n' ' ')"
grep -qx 'column|updated_at|public.invoices'     "$INV" && ok "عمود updated_at ظاهر (الثاني في عبارة add column)" || bad "عمود updated_at غائب عن الجرد"

echo ""
echo "【2】 قاعدة مطابقة للمستودع ⇒ لا انحراف"
node scripts/verify-schema-drift.js "$INV" > "$WORK/run1.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "exit 0" || bad "انحراف كاذب (exit $RC)" "$(grep -E '^\s+•' "$WORK/run1.txt" | head -4 | tr '\n' ' ')"
grep -q 'لا انحراف' "$WORK/run1.txt" && ok "الرسالة صريحة: «لا انحراف»" || bad "لا رسالة واضحة"

echo ""
echo "【3】 تعديلات حقيقية في القاعدة ⇒ تُكتشف وتُصنَّف"
Q "drop policy items_write on public.items;
   create policy rogue_extra_policy on public.items for select using (true);
   alter table public.items add column ghost_col text;
   drop function public.login_ok(text, text);
   create table public.sneaky_table (id int);
   alter publication supabase_realtime drop table public.invoices;" >/dev/null
refresh_inv
node scripts/verify-schema-drift.js "$INV" > "$WORK/run2.txt" 2>&1
RC=$?
[ "$RC" -eq 1 ] && ok "الانحراف مُكتشف (exit 1)" || bad "لم يُكتشف (exit $RC)"
check_row() {
  grep -qE "$2" "$WORK/run2.txt" && ok "$1" || bad "$1" "$(grep -E '^\s+•' "$WORK/run2.txt" | head -3 | tr '\n' ' ')"
}
check_row "سياسة في المستودع وليست على القاعدة"  '\[سياسة\] items\.items_write — في المستودع وليس على القاعدة'
check_row "سياسة على القاعدة وليست في المستودع"  '\[سياسة\] items\.rogue_extra_policy — على القاعدة وليس في المستودع'
check_row "عمود على القاعدة وليس في المستودع"    '\[عمود\] items\.ghost_col — على القاعدة وليس في المستودع'
check_row "دالة في المستودع وليست على القاعدة"   '\[دالة\] login_ok — في المستودع وليس على القاعدة'
check_row "جدول على القاعدة وليس في المستودع"    '\[جدول\] sneaky_table — على القاعدة وليس في المستودع'
check_row "Realtime مُسقَط عن invoices"          '\[realtime\] invoices — في المستودع وليس مُفعَّلًا'
DIFFS=$(grep -cE '^\s+•' "$WORK/run2.txt")
[ "$DIFFS" -eq 6 ] && ok "عدد الفروق بالضبط 6 (لا ضجيج)" || bad "عدد الفروق $DIFFS وليس 6" "$(grep -E '^\s+•' "$WORK/run2.txt" | tr '\n' ' ')"

echo ""
echo "【4】 --emit-migration: لا يدّعي ما لا يملك"
node scripts/verify-schema-drift.js "$INV" --emit-migration "$WORK/draft1.sql" > "$WORK/emit1.txt" 2>&1
grep -q 'لا تعريفات نصية' "$WORK/emit1.txt" && ok "يُصرّح بأن الجرد بلا تعريفات (لا مسوّدة وهمية)" || bad "صمت مضلِّل" "$(tail -2 "$WORK/emit1.txt" | tr '\n' ' ')"
grep -qE '^\s*create ' "$WORK/draft1.sql" 2>/dev/null && bad "كتب تعريفات مُختلقة" || ok "المسوّدة بلا تعريفات مُختلقة"

echo ""
echo "【5】 نسخة تعريفية كاملة (شبيهة بـpg_dump) ⇒ مسوّدة تُنفَّذ فعلًا"
{
  echo "-- نسخة اختبارية تشبه pg_dump (تعريفات لا أسماء)"
  awk -F'|' '/^table\|/     { gsub(/^(public|storage)\./, "", $2); print "create table if not exists public." $2 " (id uuid);" }' "$INV"
  awk -F'|' '/^function\|/  { print "create or replace function public." $2 "() returns void language sql as $$ select 1 $$;" }' "$INV"
  awk -F'|' '/^policy\|/    { print "create policy " $2 " on " $3 " for select using (true);" }' "$INV"
  awk -F'|' '/^index\|/     { print "create index if not exists " $2 " on " $3 " (id);" }' "$INV"
  awk -F'|' '/^publication\|/ { print "alter publication supabase_realtime add table public." $2 ";" }' "$INV"
  # \047 = علامة التنصيص المفردة داخل awk (تفاديًا لتعقيد تنصيص bash)
  awk -F'|' '/^bucket\|/    { printf "insert into storage.buckets (id) values (\047%s\047);\n", $2 }' "$INV"
  # كائنان غريبان بتعريف نصي: يجب أن يظهرا في المسوّدة
  echo "create table public.sneaky_ghost (id uuid, note text);"
  echo "create policy rogue_ghost_policy on public.items for select using (true);"
} > "$DUMP"
node scripts/verify-schema-drift.js "$DUMP" --emit-migration "$WORK/draft2.sql" > "$WORK/run3.txt" 2>&1
grep -q 'نسخة pg_dump' "$WORK/run3.txt" && ok "وضع pg_dump يتعرّف على المصدر" || bad "لم يتعرّف على وضع pg_dump"
grep -qE '\[مشغّل\]' "$WORK/run3.txt" && ok "غياب المشغّلات في dump مذكور (متوقع: dump ناقص)" || bad "لم يلاحظ غياب المشغّلات"
grep -q 'sneaky_ghost' "$WORK/draft2.sql" && ok "المسوّدة تضم تعريف الجدول الغريب" || bad "الجدول الغريب غائب" "$(wc -l < "$WORK/draft2.sql") سطرًا"
grep -q 'rogue_ghost_policy' "$WORK/draft2.sql" && ok "المسوّدة تضم تعريف السياسة الغريبة" || bad "السياسة الغريبة غائبة"
grep -q 'drop policy if exists' "$WORK/draft2.sql" && ok "السياسات في المسوّدة آمنة الإعادة (drop if exists)" || bad "مسوّدة غير آمنة الإعادة"
# التنفيذ الفعلي على نفس القاعدة: يجب ألّا يفشل بـalready exists
chmod -R a+rX "$WORK"   # psql يعمل كمستخدم postgres وmktemp مقيَّد بـ700
$PSQL_SU -d "$DB" -q -v ON_ERROR_STOP=1 -f "$WORK/draft2.sql" >/dev/null 2>"$WORK/err2.txt"
if [ $? -eq 0 ]; then ok "المسوّدة تُنفَّذ على PostgreSQL بلا خطأ"; else bad "المسوّدة لا تُنفَّذ" "$(head -2 "$WORK/err2.txt" | tr '\n' ' ')"; fi
# المسوّدة تُصلح اتجاهًا واحدًا فقط: «على القاعدة وليس في المستودع».
# أما «في المستودع وليس على القاعدة» فحلّها إعادة تنفيذ الترحيلات — لا المسوّدة.
grep -q 'sneaky_table'      "$WORK/draft2.sql" && ok "المسوّدة تغطي الجدول الغريب الطارئ (اتجاه واحد)" || bad "لا تغطي الطارئ"
grep -q 'items_write'       "$WORK/draft2.sql" && bad "المسوّدة تمسّ كائنًا من المستودع" || ok "لا تمسّ كائنات المستودع إطلاقًا"
grep -qE '^drop (table|function|column)' "$WORK/draft2.sql" && bad "المسوّدة تحتوي حذفًا (خطر)" || ok "بلا أي حذف — إضافة فقط"
# وبعد تنفيذها: لا تُخرّب شيئًا. التفصيل المهم هنا: المسوّدة **تُنشئ فعلًا**
# الكائنين المُختلقين في نسخة الاختبار (sneaky_ghost · rogue_ghost_policy)،
# فهما يظهران بعد التنفيذ ضمن «على القاعدة» — أما الاتجاه المعاكس (كائنات
# المستودع الناقصة) فيجب ألّا يتغيّر إطلاقًا.
refresh_inv
node scripts/verify-schema-drift.js "$INV" > "$WORK/run4.txt" 2>&1
before_live=$(grep -cE '• .* — على القاعدة وليس في المستودع' "$WORK/run2.txt")
after_live=$(grep -cE '• .* — على القاعدة وليس في المستودع' "$WORK/run4.txt")
before_repo=$(grep -cE '• .* — في المستودع وليس على القاعدة' "$WORK/run2.txt")
after_repo=$(grep -cE '• .* — في المستودع وليس على القاعدة' "$WORK/run4.txt")
[ "$after_repo" = "$before_repo" ] && ok "نقص المستودع لم يتغيّر ($after_repo كما هو)" || bad "تغيّر نقص المستودع ($after_repo بدل $before_repo)"
[ "$after_live" = "$((before_live + 2))" ] && ok "الزيادة على القاعدة = الكائنان المُختلقان بالضبط (لا مفاجآت)" || bad "زيادة غير متوقعة ($after_live بدل $((before_live + 2)))"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  النتيجة: $PASS ناجح · $FAIL فاشل"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ أداة الانحراف موثوقة: تطابق ⇒ صمت · اختلاف ⇒ تشخيص مصنَّف · ومسوّدة تُنفَّذ"; else echo "  ❌ الأداة تحتاج إصلاحًا"; fi
echo "═══════════════════════════════════════════════════════════════"
exit $(( FAIL > 0 ? 1 : 0 ))

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  التحقق من scripts/grant-role.sql — على قاعدة حقيقية
#
#  نُثبت (لا نفترض):
#   1) بلا أوامر psql (`\set` · `:'var'`) — SQL Editor لا يفهمها
#   2) موضع تعديل واحد فقط (السطرين ✏️) والتحقق أسفله يعمل تلقائيًا
#   3) يُرقّي عميلًا → مدير فعلًا · ويُنزل مديرًا → عامل
#   4) يرفض اسمًا غير موجود ودورًا غير معروف — برسالة مفهومة لا صمت
#   5) الحارس `prevent_role_escalation` ما زال مُفعَّلًا بعده
#   6) امتلاك SQL وحده لا يرقّي (المسار الموثوق هو service_role)
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

DB="t_grant_$$"
PSQL_SU="sudo -n -u postgres psql"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1${2:+  → $2}"; FAIL=$((FAIL+1)); }
cleanup() { $PSQL_SU -q -c "drop database if exists $DB" >/dev/null 2>&1; }
trap cleanup EXIT
# ملاحظة: نُصفّي أسطر psql الصامتة (BEGIN/SET/COMMIT) وإلا التبست بالنتائج
Q() { $PSQL_SU -d "$DB" -tAc "$1" 2>&1 | tr -d '\r' | grep -viE '^(begin|set|commit|rollback|do)$' | sed '/^$/d'; }
# ⚠️ أي تغيير دور مرفوض بلا هوية موثوقة (هذا هو الحارس نفسه!) — فالبذر يمر عبر
# مسار service_role، ولو بذرنا كـpostgres عادي لَرُجع كل شيء بصمت وبدت الدوال معطوبة.
svc() { $PSQL_SU -d "$DB" -q -c "begin; set local role service_role; set local request.jwt.claims = '{\"role\":\"service_role\"}'; $1; commit;" 2>&1; }

echo "═══════════════════════════════════════════════════════════════"
echo "  grant-role.sql — تحقق على PostgreSQL حقيقي ($DB)"
echo "═══════════════════════════════════════════════════════════════"

$PSQL_SU -q -c "create database $DB" >/dev/null 2>&1 || { echo "تعذّر إنشاء قاعدة الاختبار"; exit 1; }
for f in scripts/supabase-stub.sql cloud-schema.sql supabase/migrations/*.sql; do
  $PSQL_SU -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "❌ فشل تنفيذ $f"; exit 1; }
done

# بذر ثلاثة حسابات. ⚠️ لا نُدرج profiles بأنفسنا: المشغّل `handle_new_user` ينشئها
# تلقائيًا (username = ما قبل @ · role = customer) وإدراجنا يتعارض مع المفتاح الأساسي.
Q "insert into auth.users(id,email) values
     ('44444444-4444-4444-4444-444444444444','cust@x.com'),
     ('55555555-5555-5555-5555-555555555555','work@x.com'),
     ('66666666-6666-6666-6666-666666666666','boss@x.com'),
     ('77777777-7777-7777-7777-777777777777','cust2@x.com')" >/dev/null
svc "update public.profiles set username='custuser', display_name='عميل' where id='44444444-4444-4444-4444-444444444444'" >/dev/null
svc "update public.profiles set username='workuser', display_name='عامل', role='worker' where id='55555555-5555-5555-5555-555555555555'" >/dev/null
svc "update public.profiles set username='bossuser', display_name='مدير', role='admin' where id='66666666-6666-6666-6666-666666666666'" >/dev/null
svc "update public.profiles set username='cust2', display_name='عميل ثانٍ' where id='77777777-7777-7777-7777-777777777777'" >/dev/null
SEED=$(Q "select count(*) from public.profiles")
if [ "$SEED" != "4" ]; then echo "❌ تعذّر بذر الحسابات (profiles=$SEED)"; exit 1; fi

echo ""
echo "【1】 الملف يصلح لـSQL Editor"
# نُجرّد التعليقات أولًا: ذكر الأمر في شرح ليس استخدامًا له
sed -E 's/--.*$//' scripts/grant-role.sql > /tmp/grant-nocomment.sql
if grep -qE "\\\\set|:'[a-z_]+'" /tmp/grant-nocomment.sql; then
  bad "لا يزال يستخدم \\set أو :'var'" "$(grep -nE "\\\\set|:'[a-z_]+'" /tmp/grant-nocomment.sql | head -2 | tr '\n' ' ')"
else
  ok "بلا \\set وبلا :'var' — يعمل في SQL Editor"
fi
grep -q 'do \$\$' scripts/grant-role.sql && ok "منطق الترقية داخل do \$\$ بقيم حرفية" || bad "لا يوجد do \$\$"

echo ""
echo "【2】 موضع تعديل واحد فقط"
PLACEHOLDERS=$(sed -E 's/--.*$//' scripts/grant-role.sql | grep -c "target_username text := 'اكتب-اسم-المستخدم'")
[ "$PLACEHOLDERS" = "1" ] && ok "الاسم مطلوب تعديله مرة واحدة (سطر الإسناد)" || bad "سطر الإسناد غير موجود أو مكرَّر ($PLACEHOLDERS)"
grep -q "current_setting('app.grant_target'" scripts/grant-role.sql && ok "استعلام التحقق يقرأ الاسم تلقائيًا" || bad "التحقق يحتاج تعديلًا يدويًا"

# تشغيل الملف كما يفعل المستخدم: تعديل سطر الاسم فقط
run_grant() { # run_grant <username> [role]
  sed -e "s/target_username text := 'اكتب-اسم-المستخدم'/target_username text := '$1'/" \
      ${2:+-e "s/target_role     text := 'admin'/target_role     text := '$2'/"} \
      scripts/grant-role.sql > /tmp/grant-run.sql
  $PSQL_SU -d "$DB" -v ON_ERROR_STOP=1 -f /tmp/grant-run.sql 2>&1
}

echo ""
echo "【3】 الترقية فعلًا"
OUT=$(run_grant custuser admin)
[ "$(Q "select role from public.profiles where username='custuser'")" = "admin" ] && ok "عميل → مدير" || bad "الدور: $(Q "select role from public.profiles where username='custuser'")"
echo "$OUT" | grep -q '✅ custuser' && ok "إشعار النجاح يذكر الاسم والدورين" || bad "لا إشعار نجاح" "$(echo "$OUT" | tail -2 | tr '\n' ' ')"
echo "$OUT" | grep -qE 'custuser[[:space:]]*\|' && echo "$OUT" | grep -qE '\|[[:space:]]*admin' \
  && ok "جدول التحقق أسفل النتائج يُظهر الاسم والدور الجديد" || bad "جدول التحقق فارغ أو لا يُظهر الدور" "$(echo "$OUT" | tail -3 | tr '\n' ' ')"
run_grant workuser worker >/dev/null 2>&1
[ "$(Q "select role from public.profiles where username='workuser'")" = "worker" ] && ok "إنزال مدير → عامل يعمل" || bad "إنزال الدور فشل"

echo ""
echo "【4】 الرفض الواضح"
OUT=$(run_grant لايوجد-هذا-الاسم admin 2>&1)
echo "$OUT" | grep -q 'لا يوجد حساب بالاسم' && ok "اسم غير موجود ⇒ رسالة مفهومة" || bad "صمت أو رسالة غامضة" "$(echo "$OUT" | tail -2 | tr '\n' ' ')"
OUT=$(run_grant custuser superuser 2>&1)
echo "$OUT" | grep -q 'غير معروف' && ok "دور غير معروف ⇒ رفض" || bad "قبل دورًا غير معروف" "$(echo "$OUT" | tail -2 | tr '\n' ' ')"
OUT=$($PSQL_SU -d "$DB" -v ON_ERROR_STOP=1 -f scripts/grant-role.sql 2>&1)
echo "$OUT" | grep -q 'عدّل target_username' && ok "تشغيل الملف بلا تعديل ⇒ يشرح ما المطلوب" || bad "بلا تعديل: لا رسالة واضحة" "$(echo "$OUT" | tail -2 | tr '\n' ' ')"

echo ""
echo "【5】 الحارس لم يُعطَّل"
TR=$(Q "select tgenabled from pg_trigger where tgname='trg_profiles_no_escalation'")
[ "$TR" = "O" ] && ok "المشغّل مُفعَّل (O)" || bad "حالة المشغّل: $TR"
OUT=$($PSQL_SU -d "$DB" -tA -c "begin;
  set local role authenticated;
  set local request.jwt.claims = '{\"role\":\"authenticated\",\"sub\":\"77777777-7777-7777-7777-777777777777\"}';
  update public.profiles set role='admin' where id='77777777-7777-7777-7777-777777777777';
  commit;" 2>&1)
echo "$OUT" | grep -q 'ممنوع' && ok "عميل (cust2) يرقّي نفسه ⇒ مرفوض" || bad "تصعيد ممكن!" "$OUT"

echo ""
echo "【6】 امتلاك SQL وحده لا يرقّي"
OUT=$($PSQL_SU -d "$DB" -tA -c "begin; update public.profiles set role='admin' where username='cust2'; commit;" 2>&1)
echo "$OUT" | grep -q 'ممنوع' && ok "بلا هوية ولا service_role ⇒ مرفوض (حتى لصاحب SQL)" || bad "مرّ بلا مسار موثوق!" "$OUT"
[ "$(Q "select role from public.profiles where username='cust2'")" = "customer" ] && ok "cust2 ما زال عميلًا بعد كل المحاولات" || bad "تغيّر دور بلا مسار موثوق!"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  النتيجة: $PASS ناجح · $FAIL فاشل"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ grant-role.sql جاهز للتسليم للمستخدم"; else echo "  ❌ يحتاج إصلاحًا"; fi
echo "═══════════════════════════════════════════════════════════════"
exit $(( FAIL > 0 ? 1 : 0 ))

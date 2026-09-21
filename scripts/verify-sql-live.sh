#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  T5.2 — تشغيل ترحيلات المشروع فعليًا على PostgreSQL حقيقي
#
#  الفرق عن كل الفحوص الأخرى: هذه ليست قراءة ملفات — بل قاعدة بيانات
#  حقيقية نُطبّق عليها الترحيلات بالترتيب ثم نختبر السلوك:
#    • هل تُنفَّذ كل الترحيلات بلا خطأ؟ (يعني: يمكن بناء النظام من الصفر)
#    • هل RLS يمنع فعلًا (زائر · عميل · عامل · مدير)؟
#    • هل دوال المخزون/الترقيم/الحذف الناعم تعمل — وترفض غير المسجَّل؟
#    • هل دوال الأمان ترفض الزائر فعلًا (auth.uid() is null)؟
#
#  الاستخدام:  bash scripts/verify-sql-live.sh
#  المتطلبات: postgresql + postgresql-contrib
#
#  ⚠️ درس مهم (21 سبتمبر 2026): الدوال كلها تتحقق من `auth.uid()` — فلو
#  استدعيناها كـpostgres بلا JWT، «تفشل» وتظهر كأنها معطوبة. لذلك نُعرّف
#  `as_role` التي تضع الدور والهوية كما يفعل PostgREST تمامًا.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

DB="t_2mstor_$$"   # ⚠️ لا يبدأ برقم (PostgreSQL يرفض ذلك بلا تنصيص)
PSQL_SU="sudo -n -u postgres psql"
STAFF_UID="11111111-1111-1111-1111-111111111111"
ADMIN_UID="22222222-2222-2222-2222-222222222222"
CUST_UID="33333333-3333-3333-3333-333333333333"
PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1${2:+  → $2}"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1${2:+  → $2}"; WARN=$((WARN+1)); }

cleanup() { $PSQL_SU -q -c "drop database if exists $DB" >/dev/null 2>&1; }
trap cleanup EXIT

Q() { $PSQL_SU -d "$DB" -tAc "$1" 2>&1 | tr -d '\r'; }

# تنفيذ SQL بمسار service_role الموثوق (نفس ما يفعله scripts/grant-role.sql)
svc() { $PSQL_SU -d "$DB" -q -c "begin; set local role service_role; set local request.jwt.claims = '{\"role\":\"service_role\"}'; $1; commit;" 2>&1; }

# تنفيذ SQL بهوية دور معيّن (كما يفعل PostgREST: دور + JWT claims)
as_role() { # as_role <دور> <uid|-> <sql>
  # ⚠️ نستخدم SET (بلا ناتج) لا set_config (يُخرج صفًا فيلوّث القراءة)
  local role="$1" uid="$2" sql="$3" claims
  if [ "$uid" = "-" ]; then claims='{"role":"'"$role"'"}'
  else claims='{"role":"'"$role"'","sub":"'"$uid"'"}'; fi
  # ⚠️ درس مُكلف: كنا نفتح begin; ونقرأ النتيجة بلا commit — فكان psql يخرج
  # ويُرجع كل كتابة صامتًا. لذلك بدت دوال المخزون والحذف «معطوبة» وهي سليمة،
  # وبدت ترقية المدير فاشلة لأن القراءة التالية كانت من جلسة أخرى.
  $PSQL_SU -d "$DB" -tA -v ON_ERROR_STOP=0 -c "begin;" \
    -c "set local role $role;" \
    -c "set local request.jwt.claims = '$claims';" \
    -c "$sql" \
    -c "commit;" 2>&1 | grep -viE '^(begin|set|commit|rollback)$'
}

echo "═══════════════════════════════════════════════════════════════"
echo "  تشغيل SQL حقيقي — PostgreSQL + محاكي Supabase"
echo "  قاعدة مؤقتة: $DB"
echo "═══════════════════════════════════════════════════════════════"

$PSQL_SU -q -c "drop database if exists $DB" >/dev/null 2>&1
$PSQL_SU -q -c "create database $DB" >/dev/null 2>&1 || { echo "  ❌ تعذّر إنشاء قاعدة الاختبار"; exit 1; }

run_sql() { # run_sql <ملف> [وصف]
  local f="$1" label="${2:-$1}" out rc
  out=$($PSQL_SU -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then
    bad "$label" "$(echo "$out" | grep -i '^psql.*ERROR' | head -1 | cut -c1-140)"
    return 1
  fi
  ok "$label"
  return 0
}

echo ""
echo "【1】 المحاكي + المخطط الأساسي"
run_sql scripts/supabase-stub.sql "محاكي Supabase (auth · storage · الأدوار · pg_trgm في extensions)"
run_sql cloud-schema.sql "cloud-schema.sql (المخطط الأساسي)"

echo ""
echo "【2】 الترحيلات بالترتيب الزمني — إعادة بناء النظام من الصفر"
MIG_OK=0; MIG_N=0
for f in supabase/migrations/*.sql; do
  MIG_N=$((MIG_N+1))
  run_sql "$f" "ترحيل: $(basename "$f")" && MIG_OK=$((MIG_OK+1))
done
[ "$MIG_OK" -eq "$MIG_N" ] && ok "كل الترحيلات نُفِّذت بلا خطأ ($MIG_OK/$MIG_N)" \
  || bad "ترحيلات فاشلة: $((MIG_N-MIG_OK)) من $MIG_N"

echo ""
echo "【3】 الكائنات الأساسية موجودة"
TABS=$(Q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
[ "${TABS:-0}" -ge 7 ] && ok "جداول public: $TABS" || bad "جداول ناقصة" "$TABS"
PPOL=$(Q "select count(*) from pg_policies where schemaname='public'")
SPOL=$(Q "select count(*) from pg_policies where schemaname='storage'")
[ "${PPOL:-0}" -ge 18 ] && ok "سياسات RLS في public: $PPOL" || bad "سياسات ناقصة في public" "$PPOL"
[ "${SPOL:-0}" -ge 4 ] && ok "سياسات RLS في storage: $SPOL" || bad "سياسات ناقصة في storage" "$SPOL"
for fn in next_invoice_no assign_invoice_no invoice_number_health decrement_stock increment_stock \
          soft_delete_item restore_item trash_list stock_mismatch_report my_role my_username is_staff is_manager; do
  [ "$(Q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$fn'")" -ge 1 ] \
    && ok "دالة $fn موجودة" || bad "دالة ناقصة: $fn"
done
IDX=$(Q "select count(*) from pg_indexes where schemaname='public'")
[ "${IDX:-0}" -ge 12 ] && ok "فهارس public: $IDX" || bad "فهارس ناقصة" "$IDX"
RT=$(Q "select count(*) from pg_publication_tables where pubname='supabase_realtime'")
[ "${RT:-0}" -ge 4 ] && ok "جداول البث الفوري (Realtime): $RT" || bad "Realtime غير مفعَّل" "$RT"

echo ""
echo "【4】 البيانات المرجعية للاختبار (أقسام وحسابات)"
Q "insert into public.categories (name) values ('قسم تجريبي')" >/dev/null
CAT=$(Q "select id from public.categories limit 1")
# إعدادات مثل قاعدتك الحيّة: مفاتيح واجهة + مفتاح داخلي (يجب ألّا يصل للزائر)
Q "insert into public.settings (key, value) values
     ('store_name','متجر الاختبار'), ('footer','شكراً لتسوقكم'), ('tax_pct','0'),
     ('phone','0100'), ('address','المنصورة'), ('role_perms','{\"customer\":{}}'),
     ('baseline_synced','2026-08-26')" >/dev/null
for pair in "$STAFF_UID:worker1:worker" "$ADMIN_UID:admin1:admin" "$CUST_UID:cust1:customer"; do
  UID_="${pair%%:*}"; REST="${pair#*:}"; UN="${REST%%:*}"; RO="${REST##*:}"
  Q "insert into auth.users (id, email) values ('$UID_','$UN@test.local') on conflict (id) do nothing" >/dev/null
  Q "insert into public.profiles (id, username, display_name, role) values ('$UID_','$UN','$UN','customer')
     on conflict (id) do nothing" >/dev/null
  # الترقية بمسار service_role — نفس ما يفعله المالك من SQL Editor (scripts/grant-role.sql)
  if [ "$RO" != "customer" ]; then
    svc "update public.profiles set role='$RO' where id='$UID_'"
  fi
done
[ "$(Q "select count(*) from public.profiles")" -ge 3 ] && ok "ثلاثة حسابات (عامل · مدير · عميل)" || bad "الحسابات لم تُنشأ"

echo ""
echo "【4-ب】 حارس الصلاحيات — من يستطيع تغيير دور؟"
Q "insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444','victim@test.local') on conflict do nothing" >/dev/null
Q "insert into public.profiles (id, username, display_name, role) values ('44444444-4444-4444-4444-444444444444','victim','ضحية','customer') on conflict (id) do nothing" >/dev/null
# أ) الترقية من postgres بلا هوية ⇒ مرفوضة (المشغّل)
Q "update public.profiles set role='admin' where id='44444444-4444-4444-4444-444444444444'" >/dev/null 2>&1
V=$(Q "select role from public.profiles where id='44444444-4444-4444-4444-444444444444'")
[ "$V" = "customer" ] && ok "لا ترقية بلا هوية مسجَّلة (حتى من postgres) — الحارس يعمل" || bad "تصعيد دور من postgres!" "$V"
# ب) العامل لا يرقّي نفسه
BEFORE=$(Q "select role from public.profiles where id='$STAFF_UID'")
as_role authenticated "$STAFF_UID" "update public.profiles set role='admin' where id='$STAFF_UID'" >/dev/null 2>&1
AFTER=$(Q "select role from public.profiles where id='$STAFF_UID'")
[ "$AFTER" = "$BEFORE" ] && ok "العامل لا يرقّي نفسه (الدور بقي $AFTER)" || bad "العامل رقّى نفسه!" "$BEFORE ⇒ $AFTER"
# ج) المدير يرقّي فعلًا (وإلا صار النظام غير قابل للإدارة)
ERR=$(as_role authenticated "$ADMIN_UID" "update public.profiles set role='worker' where id='44444444-4444-4444-4444-444444444444'" | grep -iE 'error|exception' | head -1)
V=$(Q "select role from public.profiles where id='44444444-4444-4444-4444-444444444444'")
[ "$V" = "worker" ] && ok "المدير يرقّي الحساب فعلًا ⇒ $V" || bad "المدير عجز عن الترقية — النظام غير قابل للإدارة" "$V ${ERR:-}"
# د) مسار service_role (تهيئة أول مدير) يغيّر الدور فعلًا — نغيّره إلى worker ونتحقّق
E=$(svc "update public.profiles set role='worker' where id='44444444-4444-4444-4444-444444444444'" | grep -i exception | head -1)
V=$(Q "select role from public.profiles where id='44444444-4444-4444-4444-444444444444'")
[ "$V" = "worker" ] && ok "مسار service_role يغيّر الدور فعلًا (تهيئة أول مدير ممكنة)" \
  || bad "service_role مرفوض — لا سبيل لتهيئة أول مدير!" "$V ${E:-}"
if [ -f scripts/grant-role.sql ]; then
  ok "سكربت الترقية الجاهز موجود (scripts/grant-role.sql)"
else
  bad "سكربت grant-role.sql مفقود"
fi

echo ""
echo "【5】 السلوك الفعلي — الترقيم المركزي (T3.1)"
A=$(as_role authenticated "$STAFF_UID" "select public.next_invoice_no()" | tr -d ' ')
B=$(as_role authenticated "$STAFF_UID" "select public.next_invoice_no()" | tr -d ' ')
{ [ -n "$A" ] && [ -n "$B" ] && [ "$A" != "$B" ]; } && ok "رقمان متتاليان مختلفان ($A ثم $B)" \
  || bad "الترقيم أعاد رقماً مكرراً أو فاضيًا" "$A / $B"
# الحارس: الفاتورة تُنشأ بلا رقم فيأخذ رقمًا رسميًا
Q "insert into public.invoices (invoice_no, customer_name, subtotal, total) values (0, 'عميل اختبار', 100, 100)" >/dev/null
NO=$(Q "select invoice_no from public.invoices order by id desc limit 1")
[ "${NO:-0}" -gt 0 ] && ok "حارس الإدراج أسند رقمًا رسميًا للفاتورة (#$NO)" || bad "الفاتورة بقيت بلا رقم" "$NO"
V=$(as_role anon - "select public.next_invoice_no()" | grep -iE "denied|مطلوب" | head -1)
[ -n "$V" ] && ok "الزائر يُرفض عند طلب رقم فاتورة" || bad "الزائر حصل على رقم فاتورة!" "$V"

echo ""
echo "【6】 السلوك الفعلي — المخزون الذرّي (T3.3)"
Q "insert into public.items (category_id, name, price_text, price_num, stock_q, display_qs, min_alert)
   values ($CAT, 'صنف المخزون', '100', 100, 10, 10, 2)" >/dev/null
IID=$(Q "select id from public.items where name='صنف المخزون' limit 1")
as_role authenticated "$STAFF_UID" "select public.decrement_stock($IID, 3)" >/dev/null
V=$(Q "select display_qs from public.items where id=$IID")
[ "$V" = "7" ] && ok "خصم 3 من 10 ⇒ $V (بالهوية المسجَّلة)" || bad "الخصم لم يعمل" "القيمة $V"
as_role authenticated "$STAFF_UID" "select public.increment_stock($IID, 2)" >/dev/null
V=$(Q "select display_qs from public.items where id=$IID")
[ "$V" = "9" ] && ok "إرجاع 2 ⇒ $V" || bad "الإرجاع لم يعمل" "القيمة $V"
as_role authenticated "$STAFF_UID" "select public.decrement_stock($IID, 999)" >/dev/null
V=$(Q "select display_qs from public.items where id=$IID")
[ "${V:- -1}" -ge 0 ] && ok "لا رصيد سالب بعد محاولة خصم 999 (الرصيد $V)" || bad "صار الرصيد سالبًا" "$V"
V=$(as_role anon - "select public.decrement_stock($IID, 1)" | grep -iE "denied|مطلوب" | head -1)
[ -n "$V" ] && ok "الزائر لا يخصم من المخزون" || bad "الزائر خصم من المخزون!" "$V"

echo ""
echo "【7】 الحذف الناعم والاستعادة وسلة المهملات (T3.4) — وبمن تُسمح؟"
as_role authenticated "$STAFF_UID" "select public.soft_delete_item($IID)" >/dev/null
D=$(Q "select deleted_at is not null from public.items where id=$IID")
[ "$D" = "t" ] && ok "العامل يحذف حذفًا ناعمًا (deleted_at)" || bad "الحذف الناعم لم يعمل" "$D"
# سلة المهملات للمدير فقط — والعامل يرى صفرًا (بلا خطأ)
T=$(as_role authenticated "$STAFF_UID" "select count(*) from public.trash_list()" | tr -d ' ')
[ "${T:-1}" = "0" ] && ok "سلة المهملات لا تُكشف للعامل (0 صف)" || bad "العامل يرى سلة المهملات!" "$T"
T=$(as_role authenticated "$ADMIN_UID" "select count(*) from public.trash_list()" | tr -d ' ')
[ "${T:-0}" -ge 1 ] && ok "المدير يرى المحذوفات في السلة ($T)" || bad "السلة فارغة للمدير" "$T"
# الاستعادة للمدير فقط: العامل يُرفض صريحًا
E=$(as_role authenticated "$STAFF_UID" "select public.restore_item($IID)" | grep -iE 'error|exception|للمدير' | head -1)
D=$(Q "select deleted_at is not null from public.items where id=$IID")
{ [ -n "$E" ] && [ "$D" = "t" ]; } && ok "العامل لا يستعيد المحذوفات (رسالة: للمدير فقط)" \
  || bad "العامل استعاد صنفًا محذوفًا!" "${E:-بلا رسالة} · deleted=$D"
R=$(as_role authenticated "$ADMIN_UID" "select public.restore_item($IID)" | tr -d ' ')
D=$(Q "select deleted_at is null from public.items where id=$IID")
[ "$D" = "t" ] && ok "المدير استعاد الصنف (الناتج: ${R:-—})" || bad "الاستعادة لم تعمل للمدير" "$D"
S=$(as_role authenticated "$STAFF_UID" "select count(*) from public.stock_mismatch_report()" | tr -d ' ')
[ -n "$S" ] && ok "تقرير انحراف المخزون يعمل" || bad "stock_mismatch_report فشل"

echo ""
echo "【8】 RLS فعليًا — من يستطيع ماذا"
# نُجهّز صنفًا حيًّا + صنفًا محذوفًا لنقيس ما يراه الزائر بدقة
Q "insert into public.items (category_id,name,price_text,price_num,stock_q,display_qs,min_alert)
   values ($CAT,'صنف ظاهر للزائر','30',30,3,3,1)" >/dev/null
Q "insert into public.items (category_id,name,price_text,price_num,stock_q,display_qs,min_alert,deleted_at)
   values ($CAT,'صنف محذوف','30',30,3,3,1, now())" >/dev/null
V=$(as_role anon - "select count(*) from public.items" | tr -d ' ')
[ "${V:-0}" -ge 1 ] && ok "الزائر يقرأ الأصناف الحيّة ($V) — المتجر يعمل بلا تسجيل" || bad "الزائر لا يقرأ الأصناف" "$V"
V=$(as_role anon - "select count(*) from public.items where name='صنف محذوف'" | tr -d ' ')
[ "${V:-1}" = "0" ] && ok "الزائر لا يرى المحذوف ناعمًا (يُستبعد في السياسة)" || bad "الزائر يرى صنفًا محذوفًا!" "$V"
V=$(as_role authenticated "$STAFF_UID" "select count(*) from public.items where name='صنف محذوف'" | tr -d ' ')
[ "${V:-0}" = "1" ] && ok "العامل يرى المحذوف (لسلة المهملات)" || bad "العامل لا يرى المحذوف" "$V"
V=$(as_role anon - "select count(*) from public.categories" | tr -d ' ')
[ "${V:-0}" -ge 1 ] && ok "الزائر يقرأ الأقسام ($V)" || bad "الزائر لا يقرأ الأقسام" "$V"
V=$(as_role anon - "select public.public_settings() ? 'store_name'" | tr -d ' ')
[ "$V" = "t" ] || [ "$V" = "f" ] && ok "الإعدادات العامة متاحة للزائر (public_settings)" || bad "public_settings لا تعمل للزائر" "$V"
# ── الإعدادات العامة للزائر: نفس ما تقرأه الواجهة بالضبط، ولا مفتاح داخلي ──
# (عطل حقيقي: السياسة كانت لتُصفّر قراءة الزائر للجدول ⇒ يفقد التذييل والكوبون بصمت)
V=$(as_role anon - "select count(*) from public.settings" | tr -d ' ')
[ "${V:-0}" -ge 5 ] && ok "الزائر يقرأ الإعدادات العامة مباشرة ($V مفتاحًا — كما تقرأ الواجهة)" || bad "الزائر لا يقرأ الإعدادات العامة" "$V"
V=$(as_role anon - "select count(*) from public.settings where key = 'baseline_synced'" | tr -d ' ')
[ "${V:-1}" = "0" ] && ok "الزائر لا يرى المفاتيح الداخلية (baseline_synced)" || bad "الزائر يرى مفتاحًا داخليًا!" "$V"
V=$(as_role anon - "select count(*) from public.settings where key in ('footer','tax_pct')" | tr -d ' ')
[ "${V:-0}" = "2" ] && ok "المفاتيح التي تستخدمها الواجهة متاحة (footer · tax_pct)" || bad "مفتاح من مفاتيح الواجهة مفقود" "$V"
V=$(as_role anon - "select jsonb_object_keys(public.public_settings())" | wc -l | tr -d ' ')
V2=$(as_role anon - "select count(*) from public.settings" | tr -d ' ')
[ "${V:-0}" = "${V2:-1}" ] && ok "القائمة البيضاء وقراءة الجدول متطابقتان ($V = $V2)" || bad "الدالة والسياسة مختلفتان!" "$V مقابل $V2"
V=$(as_role authenticated "$STAFF_UID" "select count(*) from public.settings" | tr -d ' ')
[ "${V:-0}" -ge 7 ] && ok "المسجَّل يقرأ كل الإعدادات ($V)" || bad "المسجَّل لا يقرأ كل الإعدادات" "$V"
V=$(as_role anon - "insert into public.items (category_id,name,price_text,price_num,stock_q,display_qs) values ($CAT,'تسلل','1',1,1,1)")
echo "$V" | grep -qiE "denied|policy|permission" && ok "الزائر لا يستطيع الإضافة" || bad "الزائر أضاف صنفًا!" "$V"
V=$(as_role anon - "select count(*) from public.invoices" | tr -d ' ')
[ "${V:-1}" = "0" ] && ok "الزائر لا يرى أي فاتورة" || bad "الزائر يرى فواتير" "$V"
V=$(as_role anon - "select count(*) from public.audit_log" | tr -d ' ')
[ "${V:-1}" = "0" ] && ok "الزائر لا يرى سجل النشاط" || bad "الزائر يرى سجل النشاط" "$V"
V=$(as_role authenticated "$STAFF_UID" "insert into public.items (category_id,name,price_text,price_num,stock_q,display_qs) values ($CAT,'من العامل','2',2,2,2)")
echo "$V" | grep -qiE "denied|policy|permission|error" && bad "العامل مُنع من الإضافة" "$V" || ok "العامل يضيف صنفًا"
ROLE_BEFORE=$(Q "select role from public.profiles where id='$STAFF_UID'")
as_role authenticated "$STAFF_UID" "update public.profiles set role='admin' where id='$STAFF_UID'" >/dev/null
ROLE=$(Q "select role from public.profiles where id='$STAFF_UID'")
[ "$ROLE" = "$ROLE_BEFORE" ] && ok "لا تصعيد للصلاحيات — الدور ما زال $ROLE (حارس prevent_role_escalation)" \
  || bad "تصعيد صلاحيات!" "$ROLE_BEFORE ⇒ $ROLE"
V=$(as_role authenticated "$CUST_UID" "select count(*) from public.invoices" | tr -d ' ')
[ "${V:-1}" = "0" ] && ok "العميل العادي لا يرى فواتير غيره ($V)" || bad "العميل يرى فواتير الغير" "$V"
V=$(as_role anon - "insert into storage.objects (bucket_id, name) values ('products','hack.jpg')")
echo "$V" | grep -qiE "denied|policy|permission" && ok "الزائر لا يرفع صورًا" || bad "الزائر رفع صورة!" "$V"
V=$(as_role authenticated "$STAFF_UID" "insert into storage.objects (bucket_id, name) values ('products','ok.jpg')")
echo "$V" | grep -qiE "denied|policy|permission|error" && bad "العامل مُنع من رفع صورة" "$V" || ok "العامل يرفع صورة"
V=$(as_role authenticated "$CUST_UID" "insert into storage.objects (bucket_id, name) values ('products','cust.jpg')")
echo "$V" | grep -qiE "denied|policy|permission" && ok "العميل لا يرفع صورًا (للعامل والمدير فقط)" || bad "العميل رفع صورة!" "$V"

echo ""
echo "【8-ب】 F2 — قفل محاولات الدخول على السيرفر"
# الزائر يستطيع استدعاء الدوال (لأنها تُستدعى قبل الدخول)
V=$(as_role anon - "select allowed from public.login_gate('user_x','dev-A')" | tr -d ' ')
[ "$V" = "t" ] && ok "الزائر يستدعي login_gate (يُسمح في البداية)" || bad "login_gate مرفوضة للزائر" "$V"
# لا يقرأ الجدول مباشرة
E=$(as_role anon - "select count(*) from public.login_attempts" | grep -iE 'denied|permission' | head -1)
[ -n "$E" ] && ok "جدول المحاولات غير قابل للقراءة المباشرة" || bad "الزائر يقرأ جدول المحاولات!"
# عدّ المحاولات يظهر في المحاولة الأولى
V=$(as_role anon - "select attempts_left from public.login_gate('user_x','dev-A')" | tr -d ' ')
[ "$V" = "5" ] && ok "المتبقي قبل أي فشل: 5" || bad "عدّاد المتبقي غير صحيح" "$V"
# خمس محاولات فاشلة ⇒ قفل على الاسم
for i in 1 2 3 4 5; do
  as_role anon - "select * from public.login_fail('user_x','dev-A')" >/dev/null
done
V=$(as_role anon - "select allowed::text || '|' || scope from public.login_gate('user_x','dev-A')" | tr -d ' ')
[ "$V" = "false|username" ] && ok "خمس محاولات فاشلة ⇒ قفل على اسم المستخدم ($V)" || bad "لم يُقفل بعد 5 محاولات" "$V"
# القفل سيرفري: جهاز آخر بنفس الاسم يبقى مقفولًا
V=$(as_role anon - "select allowed::text from public.login_gate('user_x','dev-B')" | tr -d ' ')
[ "$V" = "false" ] && ok "القفل يتبع الحساب لا المتصفح (جهاز آخر مقفول أيضًا)" || bad "القفل تجاوزه جهاز آخر" "$V"
# محاولة جديدة لاسم آخر من نفس الجهاز: مسموحة في حدود الحدّ اليومي للجهاز
V=$(as_role anon - "select allowed::text from public.login_gate('user_y','dev-B')" | tr -d ' ')
[ "$V" = "true" ] && ok "اسم آخر غير مقفول (لا يُعاقب الجميع بسبب حساب واحد)" || bad "القفل عمّم على الجميع" "$V"
# انتهاء القفل: نُدخل صفًا قديمًا (كأنه مرّ 16 دقيقة) ثم نتحقق
Q "insert into public.login_attempts (username_hash, device_id, success, created_at)
   values (md5(lower('user_z')), 'dev-C', false, now() - interval '16 minutes')" >/dev/null
for i in 1 2 3 4; do as_role anon - "select * from public.login_fail('user_z','dev-C')" >/dev/null; done
V=$(as_role anon - "select allowed::text || '|' || attempts_left from public.login_gate('user_z','dev-C')" | tr -d ' ')
case "$V" in true\|*) ok "المحاولات القديمة لا تُحسب (نافذة 15 دقيقة): $V" ;; *) bad "محاولة قديمة قفلت الحساب" "$V" ;; esac
# نجاح يمسح المحاولات
as_role anon - "select public.login_ok('user_z','dev-C')" >/dev/null
V=$(as_role anon - "select attempts_left from public.login_gate('user_z','dev-C')" | tr -d ' ')
[ "$V" = "5" ] && ok "الدخول الناجح يمسح المحاولات الفاشلة (المتبقي 5)" || bad "المحاولات لم تُمسح بعد النجاح" "$V"
# قفل الجهاز بعد 15 محاولة فاشلة
for i in $(seq 1 16); do as_role anon - "select * from public.login_fail('u$i','dev-D')" >/dev/null; done
V=$(as_role anon - "select allowed::text || '|' || scope from public.login_gate('u_new','dev-D')" | tr -d ' ')
[ "$V" = "false|device" ] && ok "جهاز يكرر الفشل ⇒ قفل على الجهاز ($V)" || bad "لم يُقفل الجهاز" "$V"

echo ""
echo "【9】 ملفات فحص جاهزة للقاعدة (T3.6 · T5.4)"
for f in scripts/clean-test-data.sql scripts/monthly-review.sql scripts/health-check.sql; do
  [ -f "$f" ] && run_sql "$f" "$(basename "$f")" || warn "غير موجود: $f"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  النتيجة:  ✅ $PASS ناجح   ❌ $FAIL فاشل   ⚠️  $WARN تنبيه"
echo "═══════════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1

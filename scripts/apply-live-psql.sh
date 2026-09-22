#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  تنفيذ إصلاحات الباك اند على قاعدة الإنتاج — اتصال مباشر وآمن
#
#  لماذا هذا الملف: مفتاح `sb_secret_…` (ومفتاح anon) لا ينفّذان SQL —
#  هما مفتاحا PostgREST فقط. تنفيذ DDL يحتاج أحد مسارين:
#     (أ) SQL Editor في اللوحة (لصق يدوي — scripts/apply-backend-all.sql)
#     (ب) اتصال PostgreSQL مباشر بكلمة مرور القاعدة  ← هذا الملف
#
#  المسار المُختبَر فعليًا من هذه البيئة (لا تخمين):
#     المُضيف  : aws-1-eu-west-1.pooler.supabase.com  (وجدناه بمسح مناطق:
#               كل المضيفين الآخرين ردّوا "tenant/user not found"، وهذا وحده
#               ردّ "password authentication failed" ⇒ المشروع هنا)
#     المستخدم : postgres.uzzxhbotbshsgpdnbrmd
#     المنفذ   : 5432 (جلسة) أو 6543 (معاملة)
#     ملاحظة  : المضيف المباشر db.<ref>.supabase.co عناوين IPv6 فقط، وهذه
#               البيئة بلا IPv6 ⇒ الـpooler هو الطريق الوحيد.
#
#  الاستخدام:
#     SUPABASE_DB_PASSWORD='...' bash scripts/apply-live-psql.sh --check
#     SUPABASE_DB_PASSWORD='...' bash scripts/apply-live-psql.sh
#  أو ضع كلمة المرور في ~/.priv/db_password (600) وشغّل بلا متغيّر.
#
#  لا يُطبع كلمة المرور أبدًا. ولا يُكتب أي شيء في السجل يحويها.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

REF="uzzxhbotbshsgpdnbrmd"
HOST="${SUPABASE_POOLER_HOST:-aws-1-eu-west-1.pooler.supabase.com}"
PORT="${SUPABASE_POOLER_PORT:-5432}"
USER_NAME="postgres.$REF"
DBNAME="postgres"
SQL_FILE="${2:-scripts/apply-backend-all.sql}"
LOG="/tmp/apply-live-$(date +%Y%m%d-%H%M%S).log"

PW="${SUPABASE_DB_PASSWORD:-}"
[ -z "$PW" ] && [ -f "$HOME/.priv/db_password" ] && PW="$(cat "$HOME/.priv/db_password")"
if [ -z "$PW" ]; then
  echo "❌ لا كلمة مرور. ضعها في المتغيّر SUPABASE_DB_PASSWORD أو في ~/.priv/db_password"
  echo "   (Supabase → Project Settings → Database → Connection string → كلمة المرور)"
  exit 2
fi

export PGPASSWORD="$PW"
CONN="postgresql://$USER_NAME@$HOST:$PORT/$DBNAME?sslmode=require"
psq() { timeout 60 psql "$CONN" -v ON_ERROR_STOP=1 -tAqc "$1" 2>&1; }

echo "══ 0) فحص الاتصال ══"
VER="$(psq 'select version()')"
case "$VER" in
  PostgreSQL*) echo "  ✅ متصل: $(echo "$VER" | cut -c1-60)";;
  *"password authentication failed"*) echo "  ❌ كلمة المرور غير صحيحة"; exit 3;;
  *) echo "  ❌ تعذّر الاتصال: $(echo "$VER" | head -c 160)"; exit 3;;
esac
echo "  حالة الآن: فواتير=$(psq 'select count(*) from public.invoices') · أصناف=$(psq 'select count(*) from public.items') · إعدادات=$(psq 'select count(*) from public.settings')"
echo "  الدالة invoice_number_health موجودة؟ $(psq "select count(*) from pg_proc where proname='invoice_number_health'")"

if [ "${1:-}" = "--check" ]; then
  echo; echo "✅ الاتصال وكلمة المرور يعملان — أعد التشغيل بلا --check لتنفيذ الإصلاحات."
  exit 0
fi

if [ ! -f "$SQL_FILE" ]; then echo "❌ لم أجد ملف SQL: $SQL_FILE"; exit 4; fi

echo
echo "══ 1) تنفيذ $(basename "$SQL_FILE") ($(wc -l < "$SQL_FILE") سطرًا) ══"
echo "  ⚠️  لا حذف بيانات · لا تغيير أدوار · آمن الإعادة (اختُبر بتشغيله مرتين)"
timeout 300 psql "$CONN" -v ON_ERROR_STOP=1 -f "$SQL_FILE" > "$LOG" 2>&1
RC=$?
echo "  رمز الخروج: $RC · السجل: $LOG"
if [ $RC -ne 0 ]; then
  echo "  ❌ توقّف التنفيذ — آخر 15 سطرًا:"
  tail -15 "$LOG" | sed 's/^/     /'
  exit 5
fi
echo "  ✅ نُفِّذ بلا أخطاء. التقرير النهائي من الملف:"
grep -E "✅|⚠️|❌" "$LOG" | tail -12 | sed 's/^/     /'

echo
echo "══ 2) التحقق من جهة الزائر (مفتاح anon العام — نفس ما يراه أي زائر) ══"
bash scripts/verify-live-visitor.sh

echo
echo "══ 3) ما بعد التنفيذ ══"
echo "  فواتير=$(psq 'select count(*) from public.invoices') · سياسات=$(psq \"select count(*) from pg_policies where schemaname='public'\") · دوال=$(psq \"select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'\")"
echo "  🩺 الفحص الشامل: SUPABASE_DB_PASSWORD='...' psql \"\$CONN\" -f scripts/health-check.sql"

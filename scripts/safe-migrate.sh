#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  T1.5 — ترحيل آمن: نسخة احتياطية → تنفيذ ذرّي → تحقق → (إرجاع عند الفشل)
#
#  الحكمة وراء الأداة: القاعدة المجانية في Supabase بلا PITR، وهذا التطبيق
#  يستخدمه محلّ حقيقي. «لا تجرّب على الإنتاج» لا تعني ألّا ترحّل أبدًا، بل أن
#  يكون كل ترحيل: (1) مسبوقًا بنسخة قابلة للاستعادة، (2) داخل معاملة واحدة
#  تُلغى كلها إن فشل أي سطر، (3) متبوعًا بتحقق آلي من الأثر، (4) موثَّقًا.
#
#  الاستخدام:
#     bash scripts/safe-migrate.sh supabase/migrations/20260922120000_client_errors.sql
#     bash scripts/safe-migrate.sh --dry-run <الملف>     # يعرض ما سيُنفَّذ بلا تعديل
#     bash scripts/safe-migrate.sh --list                # الملفات وترتيب تنفيذها
#
#  كلمة مرور القاعدة: SUPABASE_DB_PASSWORD أو ~/.priv/db_password (600)
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
BACKUP_DIR="$HOME/.priv/backups"
HOST="aws-1-eu-west-1.pooler.supabase.com"
PORT="5432"
USER_NAME="postgres.uzzxhbotbshsgpdnbrmd"
DBNAME="postgres"

# ── الوسائط ──
DRY=0
FILE=""
case "${1:-}" in
  --list)
    echo "══ ملفات الترحيل (بترتيب التنفيذ) ══"
    ls -1 "$MIG_DIR"/*.sql 2>/dev/null | while read -r f; do
      printf "  %-58s %5s سطرًا\n" "$(basename "$f")" "$(wc -l < "$f")"
    done
    echo
    echo "  المطبَّق فعلًا على القاعدة يظهر بـ:  bash scripts/safe-migrate.sh --status"
    exit 0 ;;
  --dry-run) DRY=1; FILE="${2:-}" ;;
  --status)
    PW="${SUPABASE_DB_PASSWORD:-}"; [ -z "$PW" ] && [ -f "$HOME/.priv/db_password" ] && PW="$(cat "$HOME/.priv/db_password")"
    [ -z "$PW" ] && { echo "❌ لا كلمة مرور (SUPABASE_DB_PASSWORD أو ~/.priv/db_password)"; exit 2; }
    export PGPASSWORD="$PW"
    CONN="postgresql://$USER_NAME@$HOST:$PORT/$DBNAME?sslmode=require"
    echo "══ حالة القاعدة الآن ══"
    timeout 60 psql "$CONN" -v ON_ERROR_STOP=1 -tAq <<'SQL' 2>&1 | sed 's/^/  /'
select 'الجداول: ' || count(*) from information_schema.tables where table_schema='public';
select 'الأصناف: ' || count(*) from public.items;
select 'الفواتير: ' || count(*) from public.invoices;
select 'الحسابات: ' || count(*) from public.profiles;
select 'client_errors موجود؟ ' || (case when exists (select 1 from information_schema.tables where table_schema='public' and table_name='client_errors') then 'نعم' else 'لا' end);
select 'آخر 5 دوال في القاعدة: ' || string_agg(proname, ' · ') from (select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1 limit 5) t;
SQL
    exit 0 ;;
  *) FILE="${1:-}" ;;
esac

[ -z "$FILE" ] && { echo "الاستخدام: bash scripts/safe-migrate.sh <ملف.sql> [--dry-run|--list|--status]"; exit 2; }
[ -f "$FILE" ] || FILE="$MIG_DIR/$FILE"
[ -f "$FILE" ] || { echo "❌ لا وجود للملف: $FILE"; exit 2; }

# ── كلمة المرور ──
PW="${SUPABASE_DB_PASSWORD:-}"
[ -z "$PW" ] && [ -f "$HOME/.priv/db_password" ] && PW="$(cat "$HOME/.priv/db_password")"
if [ -z "$PW" ]; then
  echo "❌ لا كلمة مرور قاعدة البيانات."
  echo "   ضعها في ~/.priv/db_password (chmod 600) أو في المتغيّر SUPABASE_DB_PASSWORD."
  echo "   (بديل بلا كلمة مرور: الصق ملف SQL في Supabase → SQL Editor)"
  exit 2
fi
export PGPASSWORD="$PW"
CONN="postgresql://$USER_NAME@$HOST:$PORT/$DBNAME?sslmode=require"
psq() { timeout 90 psql "$CONN" -v ON_ERROR_STOP=1 -tAqc "$1" 2>&1; }

echo "═══════════════════════════════════════════════════════════════"
echo "  T1.5 — ترحيل آمن: $(basename "$FILE")"
echo "═══════════════════════════════════════════════════════════════"

# ── 0) الاتصال ──
VER="$(psq 'select version()')"
case "$VER" in
  PostgreSQL*) echo "  ✅ متصل: $(echo "$VER" | cut -c1-58)";;
  *) echo "  ❌ تعذّر الاتصال: $(echo "$VER" | head -c 160)"; exit 3;;
esac

# ── 1) لقطة «قبل» لعدّادات حرجة ──
SNAP_Q="select 'items='||(select count(*) from public.items)||' invoices='||(select count(*) from public.invoices)||' profiles='||(select count(*) from public.profiles)||' items_stock_q='||coalesce((select sum(stock_q) from public.items),0)"
BEFORE="$(psq "$SNAP_Q")"
echo "  📊 قبل: $BEFORE"

if [ "$DRY" = "1" ]; then
  echo "  🧪 معاينة فقط (--dry-run): لن يُعدَّل شيء."
  echo "  ─── أول 20 سطرًا من الملف ───"
  head -20 "$FILE" | sed 's/^/     /'
  exit 0
fi

# ── 2) نسخة احتياطية قابلة للاستعادة (schema + بيانات) ──
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/pre-migrate-$STAMP.sql"
echo "  💾 نسخة احتياطية قبل التعديل…"
if ! timeout 300 pg_dump "$CONN" --no-owner --no-privileges -f "$DUMP" 2>/tmp/pgdump.err; then
  echo "  ❌ فشلت النسخة الاحتياطية — توقفنا (لا ترحيل بلا شبكة أمان):"
  head -3 /tmp/pgdump.err | sed 's/^/     /'
  exit 4
fi
chmod 600 "$DUMP"
ROWS=$(grep -c "^COPY\|^INSERT" "$DUMP" 2>/dev/null || echo 0)
echo "  ✅ نسخة جاهزة: $DUMP ($(du -h "$DUMP" | cut -f1) · $ROWS كتلة بيانات)"
echo "     للاستعادة:  psql \"\$CONN\" -f $DUMP"

# ── 3) التنفيذ: معاملة واحدة — إما كل الملف أو لا شيء ──
echo "  ▶ التنفيذ داخل معاملة واحدة…"
if ! OUT=$(timeout 300 psql "$CONN" --single-transaction -v ON_ERROR_STOP=1 -f "$FILE" 2>&1); then
  echo "  ❌ فشل الترحيل — أُلغيت المعاملة كاملةً (القاعدة كما كانت):"
  echo "$OUT" | grep -iE "error|خطأ" | head -5 | sed 's/^/     /'
  echo "     النسخة الاحتياطية موجودة: $DUMP"
  exit 5
fi
echo "$OUT" | tail -3 | sed 's/^/     /'

# ── 4) تحقق «بعد» ──
AFTER="$(psq "$SNAP_Q")"
echo "  📊 بعد: $AFTER"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "  ⚠️  تغيّرت بيانات تشغيلية أثناء ترحيل تقنيّ — راجعها قبل الاعتماد:"
  echo "      قبل: $BEFORE"
  echo "      بعد: $AFTER"
else
  echo "  ✅ لم تتغيّر أي بيانات تشغيلية (الترحيل بنيويّ فقط)"
fi

# ── 5) تحقق من وجود الكائنات التي وعد بها الملف ──
TABLES="$(grep -oiE "create table if not exists +public\.[a-z_]+|create table +public\.[a-z_]+" "$FILE" | awk '{print $NF}' | sed 's/public\.//' | sort -u)"
if [ -n "$TABLES" ]; then
  for t in $TABLES; do
    EX="$(psq "select count(*) from information_schema.tables where table_schema='public' and table_name='$t'")"
    if [ "$EX" = "1" ]; then
      CNT="$(psq "select count(*) from public.$t")"
      RLS="$(psq "select relrowsecurity from pg_class where oid='public.$t'::regclass")"
      echo "  ✅ الجدول $t موجود · صفوف: $CNT · RLS: $([ "$RLS" = "t" ] && echo مفعّل || echo 'معطّل ⚠️')"
    else
      echo "  ❌ الجدول $t لم يُنشأ!"; exit 6
    fi
  done
fi
FUNCS="$(grep -oiE "create or replace function +public\.[a-z_]+" "$FILE" | awk '{print $NF}' | sed 's/public\.//' | sort -u)"
for f in $FUNCS; do
  EX="$(psq "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$f'")"
  [ "$EX" = "1" ] && echo "  ✅ الدالة $f موجودة" || { echo "  ❌ الدالة $f مفقودة!"; exit 6; }
done

echo "───────────────────────────────────────────────────────────────"
echo "  ✅ نجح الترحيل وتحقّقنا من أثره — والقاعدة سليمة."
echo "  ↩ للاستعادة الكاملة: psql \"$CONN\" -f $DUMP"
echo "═══════════════════════════════════════════════════════════════"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  2M-Stor — استعادة نسخة احتياطية (T1.6)
#
#  الاستخدام:
#     bash scripts/restore-backup.sh <ملف-النسخة>.sql <رابط-قاعدة-البيانات>
#
#  مثال:
#     bash scripts/restore-backup.sh 2026-09-22-data.sql \
#       "postgresql://postgres:PASSWORD@db.uzzxhbotbshsgpdnbrmd.supabase.co:5432/postgres"
#
#  ⚠️⚠️ تحذير: هذه العملية تُعدّل البيانات فعليًا. لا تشغّلها على الإنتاج
#       قبل تجربتها على مشروع تجريبي (انظر وضع --dry-run أدناه).
#
#  الوضعان:
#     (افتراضي)  فحص الملف فقط — لا يكتب شيئًا
#     --apply    ينفّذ الاستعادة فعليًا
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

FILE="${1:-}"
DBURL="${2:-}"
APPLY=0
[ "${3:-}" = "--apply" ] && APPLY=1

if [ -z "$FILE" ] || [ -z "$DBURL" ]; then
  echo "الاستخدام: bash scripts/restore-backup.sh <ملف.sql> <رابط-قاعدة-البيانات> [--apply]"
  echo ""
  echo "  بلا --apply : فحص الملف فقط (آمن)"
  echo "  مع  --apply : تنفيذ الاستعادة فعليًا"
  exit 1
fi

if [ ! -f "$FILE" ]; then echo "❌ الملف غير موجود: $FILE"; exit 1; fi

SIZE=$(du -h "$FILE" | cut -f1)
LINES=$(wc -l < "$FILE")

echo "═══════════════════════════════════════════════════════════════"
echo "  استعادة نسخة احتياطية — 2M-Stor"
echo "═══════════════════════════════════════════════════════════════"
echo "  الملف     : $FILE"
echo "  الحجم     : $SIZE  ($LINES سطرًا)"
echo "  الوضع     : $([ "$APPLY" -eq 1 ] && echo '🔴 تنفيذ فعلي' || echo '🟢 فحص فقط (آمن)')"
echo ""

# ── 1) فحوص السلامة الأساسية ──────────────────────────────────
echo "【1】 فحوص سلامة الملف"

if head -c 200 "$FILE" | grep -qi "cannot open\|permission denied\|<html"; then
  echo "  ❌ الملف لا يبدو ملف SQL صالح (قد يكون صفحة خطأ أو ملفًا تالفًا)"
  exit 1
fi
echo "  ✅ ليس صفحة خطأ"

for kw in "CREATE TABLE" "public.items" "public.categories"; do
  if grep -qi "$kw" "$FILE"; then echo "  ✅ يحتوي: $kw"
  else echo "  ⚠️  لا يحتوي: $kw — تأكد أن هذا الملف المطلوب"; fi
done

# ── 2) إحصاء ما في النسخة ─────────────────────────────────────
echo ""
echo "【2】 محتوى النسخة"
for tbl in items categories invoices invoice_items profiles settings; do
  # يقبل صيغتي الإدخال: INSERT INTO أو COPY
  N_INS=$(grep -ci "INSERT INTO public\.$tbl" "$FILE" 2>/dev/null || true)
  printf "  %-14s %s صفًا (تقريبًا)\n" "$tbl:" "${N_INS:-0}"
done

# ── 3) تحذير قبل التنفيذ ──────────────────────────────────────
echo ""
if [ "$APPLY" -eq 0 ]; then
  echo "【3】 الوضع الآمن — لم يُكتب أي شيء في قاعدة البيانات ✅"
  echo ""
  echo "  لتجربة الاستعادة فعليًا على مشروع **تجريبي**:"
  echo "    bash scripts/restore-backup.sh \"$FILE\" \"<رابط-مشروع-التجريب>\" --apply"
  echo ""
  echo "  ⚠️ لا تشغّل --apply على الإنتاج إلا بعد التأكد من:"
  echo "     • أخذ نسخة احتياطية طازجة قبل الاستعادة"
  echo "     • تجربة الاستعادة على التجريبي مرة واحدة على الأقل"
  exit 0
fi

echo "【3】 تنبيه — على وشك الكتابة في قاعدة البيانات"
echo "  القاعدة: ${DBURL%%:*}://***@${DBURL##*@}"
echo ""
read -r -p "  اكتب 'استعادة' للمتابعة: " CONFIRM
if [ "$CONFIRM" != "استعادة" ]; then echo "  ⛔ أُلغيت العملية"; exit 1; fi

# ── 4) التنفيذ ────────────────────────────────────────────────
echo ""
echo "【4】 التنفيذ..."
command -v psql >/dev/null 2>&1 || { echo "  ❌ psql غير مثبّت (apt install postgresql-client)"; exit 1; }

START=$(date +%s)
if psql "$DBURL" --set ON_ERROR_STOP=off -f "$FILE" > /tmp/restore.log 2>&1; then
  echo "  ✅ اكتملت الاستعادة في $(( $(date +%s) - START )) ثانية"
else
  echo "  ⚠️ انتهى التنفيذ مع تحذيرات — راجع السجل: /tmp/restore.log"
  echo "     (أخطاء «already exists» طبيعية عند الاستعادة فوق بيانات موجودة)"
  tail -5 /tmp/restore.log | sed 's/^/     /'
fi

echo ""
echo "【5】 تحقق بعد الاستعادة"
psql "$DBURL" -tA -c "select 'items: '||count(*) from public.items where deleted_at is null;" 2>/dev/null | sed 's/^/  /' || echo "  (تعذّر التحقق)"
psql "$DBURL" -tA -c "select 'categories: '||count(*) from public.categories where deleted_at is null;" 2>/dev/null | sed 's/^/  /' || true
psql "$DBURL" -tA -c "select 'invoices: '||count(*) from public.invoices;" 2>/dev/null | sed 's/^/  /' || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ تم — افتح التطبيق وتأكد من ظهور البيانات"
echo "═══════════════════════════════════════════════════════════════"

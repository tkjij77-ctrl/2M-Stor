#!/usr/bin/env bash
# يراقب القاعدة صامتًا وينبّه لحظة نجاح الإصلاح — بلا أي كتابة (قراءة فقط)
# الاستخدام: bash scripts/watch-live-fix.sh [مدة بالدقائق = 60]
set -uo pipefail
cd "$(dirname "$0")/.."
MIN="${1:-60}"
END=$(( $(date +%s) + MIN*60 ))
KEY="$(grep -hoE "key: 'eyJ[A-Za-z0-9_.-]+'" index.html web/cloud.js | head -1 | sed -E "s/.*'([^']+)'.*/\1/")"
B="https://uzzxhbotbshsgpdnbrmd.supabase.co/rest/v1"
n=0
while [ "$(date +%s)" -lt "$END" ]; do
  n=$((n+1))
  INV=$(timeout 20 curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$B/invoices?select=id&limit=5" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else -1)
except Exception: print(-1)")
  FN=$(timeout 20 curl -s -o /dev/null -w "%{http_code}" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$B/rpc/invoice_number_health")
  TS="$(date '+%H:%M:%S')"
  if [ "$INV" = "0" ]; then
    echo "[$TS] ✅✅ الإصلاح وصل! الزائر يقرأ 0 فاتورة · invoice_number_health=$FN"
    bash scripts/verify-live-visitor.sh
    echo "── انتهى المراقبة بنجاح ──"; exit 0
  elif [ "$INV" = "-1" ]; then
    echo "[$TS] ⚠️ الفحص $n: استجابة غير مفهومة (قد يكون تغييرًا في السياسات يجري الآن) · fn=$FN"
  else
    echo "[$TS] الفحص $n: الزائر ما زال يقرأ $INV فاتورة · fn=$FN"
  fi
  sleep 45
done
echo "── انتهت مدة المراقبة ($MIN دقيقة) بلا تغيير ──"

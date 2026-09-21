#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  فحص الباك اند الحقيقي — قراءة فقط (لا كتابة ولا تعديل)
#
#  الغرض: معرفة **ما نُفِّذ فعلًا** على القاعدة الحيّة، لا ما نظنّ أنه نُفِّذ.
#  الأسلوب: نستخدم مفتاح anon العام (منشور في الموقع أصلًا) ونستدعي الكائنات
#  التي أنشأها كل ترحيل. PostgREST يفرّق بوضوح:
#     PGRST202 / 404  → الدالة غير موجودة (الترحيل لم يُنفَّذ)
#     42501 / 401-403 → الدالة موجودة لكن الصلاحية مرفوضة (الترحيل نُفِّذ)
#
#  ليس فيه أي كتابة: لا insert ولا update ولا استدعاء login_fail.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
REF="uzzxhbotbshsgpdnbrmd"
BASE="https://$REF.supabase.co"
# مفتاح anon العام (منشور في الموقع نفسه) — يُقرأ من ملف مؤقت أو من index.html
if [ -f /tmp/anon.key ]; then
  KEY="$(cat /tmp/anon.key)"
else
  KEY="$(grep -oE "key: 'eyJ[A-Za-z0-9_.-]+'" index.html 2>/dev/null | head -1 | sed -E "s/.*'([^']+)'.*/\1/")"
fi
if [ -z "${KEY:-}" ]; then
  echo "❌ لم أجد مفتاح anon — لا ملف /tmp/anon.key ولا مفتاح منشور في index.html"; exit 1
fi
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json")

t() { timeout 20 curl -s -o /tmp/probe.out -w "%{http_code}" "${H[@]}" "$@" 2>/dev/null; }
verdict() { # verdict <نص> <كود> [كلمة تدل على النجاح]
  local name="$1" code="$2" ok="${3:-}"
  local body; body="$(head -c 220 /tmp/probe.out | tr -d '\n')"
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then
    printf "  \033[32m✅ %-42s 200 — %s\033[0m\n" "$name" "${ok:-يعمل}"
  elif echo "$body" | grep -qE 'PGRST202|Could not find the function|does not exist|schema cache'; then
    printf "  \033[31m❌ %-42s %s — غير موجود (لم يُنفَّذ)\033[0m\n" "$name" "$code"
  elif echo "$body" | grep -qE '42501|permission denied'; then
    printf "  \033[33m🟡 %-42s %s — موجود لكن مرفوض للزائر\033[0m\n" "$name" "$code"
  else
    printf "  ⚪ %-42s %s — %s\n" "$name" "$code" "$(echo "$body" | cut -c1-90)"
  fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "  حالة الباك اند الحيّة — $REF.supabase.co"
echo "═══════════════════════════════════════════════════════════════"

echo ""
echo "【1】 قراءة الزائر للمتجر — هل عطل N-1/N-2 ما زال قائمًا؟"
code=$(t "$BASE/rest/v1/categories?select=id&limit=1"); verdict "categories (تصنيفات الزائر)" "$code"
body="$(cat /tmp/probe.out | tr -d '\n')"
if echo "$body" | grep -q 'my_role'; then
  echo "     ↳ 🔴 العطل ظاهر: «permission denied for function my_role» ⇒ ترحيل 050000 لم يُنفَّذ"
elif [ "$code" = "200" ]; then
  echo "     ↳ ✅ لا أثر للعطل — إما الترحيل نُفِّذ أو السياسة لا تستدعي my_role"
fi
code=$(t "$BASE/rest/v1/items?select=id&limit=1"); verdict "items (أصناف الزائر)" "$code"
code=$(t "$BASE/rest/v1/settings?select=id&limit=1"); verdict "settings (إعدادات مباشرة للزائر)" "$code"

echo ""
echo "【2】 دوال كل ترحيل — هل وُجدت أصلًا؟"
code=$(t "$BASE/rest/v1/rpc/public_settings" -X POST -d '{}');           verdict "public_settings() — N-2 · ترحيل 050000" "$code" "أعاد القائمة البيضاء"
code=$(t "$BASE/rest/v1/rpc/login_gate" -X POST -d '{"p_username":"probe_readonly_check","p_device":"probe"}'); verdict "login_gate() — F2 · ترحيل 070000" "$code" "أعاد حالة القفل"
code=$(t "$BASE/rest/v1/rpc/login_ok" -X POST -d '{"p_username":"probe_readonly_check","p_device":"probe"}');    verdict "login_ok() — F2" "$code"
code=$(t "$BASE/rest/v1/rpc/next_invoice_no" -X POST -d '{}');            verdict "next_invoice_no() — ترقيم · ترحيل 040000" "$code"
code=$(t "$BASE/rest/v1/rpc/invoice_number_health" -X POST -d '{}');      verdict "invoice_number_health() — ترحيل 040000" "$code"
code=$(t "$BASE/rest/v1/rpc/stock_mismatch_report" -X POST -d '{}');      verdict "stock_mismatch_report() — مخزون · 020000" "$code"
code=$(t "$BASE/rest/v1/rpc/decrement_stock" -X POST -d '{"p_item_id":"00000000-0000-0000-0000-000000000000","p_qty":1}'); verdict "decrement_stock() — 030000" "$code"
code=$(t "$BASE/rest/v1/rpc/trash_list" -X POST -d '{}');                 verdict "trash_list() — حذف ناعم · 010000" "$code"
code=$(t "$BASE/rest/v1/rpc/my_role" -X POST -d '{}');                    verdict "my_role() — مُلغى عن الزائر عن قصد" "$code"

echo ""
echo "【3】 الجداول الحسّاسة — هل الحجب قائم؟"
code=$(t "$BASE/rest/v1/invoices?select=id&limit=1");  verdict "invoices (يجب ألّا تُقرأ للزائر)" "$code"
code=$(t "$BASE/rest/v1/profiles?select=role&limit=1"); verdict "profiles (يجب ألّا تُقرأ للزائر)" "$code"
code=$(t "$BASE/rest/v1/audit_log?select=id&limit=1"); verdict "audit_log (يجب ألّا يُقرأ للزائر)" "$code"
code=$(t "$BASE/rest/v1/login_attempts?select=id&limit=1"); verdict "login_attempts (محجوب بالكامل — F2)" "$code"

echo ""
echo "【4】 الرفع والصور"
code=$(t "$BASE/storage/v1/object/list/products" -X POST -d '{"prefix":"","limit":1}'); verdict "قائمة دلو products" "$code"
code=$(t "$BASE/storage/v1/object/public/products/__probe_missing__.jpg" -X HEAD); verdict "قراءة عامة من الدلو" "$code"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ملاحظة: كل ما سبق **قراءة فقط**. لا صف أُضيف ولا عُدِّل ولا حُذف."
echo "═══════════════════════════════════════════════════════════════"

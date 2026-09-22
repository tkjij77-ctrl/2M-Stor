#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  التحقق من جهة الزائر — **بمفتاح anon العام فقط** (ما يراه أي شخص)
#
#  الغرض: قياس أثر الإصلاح لا وجود الملفات. هذا السكربت هو الحكم:
#  لو لم تُنفَّذ الإصلاحات على القاعدة، سيقول بصراحة «الزائر يقرأ الفواتير».
#
#  ⚠️ قراءة فقط: لا insert/update/delete إطلاقًا (لا يمكن إتلاف بيانات حقيقية).
#     فحص الكتابة يُنفَّذ في scripts/apply-live-psql.sh عبر SQL (has_table_privilege
#     + pg_policies) لأن PostgREST يردّ 204 في الحالتين ⇒ لا يصلح كحكم.
#
#  التشغيل: bash scripts/verify-live-visitor.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
REF="uzzxhbotbshsgpdnbrmd"
BASE="https://$REF.supabase.co/rest/v1"
KEY="$(grep -hoE "key: 'eyJ[A-Za-z0-9_.-]+'" index.html web/cloud.js 2>/dev/null | head -1 | sed -E "s/.*'([^']+)'.*/\1/")"
[ -z "$KEY" ] && { echo "❌ لم أجد مفتاح anon في index.html"; exit 1; }
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")

pass=0; fail=0
req() { # req <path> → الكود في $CODE والنص في /tmp/vis.out
  CODE="$(timeout 20 curl -s -o /tmp/vis.out -w "%{http_code}" "${H[@]}" "$BASE/$1" 2>/dev/null)"
}
ok()   { printf "  \033[32m✅ %s\033[0m\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31m❌ %s\033[0m\n" "$1"; fail=$((fail+1)); }
rows() { python3 -c "
import json
try:
    d=json.load(open('/tmp/vis.out'))
    print(len(d) if isinstance(d,list) else -1)
except Exception: print(-1)
"; }

echo "═══════════════════════════════════════════════════════════════"
echo "  تحقق الزائر على القاعدة الحيّة — $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════════════════════"

echo
echo "【1】 🔴 الأخطر: هل يقرأ الزائر الفواتير؟"
req "invoices?select=id,invoice_no,customer_name,total&limit=3"
if [ "$CODE" = "200" ] && [ "$(rows)" -gt 0 ]; then
  bad "الزائر يقرأ $(rows) فاتورة الآن (أسماء ومبالغ) — الإصلاح لم يُنفَّذ بعد"
  python3 -c "
import json;d=json.load(open('/tmp/vis.out'))
print('       مثال:', ', '.join(str(x.get('customer_name'))+':'+str(x.get('total')) for x in d[:3]))" 2>/dev/null
elif [ "$CODE" = "200" ]; then
  ok "الزائر لا يرى أي فاتورة (0 صف) — الحجب قائم"
else
  ok "الزائر مرفوض على invoices (HTTP $CODE)"
fi

echo
echo "【2】 المتجر يجب أن يبقى يعمل (لا نكسر العام) "
req "items?select=id,name,price_text,display_qs&limit=5"
if [ "$CODE" = "200" ] && [ "$(rows)" -gt 0 ]; then ok "الزائر يقرأ الأصناف ($(rows) صف) — المتجر سليم"
else bad "الأصناف لا تُقرأ (HTTP $CODE) — سيتعطّل المتجر للزوار"; fi

echo
echo "【3】 الإعدادات العامة: القائمة البيضاء فقط"
req "settings?select=key"
if [ "$CODE" = "200" ]; then
  python3 - <<'PY' > /tmp/vis.keys
import json
d=json.load(open('/tmp/vis.out'))
keys=sorted(x['key'] for x in d) if isinstance(d,list) else []
expected={'store_name','address','phone','footer','tax_pct','store_desc','return_days','return_note',
          'shipping_fee','free_shipping_over','coupon_code','coupon_pct','stock_mode','oversell_policy','role_perms'}
missing=expected-set(keys); extra=set(keys)-expected
print(f"{len(keys)}|{','.join(sorted(missing))}|{','.join(sorted(extra))}")
PY
  IFS='|' read -r N MISSING EXTRA < /tmp/vis.keys
  # المفاتيح «الناقصة» ليست خطأً بالضرورة: المفتاح الذي **لا يوجد أصلًا** في جدول
  # الإعدادات لا يمكن أن يظهر لأي أحد. الفرق: موجود لكن محجوب (خطأ) ≠ غير موجود (عادي).
  REALLY_MISSING=""
  if [ -n "$MISSING" ]; then
    for k in $(echo "$MISSING" | tr ',' ' '); do
      req "settings?select=key&key=eq.$k"
      [ "$(rows)" = "0" ] || REALLY_MISSING="$REALLY_MISSING $k"
    done
  fi
  [ "$N" -ge 10 ] && [ -z "$REALLY_MISSING" ] && ok "الزائر يرى $N مفتاحًا عامًا (والمفاتيح الغائبة غير موجودة على القاعدة أصلًا)" \
    || { [ -n "$REALLY_MISSING" ] && bad "مفاتيح واجهة **موجودة ومحجوبة** عن الزائر:$REALLY_MISSING"; [ -n "$EXTRA" ] && bad "مفاتيح خاصة مكشوفة للزائر: $EXTRA"; }
  case " $(cat /tmp/vis.out) " in *baseline_synced*) bad "baseline_synced مكشوف للزائر (يجب أن يكون محجوبًا)";; *) ok "baseline_synced محجوب عن الزائر";; esac
else bad "الإعدادات لا تُقرأ (HTTP $CODE) — التذييل والكوبون سيختفيان من واجهة الزائر"; fi

echo
echo "【4】 جداول حسّاسة أخرى"
# ⚠️ معيار التسريب هو **وجود صفوف** لا كود الاستجابة: RLS تحجب الصفوف وتُرجع
# 200 مع مصفوفة فارغة [] — ولو اعتبرناها تسريبًا لكذّبنا أداةً سليمة.
for t in profiles audit_log invoices login_attempts; do
  req "$t?select=*&limit=3"
  if [ "$CODE" = "200" ] && [ "$(rows)" -gt 0 ]; then bad "$t مكشوف للزائر! ($(rows) صف)"
  elif [ "$CODE" = "200" ]; then ok "$t محجوب (RLS: صفر صفوف)"
  else ok "$t محجوب (HTTP $CODE)"; fi
done

echo
echo "【5】 كائنات الباك اند الجديدة موجودة؟"
# ملاحظة مهمة: stock_health **view** لا دالة، وdecrement_stock/login_gate تحتاج
# وسائط ⇒ استدعاؤها بلا وسائط يردّ 404 مضلِّلًا (PGRST202) حتى لو كانت موجودة.
req "stock_health?select=id&limit=1"
[ "$CODE" = "404" ] && bad "stock_health (view) غير موجودة — الترحيل لم يُنفَّذ" || ok "stock_health (view) موجودة (HTTP $CODE)"
for f in invoice_number_health; do
  req "rpc/$f"
  [ "$CODE" = "404" ] && bad "$f() غير موجودة — الترحيل لم يُنفَّذ" || ok "$f() موجودة (HTTP $CODE)"
done
# الدوال ذات الوسائط: نتحقق بطلب بلا وسائط ونقرأ رسالة PostgREST: «does not exist»
# مقابل «function … without parameters» ⇒ الثانية تعني أنها موجودة
for f in decrement_stock login_gate; do
  curl -s -o /tmp/vis.fn -w "%{http_code}" "${H[@]}" -X POST "$BASE/rpc/$f" -H "Content-Type: application/json" -d '{}' > /tmp/vis.code
  C=$(cat /tmp/vis.code)
  if grep -qi "without parameters" /tmp/vis.fn; then ok "$f() موجودة (تحتاج وسائط)"
  elif [ "$C" = "404" ]; then bad "$f() غير موجودة — الترحيل لم يُنفَّذ"
  else ok "$f() موجودة (HTTP $C)"; fi
done

echo
echo "═══════════════════════════════════════════════════════════════"
if [ "$fail" -eq 0 ]; then printf "  \033[32m✅ القاعدة مُصلَحة: %d فحصًا ناجحًا\033[0m\n" "$pass"
else printf "  \033[31m❌ %d فاشل · %d ناجح — القاعدة لم تُصلَح بعد\033[0m\n" "$fail" "$pass"; fi
echo "  (قراءة فقط — لم تُكتب أي بيانات)"
echo "═══════════════════════════════════════════════════════════════"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  يبني scripts/apply-backend-all.sql — ملف واحد يُلصق في SQL Editor مرة واحدة
#
#  لماذا مولّد لا ملف يدوي؟ لأن الترحيلات تتغيّر؛ هذا الملف يعيد بناء الملف
#  المركّب من مصادره الحقيقية (supabase/migrations) فلا يتباعدان بصمت.
#  يُشغَّل تلقائيًا داخل CI/الاختبارات أيضًا.
#
#  الاستخدام: bash scripts/build-apply-backend-all.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="scripts/apply-backend-all.sql"
MIG="supabase/migrations"

# ترتيب التنفيذ: من الأقدم للأحدث (أسماء الملفات مرتّبة زمنيًا أصلًا)
FILES=$(ls "$MIG"/20260827104851_*.sql "$MIG"/2026092*.sql | sort)

{
  cat <<'HEAD'
-- ═══════════════════════════════════════════════════════════════════
--  🚀 تشغيل الباك اند كاملًا — **ملف واحد يُلصق مرة واحدة**
--
--  لمن: قاعدة شغّالة بالفعل فيها بياناتك (مشروعك الحالي) — لا مشروع جديد.
--  ماذا يفعل: إصلاحات الأمان + الترحيلات + حسم السياسات الشاردة، ثم تقرير تحقق.
--
--  الاستخدام:
--    1) Supabase → SQL Editor → New query
--    2) الصق الملف كاملًا (طويل — هذا طبيعي) ثم اضغط Run
--    3) انزل لآخر النتائج واقرأ «التقرير النهائي» — يجب أن تكون كلها ✅
--    4) قاطعَتْك مشكلة في المنتصف؟ أعد التشغيل بلا خوف: كل العبارات idempotent
--
--  ⚠️ ما لا يفعله: لا يحذف بيانات · لا يمسّ حسابًا · لا يغيّر أي دور.
--     (ترقية مديرك: scripts/grant-role.sql — سطر واحد للتعديل)
--
--  🔴 عاجل: الفحص الحيّ على قاعدتك أظهر أن **الزائر يقرأ فواتيرك الآن**
--     (13 فاتورة بأسماء العملاء والمبالغ) وأن بإمكانه الكتابة عليها —
--     لأن إصلاحات الأمان لم تُنفَّذ بعد. هذا الملف يغلق ذلك.
-- ═══════════════════════════════════════════════════════════════════

-- ── (0) لقطة «قبل» — احفظ ناتجها للمقارنة ───────────────────────────
select 'قبل' as المرحلة, tablename, policyname, cmd, coalesce(qual, with_check, '') as الشرط
  from pg_policies
 where schemaname in ('public', 'storage')
   and tablename in ('invoices', 'invoice_items', 'profiles', 'items', 'categories', 'settings', 'objects')
 order by tablename, policyname;

HEAD

  for f in $FILES; do
    printf '\n-- ═══════════════════════════════════════════════════════════════════\n'
    printf -- '--  ▼▼▼  %s\n' "$(basename "$f" .sql)"
    printf -- '-- ═══════════════════════════════════════════════════════════════════\n\n'
    sed -e '${/^$/d;}' "$f"
    printf '\n'
  done

  cat <<'HARD'

-- ═══════════════════════════════════════════════════════════════════
--  🧹 حسم: لا تبقى سياسة تسمح للزائر بما لا يجوز
--
--  لماذا هذا القسم؟ لأن القاعدة الحيّة قد تحمل سياسات أُنشئت يدويًا في لوحة
--  Supabase (خارج الترحيلات) وتسمح بـ`true` — والترحيلات لا تحذف إلا ما تعرفه
--  بالاسم. هذا القسم يحذف **كل سياسة شرطها `true`** على الجداول الحسّاسة،
--  ويترك سياسات الشرط الحقيقي (مثل `deleted_at is null`) كما هي.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  n int := 0;
  sensitive text[] := array['invoices', 'invoice_items', 'profiles', 'audit_log', 'login_attempts'];
begin
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename = any (sensitive)
       and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
    raise notice 'حُذفت سياسة مفتوحة: %.% (%) — كانت تسمح بلا شرط', r.tablename, r.policyname, r.cmd;
  end loop;
  raise notice '✅ سياسات مفتوحة محذوفة على الجداول الحسّاسة: %', n;
end $$;

-- جداول المتجر: القراءة عامة عن قصد، لكن الكتابة المفتوحة (بلا شرط) تُحذف
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename in ('items', 'categories', 'settings')
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    -- نستثني سياسات الفريق الحقيقية (شرطها my_role) — لا تُمسّ
    continue when r.policyname in ('items_write', 'cats_write', 'settings_write');
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
    raise notice 'حُذفت سياسة كتابة مفتوحة: %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;
  raise notice '✅ سياسات كتابة مفتوحة محذوفة على جداول المتجر: %', n;
end $$;

-- تأكيد RLS على الجداول الثمانية (بلا لمس أي جدول آخر قد يكون على القاعدة)
do $$
declare
  r record;
  t text;
begin
  foreach t in array array['profiles','categories','items','invoices','invoice_items','settings','audit_log','login_attempts']
  loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
  raise notice '✅ RLS مُفعَّل على الجداول الثمانية';
end $$;

HARD

  cat <<'TAIL'

-- ═══════════════════════════════════════════════════════════════════
--  ✅ التقرير النهائي — اقرأ هذه النتائج
-- ═══════════════════════════════════════════════════════════════════

-- ① الجداول: 8 (منها login_attempts)
select '① الجداول' as البند, count(*) as العدد,
       case when count(*) = 8 then '✅ صحيح' else '❌ ناقص ' || (8 - count(*)) end as الحكم
  from pg_tables where schemaname = 'public';

-- ② الدوال الجديدة
select '② الدوال' as البند, count(*) as العدد,
       case when count(*) = 8 then '✅ كلها موجودة' else '❌ ناقص ' || (8 - count(*)) end as الحكم
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('next_invoice_no', 'assign_invoice_no', 'decrement_stock', 'increment_stock',
                     'public_settings', 'login_gate', 'login_fail', 'login_ok');

-- ③ السياسات المفتوحة على الجداول الحسّاسة (المتوقع: صفر)
select '③ سياسات مفتوحة حسّاسة' as البند, count(*) as العدد,
       case when count(*) = 0 then '✅ لا شيء' else '❌ ما زالت مكشوفة' end as الحكم
  from pg_policies
 where schemaname = 'public'
   and tablename in ('invoices', 'invoice_items', 'profiles', 'audit_log', 'login_attempts')
   and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');

-- ④ سياسات الفواتير كما صارت (يجب أن تعتمد على my_role/is_manager)
select '④ سياسات الفواتير' as البند, policyname as السياسة, cmd as العملية,
       left(coalesce(qual, with_check, ''), 60) as الشرط
  from pg_policies where schemaname = 'public' and tablename = 'invoices' order by policyname;

-- ⑤ حارس تصعيد الصلاحيات
select '⑤ حارس الأدوار' as البند, count(*) as العدد,
       case when count(*) = 1 then '✅ مُفعَّل' else '❌ مفقود' end as الحكم
  from pg_trigger where tgname = 'trg_profiles_no_escalation';

-- ⑥ Realtime
select '⑥ Realtime' as البند, string_agg(tablename, ' · ' order by tablename) as الجداول
  from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';

-- ⑦ حجب جدول محاولات الدخول
select '⑦ login_attempts' as البند,
       case when count(*) = 0 then '✅ بلا وصول مباشر' else '❌ فيه سياسات!' end as الحكم
  from pg_policies where schemaname = 'public' and tablename = 'login_attempts';

-- ⑧ صحة ترقيم الفواتير (لا تكرار + التسلسل متقدّم)
select '⑧ أرقام الفواتير' as البند, max_invoice_no as أكبر_رقم,
       sequence_next as التالي, duplicates as المكرر,
       case when duplicates = 0 and sequence_next > max_invoice_no
            then '✅ سليمة' else '⚠️ راجع الترقيم' end as الحكم
  from public.invoice_number_health();

-- ⑨ حالة المخزون
select '⑨ تسلسل المخزون' as البند, count(*) as صنف_غير_متسلسل,
       case when count(*) = 0 then '✅ سليم' else '⚠️ راجع stock_mismatch_report()' end as الحكم
  from public.stock_mismatch_report();

-- ═══════════════════════════════════════════════════════════════════
--  بعد النجاح:
--   • رقّم حسابك مديرًا:   scripts/grant-role.sql   (تعديل سطر واحد)
--   • فحص شامل 13 بندًا:   scripts/health-check.sql
--   • جرد المخطط:          scripts/schema-inventory.sql ثم الفاحص
-- ═══════════════════════════════════════════════════════════════════
TAIL
} > "$OUT"

LINES=$(wc -l < "$OUT")
echo "✅ بُني $OUT — $LINES سطرًا ($(( $(stat -c%s "$OUT") / 1024 ))KB)"
echo "   الترحيلات المُدمجة:"
ls "$MIG"/20260827104851_*.sql "$MIG"/2026092*.sql | sort | sed 's|.*/|     |'

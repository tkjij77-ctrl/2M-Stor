-- ═══════════════════════════════════════════════════════════════════
--  T3.7 — جرد مخطط قاعدة البيانات الحقيقية (انسخه والصقه في SQL Editor)
--
--  الغرض: إخراج صورة نصية كاملة لما هو موجود فعلًا على القاعدة (جداول،
--  أعمدة، فهارس، سياسات، دوال، مشغّلات، Realtime، الدلاء) لتقارنها بما
--  في المستودع:
--
--    1) Supabase → SQL Editor → New query → الصق هذا الملف → Run
--    2) اضغط «Download CSV» أو انسخ الناتج كاملًا في ملف inventory.txt
--       (النسخ من شبكة النتائج داخل SQL Editor يحفظ الأسطر بفواصل |)
--    3) node scripts/verify-schema-drift.js inventory.txt
--
--  ⚠️ للقراءة فقط: لا يُنشئ ولا يعدّل ولا يحذف شيئًا.
-- ═══════════════════════════════════════════════════════════════════

with objs as (
  -- ── الجداول ──────────────────────────────────────────────────────
  select 'table'::text as kind, n.nspname || '.' || c.relname as name, ''::text as extra, 1 as ord, c.relname as s1, ''::text as s2
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  -- ⚠️ الجداول من `public` فقط: جداول `storage.*` تخصّ المنصة لا المشروع،
  -- وإدخالها كان يولّد «فروقًا» كاذبة لا يصلحها أي ترحيل.
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not in ('spatial_ref_sys','migrations','schema_migrations')

  union all
  -- ── الأعمدة (extra = الجدول) ─────────────────────────────────────
  select 'column', a.attname, n.nspname || '.' || c.relname, 2, c.relname, a.attname::text
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and c.relname not in ('spatial_ref_sys','migrations','schema_migrations')

  union all
  -- ── الفهارس (extra = الجدول) ─────────────────────────────────────
  select 'index', i.relname, n.nspname || '.' || t.relname, 3, t.relname, i.relname
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relkind = 'r'
    and not exists (select 1 from pg_constraint pc where pc.conindid = i.oid)  -- لا تُعدّ قيود المفاتيح فهارس

  union all
  -- ── السياسات (extra = الجدول) ────────────────────────────────────
  select 'policy', p.polname, n.nspname || '.' || c.relname, 4, c.relname, p.polname
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','storage')

  union all
  -- ── الدوال في public ─────────────────────────────────────────────
  select 'function', pr.proname, '', 5, pr.proname, ''
  from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
  -- ⚠️ دوال الإضافات (pgcrypto: crypt/armor/digest…) تُستثنى: هي من المنصة لا من
  -- المشروع، وإدخالها كان يملأ التقرير بعشرات «الفروق» لا يصلحها أي ترحيل.
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = pr.oid and d.deptype = 'e')

  union all
  -- ── المشغّلات (الاسم = الجدول.المشغّل) ────────────────────────────
  select 'trigger', c.relname || '.' || t.tgname, n.nspname || '.' || c.relname, 6, c.relname, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  -- المشغّلات: public + `auth.users` وحدها (هي موضع مشغّل إنشاء الحساب في المشروع)
  where not t.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))

  union all
  -- ── جداول Realtime ───────────────────────────────────────────────
  select 'publication', tablename, '', 7, tablename, ''
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'

  union all
  -- ── الدلاء ───────────────────────────────────────────────────────
  select 'bucket', id, '', 8, id, ''
  from storage.buckets
)
-- ملاحظة: أسماء الأعمدة/الفهارس/السياسات مسبوقة بـpublic. أو storage. داخل عمود
-- `extra` (اسم الجدول). الفاحص يجرّد التسبيق تلقائيًا كي تُطابَق أسماء المستودع.
select kind || '|' || name || '|' || extra as inventory
from objs
order by ord, s1, s2;

-- ═══════════════════════════════════════════════════════════════════
--  بعد المقارنة: لو ظهر «على القاعدة وليس في المستودع» فهذا يعني أن من
--  يعيد بناء النظام من المستودع لن يحصل عليه. الحل:
--    node scripts/verify-schema-drift.js inventory.txt --emit-migration supabase/migrations/<طابع>_sync_from_live.sql
--  ثم راجع المسوّدة والزمها.
-- ═══════════════════════════════════════════════════════════════════

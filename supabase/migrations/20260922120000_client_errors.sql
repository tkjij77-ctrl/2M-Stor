-- ═══════════════════════════════════════════════════════════════════════════
--  T5.3 — سجل أخطاء متصفحات المستخدمين (client_errors)
--
--  لماذا: أي عطل في جهاز زبون (شاشة بيضاء، زر لا يعمل، فشل مزامنة) كان يختفي
--  بلا أثر — التطبيق لا يرسل شيئًا، فالعطل لا يُكتشف إلا بشكوى شفهية. هذا الجدول
--  يجعل الأعطال مرئية للمدير (زر «🐞 أخطاء المستخدمين» في لوحة التحكم).
--
--  سياسات الأمان (RLS):
--    • INSERT: أي زائر — لا يمكن التقاط عطل قبل تسجيل الدخول بغير ذلك.
--    • SELECT: المدير فقط (profiles.role = 'admin') — فيه بيانات تشغيل داخلية.
--    • DELETE: المدير فقط (تنظيف السجل القديم).
--    • UPDATE: لا أحد — سجل يُلحق ولا يُعدَّل (سلامة الأدلة).
--
--  ملاحظة تصميمية: الجدول لا يحمل أي كلمة مرور أو مفتاح — الرسالة والمسافة
--  والمتصفح فقط، مع سقف 300 حرف للرسالة في التطبيق نفسه.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.client_errors (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  kind        text        not null default 'js',   -- js | promise | ...
  message     text        not null,
  where_at    text,                                -- الصفحة والدور عند وقوع الخطأ
  url         text,
  build       text,                                -- نسخة التطبيق (لمعرفة أي إصدار تعطّل)
  user_agent  text,
  extra       text,
  repeats     integer     not null default 1       -- كم مرة تكرّر نفس الخطأ في الجلسة
);

comment on table public.client_errors is
  'T5.3 — أخطاء جافاسكربت/الوعود في متصفحات المستخدمين. الإدراج متاح للجميع، والقراءة للمدير فقط.';

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- ── الإدراج: للزائر وللمسجَّل ──
drop policy if exists client_errors_insert_any on public.client_errors;
create policy client_errors_insert_any on public.client_errors
  for insert to anon, authenticated
  with check (true);

-- ── القراءة: المدير فقط ──
drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_select_admin on public.client_errors
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

-- ── الحذف (تنظيف السجل): المدير فقط ──
drop policy if exists client_errors_delete_admin on public.client_errors;
create policy client_errors_delete_admin on public.client_errors
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

-- ── لا UPDATE لأحد: سجل يُلحق فقط ──
revoke update on public.client_errors from anon, authenticated;

-- ── تنظيف اختياري: حذف ما تجاوز 90 يومًا (يُستدعى من مراجعة شهرية أو يدويًا) ──
create or replace function public.client_errors_purge(days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  -- الحماية نفسها: المدير فقط (وإلا صار أي زائر يمسح سجل الأعطال)
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;
  delete from public.client_errors where created_at < now() - make_interval(days => greatest(days, 1));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.client_errors_purge(integer) from anon;
grant execute on function public.client_errors_purge(integer) to authenticated;

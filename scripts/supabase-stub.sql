-- ═══════════════════════════════════════════════════════════════════
--  محاكي Supabase محلي — لتشغيل ملفات الترحيل فعليًا خارج الإنتاج
--
--  الغرض: بدل «فحص SQL نصيًا» فقط، نُشغّل الترحيلات على PostgreSQL حقيقي
--  (v17) ونختبر سلوكها: هل الدوال تعمل؟ هل RLS تمنع فعلًا؟ هل الترقيم
--  لا يُنتج رقمين متساويين تحت التوازي؟
--
--  ما يحاكيه هذا الملف (الحد الأدنى الذي تعتمد عليه ترحيلاتنا):
--   • الأدوار: anon · authenticated · service_role
--   • المخططات: auth · storage · extensions
--   • auth.users · auth.uid()   (تعمل عبر set_config('request.jwt.claims'))
--   • storage.buckets · storage.objects (+ RLS)
--   • دالة extensions.gin_trgm_ops (pg_trgm)
--
--  ⚠️ لا يُستخدم في الإنتاج إطلاقًا — للتجريب فقط (verify-sql-live.sh).
-- ═══════════════════════════════════════════════════════════════════

-- ⚠️ pg_trgm تُنصَّب في مخطط extensions (كما في Supabase) — تنصيبها في public
-- يجعل القسم 6.1 من ترحيل التصليب يفشل: operator class "extensions.gin_trgm_ops" غير موجودة.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin superuser; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
end $$;

grant anon, authenticated, service_role to current_user;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- ── الصلاحيات الافتراضية كما يفعلها Supabase فعلًا ────────────────
-- من دونها لا تُنفَّذ السياسات أصلًا: الخطأ يظهر «permission denied for table»
-- وتبدو السياسات كأنها لا تعمل — وهذا خطأ في المحاكي لا في الترحيلات.
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant usage on types to anon, authenticated, service_role;

-- ── مخطط extensions: ترحيلاتنا تضع pg_trgm هنا ────────────────────
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ── مخطط auth ────────────────────────────────────────────────────
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase: تضع هوية الطلب في request.jwt.claims، ومنها uid
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claim.email', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- ── Realtime: Supabase ينشئ هذه الـpublication تلقائيًا ────────────
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── مخطط storage ─────────────────────────────────────────────────
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- ── رؤوس الطلب (تُستخدم لقفل المحاولات حسب عنوان IP) ──────────────
-- في Supabase الحقيقي: current_setting('request.headers') = {"x-forwarded-for": "..."}
do $$
begin
  perform set_config('request.headers', '{"x-forwarded-for":"127.0.0.1"}', false);
exception when others then null;
end $$;

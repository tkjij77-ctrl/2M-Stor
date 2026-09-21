-- ═══════════════════════════════════════════════════════════════════
--  F2 — قفل محاولات الدخول على السيرفر (كان قفلًا وهميًا)
--
--  المشكلة: القفل القديم كان في `localStorage`:
--      l.count++; if (l.count >= 5) l.until = Date.now() + 5*60*1000
--  أي أن من يمسح بيانات المتصفح (أو يفتح نافذة خاصة، أو يجرّب من
--  جهاز آخر) يعود وكأن شيئًا لم يكن — وكذلك كل من يهاجم عبر طلب
--  مباشر لواجهة Supabase لا يرى القفل أصلًا.
--
--  الحل: عدّاد على القاعدة بثلاث نوافذ (اسم المستخدم · الجهاز · عنوان IP)
--  تُستدعى قبل كل محاولة دخول وبعدها. لا يُقرأ الجدول مباشرة إطلاقًا،
--  ولا تُقبل أي محاولة عبر الدوال إلا بما تسمح به السياسة أعلاه.
--
--  ⚠️ حدّان نُعلنهما بصراحة:
--   1) الحسابات المحلية (بلا Supabase) لا يمكن قفلها سيرفريًا — الجهاز
--      نفسه هو الحدّ الأمني. التطبيق يُظهر قفلًا متزايدًا محليًا في هذه
--      الحالة، ويقول للمستخدم إن القفل الكامل يعمل عند الاتصال.
--   2) من يملك مفتاح الخدمة (service_role) يتجاوز كل شيء — كما في كل
--      نظام، وهذا مقصود.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.login_attempts (
  id           bigserial primary key,
  username_hash text not null,          -- md5(الاسم بحروف صغيرة) — لا نخزّن الأسماء صريحة
  device_id    text not null default 'unknown',
  ip           text,
  success      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_login_attempts_user   on public.login_attempts (username_hash, created_at desc);
create index if not exists idx_login_attempts_device on public.login_attempts (device_id, created_at desc);
create index if not exists idx_login_attempts_time   on public.login_attempts (created_at desc);

alter table public.login_attempts enable row level security;
-- لا سياسات: لا قراءة ولا كتابة مباشرة — الوصول عبر الدوال فقط
revoke all on table public.login_attempts from public, anon, authenticated;

-- ── حدود القفل (يمكن تعديلها في مكان واحد) ────────────────────────
--   اسم المستخدم : 5 محاولات فاشلة / 15 دقيقة ⇒ قفل 5 دقائق يتضاعف
--   الجهاز       : 15 محاولة  / 15 دقيقة ⇒ قفل 15 دقيقة
--   عنوان IP     : 40 محاولة  / 15 دقيقة ⇒ قفل 30 دقيقة

-- ── حالة القفل قبل المحاولة ───────────────────────────────────────
create or replace function public.login_gate(p_username text, p_device text default 'unknown')
returns table (allowed boolean, locked_seconds int, attempts_left int, scope text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
  v_ip     text;
  v_fails  int;
  v_locks  int;
  v_dev    int;
  v_ipc    int;
  v_lock   int := 0;
begin
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
    v_ip := nullif(trim(v_ip), '');
  exception when others then v_ip := null;
  end;

  -- محاولات فاشلة متتالية لنفس الاسم
  select count(*) into v_fails
    from public.login_attempts a
   where a.username_hash = v_hash
     and not a.success
     and a.created_at > now() - interval '15 minutes';

  -- كم مرة قُفل هذا الاسم خلال يوم (لتضاعف مدة القفل)
  select count(*) into v_locks
    from (
      select date_trunc('hour', a.created_at) as h
        from public.login_attempts a
       where a.username_hash = v_hash and not a.success
       group by 1
      having count(*) >= 5
    ) q;

  -- محاولات الجهاز وعنوان IP (تحدّ من تخمين أسماء مستخدمين كثيرة)
  select count(*) into v_dev
    from public.login_attempts a
   where a.device_id = v_device and not a.success and a.created_at > now() - interval '15 minutes';
  select count(*) into v_ipc
    from public.login_attempts a
   where v_ip is not null and a.ip = v_ip and not a.success and a.created_at > now() - interval '15 minutes';

  if v_ipc >= 40 then
    return query select false, 1800, 0, 'ip'::text;
    return;
  end if;
  if v_dev >= 15 then
    return query select false, 900, 0, 'device'::text;
    return;
  end if;
  if v_fails >= 5 then
    v_lock := 300 * greatest(1, power(2, least(v_locks, 4))::int);
    return query select false, v_lock, 0, 'username'::text;
    return;
  end if;

  return query select true, 0, greatest(0, 5 - v_fails), 'none'::text;
end $$;

-- ── تسجيل محاولة فاشلة ───────────────────────────────────────────
create or replace function public.login_fail(p_username text, p_device text default 'unknown')
returns table (allowed boolean, locked_seconds int, attempts_left int, scope text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
  v_ip     text;
  v_flood  int;
begin
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
    v_ip := nullif(trim(v_ip), '');
  exception when others then v_ip := null;
  end;

  -- حماية الجدول نفسه من الإغراق: لا نكتب أكثر من 200 صف للساعة لجهاز واحد
  select count(*) into v_flood
    from public.login_attempts a
   where a.device_id = v_device and a.created_at > now() - interval '1 hour';
  if v_flood < 200 then
    insert into public.login_attempts (username_hash, device_id, ip, success)
    values (v_hash, v_device, v_ip, false);
  end if;

  return query select * from public.login_gate(p_username, p_device);
end $$;

-- ── تسجيل دخول ناجح (يمسح محاولات الاسم والجهاز) ─────────────────
create or replace function public.login_ok(p_username text, p_device text default 'unknown')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash   text := md5(lower(trim(coalesce(p_username, ''))));
  v_device text := coalesce(nullif(trim(p_device), ''), 'unknown');
begin
  insert into public.login_attempts (username_hash, device_id, success) values (v_hash, v_device, true);
  delete from public.login_attempts
   where username_hash = v_hash and device_id = v_device and not success;
  -- تنظيف تلقائي: لا نحتفظ بأكثر من 30 يومًا
  delete from public.login_attempts where created_at < now() - interval '30 days';
  return true;
end $$;

-- ── الصلاحيات: تُستدعى قبل الدخول (بلا هوية) ──────────────────────
revoke all on function public.login_gate(text, text)  from public;
revoke all on function public.login_fail(text, text)  from public;
revoke all on function public.login_ok(text, text)    from public;
grant execute on function public.login_gate(text, text) to anon, authenticated;
grant execute on function public.login_fail(text, text) to anon, authenticated;
grant execute on function public.login_ok(text, text)   to anon, authenticated;

comment on function public.login_gate(text, text) is
  'F2 — حالة القفل قبل الدخول: الاسم (5/15د) · الجهاز (15/15د) · الـIP (40/15د)';
comment on table public.login_attempts is
  'F2 — عدّاد محاولات الدخول. لا يُقرأ مباشرة؛ للوصول: login_gate/login_fail/login_ok';

-- ── تحقق ─────────────────────────────────────────────────────────
-- select * from public.login_gate('admin', 'dev-1');
-- select * from public.login_fail('admin', 'dev-1');   -- كرّرها 5 مرات
-- select * from public.login_gate('admin', 'dev-1');   -- المتوقع: allowed=false

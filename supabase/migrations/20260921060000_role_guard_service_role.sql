-- ═══════════════════════════════════════════════════════════════════
--  N-3 — «لا يمكن إنشاء أول مدير سحابي»: ثغرة تشغيلية في الحارس
--
--  ما كشفه التشغيل الحقيقي (scripts/verify-sql-live.sh):
--  المشغّل `prevent_role_escalation` كان يرفض أي تغيير دور ما لم يكن
--  المُغيِّر مديرًا — وهذا صحيح أمنيًا، لكنه يجعل النظام **غير قابل
--  للتهيئة**: كل حساب جديد يُولَد بدور customer (عبر `handle_new_user`)،
--  ولا يوجد مدير أوّل ليرقّي الحسابات. حتى الرفع من SQL Editor كان يُرفض.
--
--  الإصلاح: مسار «سيرفر موثوق» صريح — يُسمح بتغيير الدور لـ:
--   1) مدير مسجَّل (كما كان)
--   2) `service_role` — مفتاح الخدمة السيرفري (لا يُوزَّع على الأجهزة)
--  ويبقى مرفوضًا لكل ما دون ذلك: زائر · عميل · عامل.
--
--  كيف تُرقّي أول مدير؟ (انسخ في SQL Editor — كل ما تحتاجه سطر واحد)
--      begin;
--      set local role service_role;          -- المسار الموثوق
--      update public.profiles set role = 'admin' where username = 'اسم-حسابك';
--      commit;
--  أو استخدم السكربت الجاهز: scripts/grant-role.sql
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changer_role text;
begin
  -- لا تغيير في الدور ⇒ لا شأن لنا بهذا التعديل
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- 1) الخدمة السيرفرية الموثوقة (service_role) — المسار الإداري المعلن
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 2) مدير مسجَّل
  changer_role := public.my_role();
  if changer_role = 'admin' then
    return new;
  end if;

  raise exception 'تغيير الدور ممنوع — يتطلب مديرًا أو مفتاح الخدمة (service_role)'
    using errcode = '42501';
end $$;

comment on function public.prevent_role_escalation() is
  'N-3: يمنع تصعيد الصلاحيات، ويسمح فقط للمدير المسجَّل أو service_role (لتهيئة المدير الأول)';

-- الحارس مربوط بالمشغّل، لكن نعيد التأكيد (لو أُسقط في مكان ما)
drop trigger if exists trg_profiles_no_escalation on public.profiles;
create trigger trg_profiles_no_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- ── تحقق ────────────────────────────────────────────────────────────
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
-- المتوقع: trg_profiles_no_escalation

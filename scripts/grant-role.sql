-- ═══════════════════════════════════════════════════════════════════
--  ترقية حساب (أول مدير · عامل جديد · إرجاع حساب لعميل)
--
--  لماذا ملف خاص؟ لأن المشغّل `prevent_role_escalation` يرفض أي تغيير دور
--  بلا هوية مدير — وهذا مقصود. المسار الموثوق الوحيد من دون مدير قائم هو
--  `service_role` (يُعلَن هنا صراحةً، ولا يقدر عليه إلا من يملك دخول SQL أصلًا).
--
--  ⚠️ نسخة **بلا `\set` ولا `:'var'`** — تلك أوامر عميل psql ولا يفهمها
--     Supabase SQL Editor (كانت ستفشل بخطأ صياغة).
--
--  الاستخدام: Supabase → SQL Editor → New query → الصق الملف →
--             عدّل السطرين بين ✏️ (موضع واحد فقط) → Run
--  النتيجة: إشعار `✅ فلان : customer ← admin` + جدول تحقق أسفل النتائج،
--           ورسالة خطأ واضحة لو الاسم غير موجود أو الدور غير معروف.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  -- ✏️ عدّل هذين السطرين فقط:
  target_username text := 'اكتب-اسم-المستخدم';
  target_role     text := 'admin';                     -- admin | worker | customer
  before_role     text;
  after_role      text;
begin
  if target_username = 'اكتب-اسم-المستخدم' or coalesce(target_username, '') = '' then
    raise exception 'عدّل target_username أولًا (السطر ✏️)';
  end if;
  if target_role not in ('admin', 'worker', 'customer') then
    raise exception 'الدور «%» غير معروف — المسموح: admin | worker | customer', target_role;
  end if;

  -- نُثبّت الاسم في إعداد جلسة حتى يعمل استعلام التحقق أسفل الملف **بلا تعديل آخر**
  perform set_config('app.grant_target', target_username, false);

  select p.role into before_role from public.profiles p where p.username = target_username;
  if before_role is null then
    raise exception 'لا يوجد حساب بالاسم «%» — راجع الاسم في profiles', target_username;
  end if;

  -- الهوية الموثوقة: الدور + هوية الطلب (الحارس يقرأ الدور من request.jwt.claims)
  execute 'set local role service_role';
  execute $q$set local request.jwt.claims = '{"role":"service_role"}'$q$;

  update public.profiles set role = target_role where username = target_username;

  -- ملاحظة: القراءة بعد التبديل تحتاج الصلاحية نفسها، فنُرجِع الدور للقراءة
  execute 'reset role';
  select p.role into after_role from public.profiles p where p.username = target_username;

  raise notice '✅ % : % ← % (الدور الآن: %)', target_username, coalesce(before_role, '—'), target_role, after_role;
  raise notice '⚠️ اطلب من صاحب الحساب تسجيل الخروج والدخول من جديد لتُحدَّث صلاحياته في الواجهة.';
end $$;

-- تحقّق نهائي (يقرأ الاسم من جلسة التشغيل نفسها — لا تعديل مطلوب هنا)
select username, display_name, role as الدور_الآن
  from public.profiles
 where username = current_setting('app.grant_target', true);

-- ═══════════════════════════════════════════════════════════════════
--  إن ظهر «تغيير الدور ممنوع — يتطلب مديرًا أو مفتاح الخدمة»:
--    فالمشغّل لم يُحدَّث بعد ⇒ نفّذ أولًا:
--    supabase/migrations/20260921060000_role_guard_service_role.sql
--
--  🧯 بديل اضطراري (لحظة واحدة، لو تعذّر كل ما سبق):
--    begin;
--    alter table public.profiles disable trigger trg_profiles_no_escalation;
--    update public.profiles set role = 'admin' where username = 'اسم-حسابك';
--    alter table public.profiles enable trigger trg_profiles_no_escalation;
--    commit;
-- ═══════════════════════════════════════════════════════════════════

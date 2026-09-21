-- ═══════════════════════════════════════════════════════════════════
--  T3.1 — ترقيم الفواتير على السيرفر (كان رقمًا محليًا لكل جهاز)
--
--  الثغرة D1: `al_sayed_invno` في localStorage. جهازان يعملان بلا تنسيق
--  يُنتجان «فاتورة #7» مرتين ⇒ إما تصادم يُفشل الرفع، أو — الأسوأ —
--  رقمان مكرّران على ورق العميلين، وسجل مبيعات لا يمكن الاعتماد عليه.
--
--  الحل: تسلسل (sequence) مركزي في القاعدة:
--    • next_invoice_no(): رقم رسمي يُطلب قبل الحفظ (لمسجّل الدخول فقط)
--    • assign_invoice_no(): trigger يُسند رقمًا لأي فاتورة بلا رقم،
--      ويستبدل رقمًا محليًا محجوزًا على جهاز آخر — فلا يفشل الإدراج أبدًا
--
--  الترتيب: نفّذ هذا الملف **بعد** 20260826200407_baseline.sql
--           (يحتاج جدول invoices موجودًا).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) التسلسل المركزي ────────────────────────────────────────────
create sequence if not exists public.invoice_no_seq as integer;

-- نضبط البداية على أكبر رقم موجود + 1، **ولا نُنقص** التسلسل أبدًا
-- (إعادة تشغيل الملف بعد فواتير جديدة يجب ألا تُعيد أرقامًا مستخدمة).
do $$
declare
  v_max  integer;
  v_next integer;
begin
  select coalesce(max(invoice_no), 0) into v_max from public.invoices;
  select case when is_called then last_value + 1 else last_value end
    into v_next
    from public.invoice_no_seq;
  if v_next <= v_max then
    perform setval('public.invoice_no_seq', v_max + 1, false);
  end if;
end $$;

comment on sequence public.invoice_no_seq is 'T3.1 — الرقم الرسمي لتسلسل الفواتير (مصدر واحد لكل الأجهزة)';

-- ── 2) الرقم الرسمي عند الطلب ─────────────────────────────────────
create or replace function public.next_invoice_no()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no integer;
begin
  -- لا يُسمح لزائر مجهول بسحب أرقام من التسلسل
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب للحصول على رقم فاتورة'
      using errcode = '42501';
  end if;
  v_no := nextval('public.invoice_no_seq');
  return v_no;
end $$;

comment on function public.next_invoice_no() is
  'T3.1 — يُعيد الرقم الرسمي التالي للفاتورة (تسلسل مركزي، بلا تكرار بين الأجهزة)';

-- ⚠️ الوصول عبر الدالة فقط: لا grant على التسلسل نفسه، وإلا أمكن
--    سحب أرقام بلا فاتورة عبر nextval مباشرة.
revoke all on function public.next_invoice_no() from public;
revoke all on function public.next_invoice_no() from anon;
grant execute on function public.next_invoice_no() to authenticated;

-- ── 3) حارس الإدراج: أي فاتورة بلا رقم أو برقم محجوز تأخذ رقمًا رسميًا ──
create or replace function public.assign_invoice_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ثلاث حالات:
  --   (أ) لا رقم إطلاقًا        → رقم رسمي من التسلسل
  --   (ب) رقم سالب/صفر         → رقم رسمي
  --   (ج) رقم محلي محجوز فعلًا → رقم رسمي (جهاز آخر سبقنا إليه)
  if new.invoice_no is null
     or new.invoice_no <= 0
     or exists (select 1 from public.invoices i where i.invoice_no = new.invoice_no) then
    new.invoice_no := nextval('public.invoice_no_seq');
  end if;
  return new;
end $$;

comment on function public.assign_invoice_no() is
  'T3.1 — trigger: يمنع فشل الإدراج عند تصادم الأرقام المحلية بين الأجهزة';

drop trigger if exists trg_invoices_assign_no on public.invoices;
create trigger trg_invoices_assign_no
  before insert on public.invoices
  for each row
  execute function public.assign_invoice_no();

-- ── 4) تقرير صحة الترقيم (للمراجعة اليدوية) ──────────────────────
create or replace function public.invoice_number_health()
returns table (max_invoice_no integer, sequence_next integer, duplicates bigint)
language sql
security definer
set search_path = public
as $$
  select
    (select coalesce(max(invoice_no), 0) from public.invoices) as max_invoice_no,
    (select case when is_called then last_value + 1 else last_value end
       from public.invoice_no_seq)::integer as sequence_next,
    (select count(*) from (
        select invoice_no from public.invoices
        group by invoice_no having count(*) > 1
     ) d) as duplicates;
$$;

comment on function public.invoice_number_health() is
  'T3.1 — فحص سريع: لا تكرار في الأرقام والتسلسل متقدّم على أكبر رقم';

revoke all on function public.invoice_number_health() from public;
revoke all on function public.invoice_number_health() from anon;
grant execute on function public.invoice_number_health() to authenticated;

-- ═══════════════════════════════════════════════════════════════════
--  T3.3 / T2.5 — خصم المخزون ذرّيًا من تطبيق Next.js (سلة الواجهة)
--
--  لماذا RPC وليس تحديثًا عاديًا؟
--    التحديث العادي في المتصفح يقرأ الرصيد ثم يكتبه (read-then-write):
--    لو باع جهازان في نفس اللحظة، يكتب الثاني رقمًا مبنيًا على قراءة قديمة
--    فيضيع خصم الأول. الدالة هنا تُنفَّذ داخل القاعدة في عملية واحدة ذرّية.
--
--  الأمان: أي مسجَّل دخول (عامل/مدير/عميل) — نفس شرط إنشاء الفاتورة.
--          الزائر المجهول ممنوع (وإلا صار الخصم أداة تخريب).
--
--  ✅ آمن للتشغيل المتكرر.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── خصم المخزون ──────────────────────────────────────────────
create or replace function public.decrement_stock(
  p_item_id bigint,
  p_qty int,
  p_both boolean default true
)
returns table (stock_q int, display_qs int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب لخصم المخزون';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  -- القفل يمنع سباق الجهازين (الخصم لا يضيع)
  return query
  update public.items i
     set display_qs = greatest(0, i.display_qs - p_qty),
         stock_q    = case when p_both then greatest(0, i.stock_q - p_qty) else i.stock_q end,
         updated_at = now()
   where i.id = p_item_id
     and i.deleted_at is null
  returning i.stock_q, i.display_qs;

  if not found then
    raise exception 'الصنف % غير موجود أو محذوف', p_item_id;
  end if;
end $$;

comment on function public.decrement_stock(bigint, int, boolean) is
  'خصم ذرّي من المخزون عند البيع — يمنع ضياع الخصم عند البيع المتزامن (T3.3)';

-- ── إرجاع المخزون (إلغاء/رفض من أي جهاز) ─────────────────────
create or replace function public.increment_stock(
  p_item_id bigint,
  p_qty int,
  p_both boolean default true
)
returns table (stock_q int, display_qs int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  -- المعروض لا يتجاوز المخزن (قيد السلامة في 20260921020000)
  return query
  update public.items i
     set stock_q    = case when p_both then i.stock_q + p_qty else i.stock_q end,
         display_qs = least(
                        i.display_qs + p_qty,
                        case when p_both then i.stock_q + p_qty else i.stock_q end
                      ),
         updated_at = now()
   where i.id = p_item_id and i.deleted_at is null
  returning i.stock_q, i.display_qs;

  if not found then
    raise exception 'الصنف % غير موجود أو محذوف', p_item_id;
  end if;
end $$;

comment on function public.increment_stock(bigint, int, boolean) is
  'إرجاع كمية للمخزون عند إلغاء بيعة (T3.3)';

-- ── الصلاحيات ────────────────────────────────────────────────
revoke all on function public.decrement_stock(bigint, int, boolean) from anon;
revoke all on function public.increment_stock(bigint, int, boolean) from anon;
grant execute on function public.decrement_stock(bigint, int, boolean) to authenticated;
grant execute on function public.increment_stock(bigint, int, boolean) to authenticated;

-- ── تسجيل الحركة في سجل النشاط (تتبّع من خصم ماذا ومتى) ──────
create or replace function public.log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.stock_q is distinct from old.stock_q)
     or (new.display_qs is distinct from old.display_qs) then
    insert into public.audit_log(user_id, action, details)
    values (
      auth.uid(),
      'تغيّر مخزون',
      new.name || ' — مخزن ' || old.stock_q || '→' || new.stock_q ||
      ' · معروض ' || old.display_qs || '→' || new.display_qs
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_log_stock_change on public.items;
create trigger trg_log_stock_change
  after update of stock_q, display_qs on public.items
  for each row execute function public.log_stock_change();

-- ── فحص ذاتي ────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.decrement_stock(bigint,int,boolean)') is null then
    raise exception 'فشل إنشاء decrement_stock';
  end if;
  raise notice '✅ T3.3/T2.5: خصم وإرجاع المخزون ذرّيًا + تتبّع في سجل النشاط';
end $$;

commit;

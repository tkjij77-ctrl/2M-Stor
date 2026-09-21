-- ═══════════════════════════════════════════════════════════════════
--  T3.3 — نموذج المخزون: تتبّع الخصم + حماية الأرقام على مستوى القاعدة
--
--  الخلفية (من التقرير — البند D2 «حرج»):
--    البيع كان يُنقص «المعروض» (display_qs) فقط، ويترك «إجمالي المخزن»
--    (stock_q) ثابتًا للأبد → جرد وهمي. والأسوأ: إلغاء الطلب
--    أو حذف الفاتورة لم يُرجِع أي كمية → نقص دائم بلا سبب.
--
--  هذا الترحيل يضيف:
--    1) invoices.stock_applied — هل خُصم مخزون هذه الفاتورة؟ (يمنع الخصم/الاسترجاع المزدوج)
--    2) قيود عدم السلبية على الكميات (دفاع ثانٍ لو رفعت نسخة قديمة أرقامًا سالبة)
--    3) تقرير جرد: أين التناقض بين المخزن والمعروض؟
--    4) دالة تشخيصية للفواتير الملغاة التي لم تُرجِع كمياتها
--
--  ✅ آمن للتشغيل المتكرر (idempotent).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1) تتبّع الخصم على الفاتورة ───────────────────────────────
--    القيم: null (لم يُخصم أو فاتورة قديمة) · 'both' · 'display'
alter table public.invoices
  add column if not exists stock_applied text;

comment on column public.invoices.stock_applied is
  'كيف خُصم مخزون هذه الفاتورة: both = المخزن والمعروض · display = المعروض فقط · null = لم يُخصم';

alter table public.invoices
  add column if not exists stock_reverted_at timestamptz;

comment on column public.invoices.stock_reverted_at is
  'وقت استرجاع الكميات (إلغاء/رفض/حذف) — يمنع الاسترجاع المزدوج';

-- ── 2) قيود عدم السلبية (دفاع ثانٍ) ───────────────────────────
--    not valid: تُطبَّق على الكتابات الجديدة دون أن تفشل بسبب بيانات قديمة.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_q_nonneg') then
    alter table public.items
      add constraint items_q_nonneg check (stock_q >= 0 and display_qs >= 0) not valid;
  end if;

  -- المعروض للبيع لا يزيد عن إجمالي المخزن (وإلا نبيع ما لا نملك)
  if not exists (select 1 from pg_constraint where conname = 'items_display_le_stock') then
    alter table public.items
      add constraint items_display_le_stock check (display_qs <= stock_q) not valid;
  end if;
end $$;

comment on constraint items_q_nonneg on public.items is
  'الكميات لا تكون سالبة أبدًا (T3.3)';
comment on constraint items_display_le_stock on public.items is
  'المعروض للبيع ≤ إجمالي المخزن (T3.3)';

-- ── 3) تقرير جرد: أين التناقض؟ ───────────────────────────────
create or replace view public.stock_health as
select
  i.id,
  i.name,
  c.name                as category_name,
  i.stock_q,
  i.display_qs,
  i.min_alert,
  case
    when i.stock_q < 0 or i.display_qs < 0            then '❌ كمية سالبة'
    when i.display_qs > i.stock_q                     then '⚠️ المعروض أكبر من المخزن'
    when i.stock_q = 0                                then '🔴 نافذ'
    when i.stock_q <= i.min_alert                     then '🟠 تحت حد التنبيه'
    else                                                   '✅ سليم'
  end                   as status_ar,
  (i.stock_q - i.display_qs) as hidden_qty,   -- كمية في المخزن غير معروضة
  i.updated_at
from public.items i
left join public.categories c on c.id = i.category_id
where i.deleted_at is null
order by
  case when i.stock_q < 0 or i.display_qs < 0 or i.display_qs > i.stock_q then 0
       when i.stock_q = 0 then 1
       when i.stock_q <= i.min_alert then 2
       else 3 end,
  i.name;

comment on view public.stock_health is
  'تقرير جرد فوري — يكشف التناقض والأصناف الناقصة (T3.3)';

-- ── 4) تشخيص: فواتير ملغاة لم تُرجِع كمياتها ────────────────
create or replace function public.stock_mismatch_report()
returns table (
  invoice_no    int,
  invoice_total numeric,
  status        text,
  stock_applied text,
  created_at    timestamptz,
  diagnosis     text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    inv.invoice_no,
    inv.total,
    inv.status,
    inv.stock_applied,
    inv.created_at,
    case
      when inv.status in ('ملغي', 'تم رفض الطلب') and inv.stock_applied is not null
           and inv.stock_reverted_at is null
        then '❌ فاتورة ملغاة والكميات لم تُرجَع — نفّذ استرجاعًا يدويًا'
      when inv.status in ('قيد المعالجة', 'في الطريق', 'تم التوصيل')
           and inv.stock_applied is null
        then '⚠️ فاتورة قائمة بلا خصم مخزون مسجَّل — راجع الجرد'
      else '✅ سليم'
    end
  from public.invoices inv
  where public.is_manager()
  order by inv.created_at desc
  limit 200;
$$;

revoke all on function public.stock_mismatch_report() from anon;
grant execute on function public.stock_mismatch_report() to authenticated;

comment on function public.stock_mismatch_report() is
  'تشخيص تناقضات المخزون في الفواتير — للمدير (T3.3)';

-- ── 5) دالة إرجاع كميات فاتورة (للتصحيح اليدوي من لوحة Supabase) ──
create or replace function public.revert_invoice_stock(p_invoice_no int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied text;
  v_reverted timestamptz;
  v_qty int;
  v_lines int := 0;
begin
  if not public.is_manager() then
    raise exception 'استرجاع الكميات للمدير فقط';
  end if;

  select stock_applied, stock_reverted_at into v_applied, v_reverted
    from public.invoices where invoice_no = p_invoice_no;

  if not found then return '❌ لا توجد فاتورة برقم ' || p_invoice_no; end if;
  if v_reverted is not null then return 'ℹ️ كميات هذه الفاتورة مُرجَعة بالفعل (' || v_reverted || ')'; end if;
  if v_applied is null then return 'ℹ️ هذه الفاتورة لا تحتوي مخزونًا مخصومًا'; end if;

  for v_qty in
    select ii.qty from public.invoice_items ii
      join public.invoices inv on inv.id = ii.invoice_id
     where inv.invoice_no = p_invoice_no
  loop
    -- نرجّع بالاسم عبر جدول الأصناف (الربط الأدق موجود في التطبيق)
    update public.items i
       set display_qs = i.display_qs + v_qty,
           stock_q    = case when v_applied = 'both' then i.stock_q + v_qty else i.stock_q end,
           updated_at = now()
     where i.id = (
        select i2.id from public.items i2
          join public.invoice_items ii2 on ii2.item_name = i2.name
          join public.invoices inv2 on inv2.id = ii2.invoice_id
         where inv2.invoice_no = p_invoice_no
           and i2.deleted_at is null
         limit 1
     );
    v_lines := v_lines + 1;
  end loop;

  update public.invoices
     set stock_applied = null, stock_reverted_at = now()
   where invoice_no = p_invoice_no;

  insert into public.audit_log(user_id, action, details)
  values (auth.uid(), 'استرجاع كميات فاتورة', '#' || p_invoice_no || ' — ' || v_lines || ' سطرًا');

  return '✅ أُرجعت كميات الفاتورة #' || p_invoice_no || ' (' || v_lines || ' سطرًا)';
end $$;

revoke all on function public.revert_invoice_stock(int) from anon;
grant execute on function public.revert_invoice_stock(int) to authenticated;

comment on function public.revert_invoice_stock(int) is
  'إرجاع كميات فاتورة ملغاة يدويًا — للمدير (T3.3)';

-- ── 6) فحص ذاتي ──────────────────────────────────────────────
do $$
declare
  v_neg int; v_bad int;
begin
  select count(*) into v_neg from public.items where stock_q < 0 or display_qs < 0;
  if v_neg > 0 then
    raise warning '⚠️ % صنف بكمية سالبة — صحّحها من تقرير stock_health', v_neg;
  end if;

  select count(*) into v_bad from public.items
   where deleted_at is null and display_qs > stock_q;
  if v_bad > 0 then
    raise warning '⚠️ % صنف معروضه أكبر من مخزونه — راجع stock_health (القيد لن يُطبَّق إلا على الكتابات الجديدة)', v_bad;
  end if;

  raise notice '✅ T3.3 طُبِّق: تتبّع الخصم + قيود السلامة + تقرير الجرد';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  ✈️ ربط محادثات تيليجرام بأرقام الطلبات (لإشعار العميل تلقائيًا)
--
--  لماذا جدول منفصل؟ حتى لا نضع معرّف محادثة تيليجرام داخل جدول الفواتير
--  (بيانات مالية) ولا نمنح الزائر أي وصول له. الكتابة والقراءة تتم فقط من
--  دالة Edge بمفتاح service_role — لا سياسات وصول عام ولا anon.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.order_chat_links (
  order_token text primary key,
  chat_id     bigint not null,
  linked_at   timestamptz not null default now()
);

comment on table public.order_chat_links is
  'ربط محادثة تيليجرام العميل برمز تتبّع الطلب — تُدار من دالة Edge فقط';

alter table public.order_chat_links enable row level security;

-- لا سياسات عن قصد: الوصول ممنوع تمامًا من anon/authenticated،
-- وتستخدمها دالة Edge بمفتاح service_role (يتجاوز RLS).
revoke all on table public.order_chat_links from anon, authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='order_chat_links') then
    raise exception 'جدول order_chat_links لم يُنشأ';
  end if;
  raise notice '✅ جدول ربط محادثات تيليجرام جاهز';
end $$;

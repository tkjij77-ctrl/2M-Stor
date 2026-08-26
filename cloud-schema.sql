-- ═══════════════════════════════════════════════════════
--  آل السيد — مخطط قاعدة البيانات السحابية (Supabase)
--  انسخ الملف كاملاً والصقه في: SQL Editor → Run
-- ═══════════════════════════════════════════════════════

-- ── الحسابات والأدوار ─────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  role text not null default 'customer' check (role in ('admin','worker','customer')),
  pin_hash text,
  created_at timestamptz not null default now()
);

-- ── الأقسام ───────────────────────────────────────────
create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── الأصناف (المخزون) ────────────────────────────────
create table if not exists public.items (
  id bigint generated always as identity primary key,
  category_id bigint references public.categories(id) on delete cascade,
  name text not null,
  price_text text not null default '',
  price_num numeric(12,2) not null default 0,
  stock_q int not null default 0,          -- في المخزن
  display_qs int not null default 0,       -- معروض للبيع
  min_alert int not null default 5,        -- حد التنبيه
  barcode text,
  image_url text,                          -- رابط/مفتاح الصورة في Storage
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_items_cat on public.items(category_id) where deleted_at is null;
create index if not exists idx_items_updated on public.items(updated_at);

-- ── الفواتير ──────────────────────────────────────────
create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  invoice_no int not null unique,
  customer_name text not null default 'نقدي',
  seller_id uuid references public.profiles(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_date on public.invoices(created_at);

create table if not exists public.invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint references public.invoices(id) on delete cascade,
  item_name text not null,
  category_name text,
  qty int not null,
  price numeric(12,2) not null
);

-- ── إعدادات المحل ─────────────────────────────────────
create table if not exists public.settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ── سجل النشاط ────────────────────────────────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_time on public.audit_log(created_at);

-- ── Trigger: أول مستخدم يسجل يصبح مدير تلقائياً ──────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  req_role text;
  base_user text;
  final_user text;
begin
  select (count(*) = 0) into is_first from public.profiles;
  -- الأمان: أي تسجيل جديد = عميل دايماً.
  -- منع تصعيد الصلاحيات: الـ anon key عام، فمينفعش نثق في role جاي من العميل.
  -- الترقية لمدير/عامل تحصل من داخل التطبيق بواسطة مدير موجود (profiles_write policy).
  req_role := 'customer';
  base_user := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
  final_user := base_user;
  
  -- لو اسم المستخدم مكرر لمستخدم آخر، نضيف جزء من المعرّف
  if exists (select 1 from public.profiles where username = final_user and id <> new.id) then
    final_user := base_user || '_' || substring(new.id::text from 1 for 4);
  end if;

  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    final_user,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'customer' end
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    role = case when public.profiles.role = 'admin' then 'admin' else excluded.role end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Trigger: تحديث updated_at تلقائياً ─────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_cats_touch on public.categories;
create trigger trg_cats_touch before update on public.categories
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_items_touch on public.items;
create trigger trg_items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════
--  أمان الصفوف (RLS) — كل وصول يمر من هنا
--  anon key عام بالتصميم، الأمان الحقيقي هنا
-- ═══════════════════════════════════════════════════════
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.items         enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.settings      enable row level security;
alter table public.audit_log     enable row level security;

create or replace function public.my_role()
returns text language sql security definer stable set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ── تقوية: منع نادى الدوال الحساسة كـ RPC من بره ──────
-- دالة التريغر مش لأحد ينادى عليها مباشرة
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
-- my_role(): المسجلين محتاجينها للـ RLS، والمجهول ممنوع
revoke execute on function public.my_role() from public;
revoke execute on function public.my_role() from anon;
grant execute on function public.my_role() to authenticated;

-- الحسابات: كل واحد يشوف نفسه، والعامل/المدير يشوفوا الباقي
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (id = auth.uid() or public.my_role() in ('admin','worker'));
drop policy if exists "profiles_write" on public.profiles;
create policy "profiles_write" on public.profiles
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- الأقسام: قراءة لكل مسجل الدخول، تعديل للعامل والمدير
drop policy if exists "cats_read" on public.categories;
create policy "cats_read" on public.categories for select using (auth.uid() is not null);
drop policy if exists "cats_write" on public.categories;
create policy "cats_write" on public.categories
  for all using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));

-- الأصناف: قراءة لكل مسجل الدخول، تعديل للعامل والمدير
drop policy if exists "items_read" on public.items;
create policy "items_read" on public.items for select using (auth.uid() is not null);
drop policy if exists "items_write" on public.items;
create policy "items_write" on public.items
  for all using (public.my_role() in ('admin','worker'))
  with check (public.my_role() in ('admin','worker'));

-- الفواتير: قراءة للجميع (كيوسك)، إنشاء لأي مسجل دخول، حذف للمدير فقط
drop policy if exists "inv_read" on public.invoices;
create policy "inv_read" on public.invoices for select using (auth.uid() is not null);
drop policy if exists "inv_create" on public.invoices;
create policy "inv_create" on public.invoices for insert with check (auth.uid() is not null);
drop policy if exists "inv_delete" on public.invoices;
create policy "inv_delete" on public.invoices for delete using (public.my_role() = 'admin');

-- بنود الفاتورة: تُنشأ مع الفاتورة
drop policy if exists "iitems_rw" on public.invoice_items;
create policy "iitems_rw" on public.invoice_items
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- الإعدادات: قراءة للجميع، كتابة للمدير فقط
drop policy if exists "settings_read" on public.settings;
create policy "settings_read" on public.settings for select using (auth.uid() is not null);
drop policy if exists "settings_write" on public.settings;
create policy "settings_write" on public.settings
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- سجل النشاط: قراءة للعامل والمدير، كتابة لأي مسجل دخول
drop policy if exists "audit_read" on public.audit_log;
create policy "audit_read" on public.audit_log
  for select using (public.my_role() in ('admin','worker'));
drop policy if exists "audit_write" on public.audit_log;
create policy "audit_write" on public.audit_log
  for insert with check (auth.uid() is not null);

-- ── Bucket الصور (عادي — يمكن إنشاؤه من الواجهة بدل SQL) ─
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

drop policy if exists "products_public_read" on storage.objects;
create policy "products_public_read" on storage.objects
  for select using (bucket_id = 'products');

drop policy if exists "products_auth_insert" on storage.objects;
create policy "products_auth_insert" on storage.objects
  for insert with check (bucket_id = 'products' and auth.uid() is not null);

drop policy if exists "products_auth_update" on storage.objects;
create policy "products_auth_update" on storage.objects
  for update using (bucket_id = 'products' and auth.uid() is not null);

drop policy if exists "products_auth_delete" on storage.objects;
create policy "products_auth_delete" on storage.objects
  for delete using (bucket_id = 'products' and auth.uid() is not null);

-- ═══════════════════════════════════════════════════════
--  تم ✔ — الملف ده آمن لإعادة التشغيل (idempotent)
--  الخطوة التالية: في التطبيق ← الإعدادات ← ☁️ الاتصال السحابي
-- ═══════════════════════════════════════════════════════

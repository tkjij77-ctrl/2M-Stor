# RLS — القواعد

- `cats_read` / `items_read` = `using (true)` — المتجر للجميع حتى بدون تسجيل (تم: open_shop_for_anon)
- `cats_write` / `items_write` = `my_role in ('admin','worker')` — المخزن للعامل والمدير
- `handle_new_user:87` — `role='customer'` دائماً، لا أول مستخدم مدير
- `my_role():145` — revoke من anon, grant لـ authenticated فقط

تحقق: `supabase db lint` + `get_advisors(security)`

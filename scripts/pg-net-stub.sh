#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  pg_net stub — امتداد محلي مصغّر لتشغيل ترحيلات المشروع كاملة
#
#  لماذا: ترحيل `20261026120000_telegram_notify.sql` يبدأ بـ
#      create extension if not exists pg_net with schema extensions;
#  و`pg_net` متاح على Supabase فقط (ليس في حزم PostgreSQL العادية).
#  بلا هذا المحاكي، **لا يمكن بناء النظام من الصفر محليًا**، ويبقى ترحيل
#  الإشعارات غير مُختبر — وهذا بالضبط ما كان يحدث (‏1 من 14 كان يفشل).
#
#  ما يوفّره: مخطط `net` + `net.http_post(...)` يردّ معرّفًا وهميًا ويسجّل
#  النداء في `net._http_response` — أي أن أي نداء تيليجرام **لا يخرج للشبكة**
#  أثناء الفحص (وهو المطلوب أصلًا: لا نريد إرسال رسائل حقيقية من اختبار).
#
#  التشغيل:  bash scripts/pg-net-stub.sh
#  المتطلبات: PostgreSQL مثبّت (كتالوج الامتدادات) + صلاحية كتابة عليه (sudo)
#  آمن الإعادة · لا يعمل في الإنتاج إطلاقًا.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

say() { printf '  %s %s\n' "$1" "$2"; }

# ── 1) تحديد مجلد الامتدادات في التثبيت الحالي ──
SHAREDIR=""
if command -v pg_config >/dev/null 2>&1; then
  SHAREDIR="$(pg_config --sharedir 2>/dev/null || true)"
fi
if [ -z "$SHAREDIR" ] || [ ! -d "$SHAREDIR/extension" ]; then
  SHAREDIR=""
  for d in $(ls -d /usr/share/postgresql/*/extension 2>/dev/null | sort -V -r); do
    SHAREDIR="$(dirname "$d")"
    break
  done
fi
if [ -z "$SHAREDIR" ] || [ ! -d "$SHAREDIR/extension" ]; then
  say "❌" "لم أجد مجلد extension لـPostgreSQL — ثبّت postgresql أولًا"
  exit 1
fi
EXT="$SHAREDIR/extension"
say "ℹ️" "مجلد الامتدادات: $EXT"

# ── 2) سبق تنصيبه؟ ──
if [ -f "$EXT/pg_net.control" ] && [ -f "$EXT/pg_net--0.1.sql" ]; then
  say "✅" "محاكي pg_net موجود بالفعل — لا تغيير"
  exit 0
fi

# ── 3) الكتابة (sudo عند الحاجة) ──
SUDO=""
if [ ! -w "$EXT" ]; then
  if sudo -n true 2>/dev/null; then SUDO="sudo -n"; else
    say "❌" "لا صلاحية كتابة على $EXT ولا sudo متاح — شغّله بحساب مخوّل"
    exit 1
  fi
fi

$SUDO tee "$EXT/pg_net.control" >/dev/null <<'EOF'
comment = 'stub pg_net for local verification (net.http_post only)'
default_version = '0.1'
relocatable = false
EOF

$SUDO tee "$EXT/pg_net--0.1.sql" >/dev/null <<'EOF'
-- محاكي محلي مصغّر: السطح الذي تستخدمه ترحيلات 2M-Stor فقط
create schema if not exists net;

create table if not exists net._http_response (
  id          bigserial primary key,
  status_code int,
  content     text,
  error_msg   text,
  created     timestamptz not null default now()
);

create or replace function net.http_post(
  url                  text,
  body                 jsonb default '{}'::jsonb,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{}'::jsonb,
  timeout_milliseconds int   default 5000
) returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  -- لا اتصال شبكي إطلاقًا: نسجّل النداء ونردّ معرّفًا
  insert into net._http_response (status_code, content)
  values (200, jsonb_build_object('stub', true, 'url', url, 'body', body)::text)
  returning id into v_id;
  return v_id;
end $$;

comment on function net.http_post(text, jsonb, jsonb, jsonb, int) is
  'محاكي محلي — لا يرسل طلبًا حقيقيًا (pg_net الحقيقي على Supabase فقط)';
EOF

# ملكية الملفات لمستخدم postgres (وإلا يرفض الخادم قراءتها أحيانًا)
if id postgres >/dev/null 2>&1; then
  $SUDO chown "$(id -u postgres):$(id -g postgres)" "$EXT/pg_net.control" "$EXT/pg_net--0.1.sql" 2>/dev/null || true
fi

say "✅" "تم تنصيب محاكي pg_net (net.http_post → وهمي، بلا شبكة)"
say "ℹ️" "الآن: bash scripts/verify-sql-live.sh"

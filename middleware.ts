import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAdminAccess } from "./lib/auth/admin-access";

/**
 * 🔒 حماية /admin — وُلدت بعد ثغرة «الفشل المفتوح» (T7.2):
 *    كان `if (profile && …)` يسمح لمن لا سجل له في profiles بالمرور إلى اللوحة.
 *    الآن: بلا جلسة ← منع · بلا سجل دور ← منع · دور غير مخوَّل ← منع · خطأ ← منع.
 *
 * طبقتان لا واحدة:
 *   1) هذا الملف (middleware) — يمنع الطلب قبل أن يُبنى.
 *   2) app/admin/layout.tsx — يعيد الفحص على السيرفر (لو غاب matcher أو تغيّر).
 */

const HOME = "/";

function deny(req: NextRequest) {
  const res = NextResponse.redirect(new URL(HOME, req.url));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  // لا تُخزَّن صفحات الإدارة مؤقتًا في أي وسيط
  res.headers.set("Cache-Control", "no-store");

  let user: { id: string } | null = null;
  let profile: { role?: string | null } | null = null;
  let error: unknown = null;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll(); },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
          },
        },
      }
    );
    // نداء واحد فقط: كان الكود القديم يستدعي getUser() مرتين (رحلة شبكة مهدورة)
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError) error = userError;
    user = data?.user ? { id: data.user.id } : null;
    if (user) {
      // maybeSingle: صفر صفوف ليس خطأ — بل «مستخدم بلا دور» = منع
      const { data: p, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profileError) error = profileError;
      profile = p ? { role: (p as { role?: string | null }).role ?? null } : null;
    }
  } catch (e) {
    error = e;
  }

  const decision = decideAdminAccess({ user, profile, error });
  if (!decision.allow) return deny(req);
  return res;
}

export const config = { matcher: ["/admin/:path*"] };

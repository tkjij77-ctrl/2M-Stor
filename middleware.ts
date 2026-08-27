import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
      },
    }
  );
  // تجديد session تلقائياً (من noqta.tn)
  await supabase.auth.getUser();
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(new URL("/", req.url));
    // تحقق الدور (اختياري — يسمح فقط admin/worker)
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile && !["admin","worker"].includes(profile.role)) return NextResponse.redirect(new URL("/", req.url));
  }
  return res;
}
export const config = { matcher: ["/admin/:path*"] };

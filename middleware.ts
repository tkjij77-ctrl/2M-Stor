import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // حماية /admin — يتحقق من Supabase session + role
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const hasSession = req.cookies.has("sb-access-token") || req.cookies.has("sb-uzzxhbotbshsgpdnbrmd-auth-token");
    if (!hasSession) return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/admin/:path*"] };

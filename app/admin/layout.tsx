import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { decideAdminAccess } from "@/lib/auth/admin-access";

/**
 * 🔒 الطبقة الثانية (T7.2): نفس القرار على السيرفر داخل شجرة /admin.
 * لو أُزيل middleware أو تغيّر matcher، تبقى اللوحة مغلقة.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let user: { id: string } | null = null;
  let profile: { role?: string | null } | null = null;
  let error: unknown = null;

  try {
    const supabase = await createClient();
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError) error = userError;
    user = data?.user ? { id: data.user.id } : null;
    if (user) {
      const { data: p, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profileError) error = profileError;
      profile = p ? { role: (p as { role?: string | null }).role ?? null } : null;
    }
  } catch (e) {
    error = e;
  }

  if (!decideAdminAccess({ user, profile, error }).allow) redirect("/");
  return <>{children}</>;
}

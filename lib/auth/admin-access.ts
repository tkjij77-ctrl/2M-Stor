/**
 * 🔒 T7.2 — قرار الوصول إلى لوحة الإدارة (منطق خالص، بلا Next ولا Supabase)
 *
 * سبب وجود هذا الملف: كان الفحص القديم في middleware.ts يقول
 *     if (profile && !["admin","worker"].includes(profile.role)) redirect
 * وهو **يفشل مفتوحًا**: مستخدم مسجّل بلا سجل في profiles (profile === null)
 * يمرّ إلى اللوحة. صار القرار هنا صريحًا: الشك ← منع.
 *
 * يُستخدم من: middleware.ts (حافة) + app/admin/layout.tsx (طبقة ثانية على السيرفر)
 * والقاعدتان: (1) بلا مستخدم ← منع. (2) بلا سجل دور ← منع. (3) خطأ في القراءة ← منع.
 */

export const STAFF_ROLES = ["admin", "worker"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** هل الدور ضمن الأدوار المخوَّلة؟ أي شيء آخر (بما فيه null/undefined/"") = لا. */
export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

export type AdminDenyReason = "no-session" | "no-profile" | "bad-role" | "error";

export type AdminGateInput = {
  /** المستخدم من supabase.auth.getUser() — null عند غياب الجلسة */
  user: { id: string } | null | undefined;
  /** صف profiles المطلوب (role فقط) — null إذا لم يوجد صف */
  profile: { role?: string | null } | null | undefined;
  /** خطأ قراءة الدور/الجلسة — أي قيمة هنا تعني «لا نعرف» */
  error?: unknown;
};

export type AdminGateResult =
  | { allow: true; role: StaffRole }
  | { allow: false; reason: AdminDenyReason };

/**
 * قرار واحد لا يتكرر في مكانين. الافتراضي دائمًا: المنع.
 * ملاحظة مقصودة: نمنع عند الخطأ حتى لو وُجد profile — لأن حساب دور
 * غير مؤكد (شبكة/RLS) ليس أساسًا للسماح.
 */
export function decideAdminAccess({ user, profile, error }: AdminGateInput): AdminGateResult {
  if (error) return { allow: false, reason: "error" };
  if (!user || typeof user.id !== "string" || !user.id) return { allow: false, reason: "no-session" };
  // 🛡️ جوهر الإصلاح: غياب الصف = منع (كان سابقًا = مرور)
  if (!profile) return { allow: false, reason: "no-profile" };
  if (!isStaffRole(profile.role)) return { allow: false, reason: "bad-role" };
  return { allow: true, role: profile.role };
}

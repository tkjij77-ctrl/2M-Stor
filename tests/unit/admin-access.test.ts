import { describe, it, expect } from "vitest";
import { decideAdminAccess, isStaffRole, STAFF_ROLES } from "@/lib/auth/admin-access.js";

/**
 * 🔒 T7.2 — اختبار الانحدار لثغرة «الفشل المفتوح» في /admin.
 * الحالة الحمراء القديمة: profile === null  →  كان يمر. الآن يجب أن يُمنع.
 */
const U = { id: "11111111-1111-1111-1111-111111111111" };

describe("isStaffRole", () => {
  it("يقبل admin و worker فقط", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("worker")).toBe(true);
  });
  it("يرفض كل ما سواهما", () => {
    for (const bad of ["customer", "Admin", "ADMIN", " admin", "", null, undefined, 0, {}, [], true]) {
      expect(isStaffRole(bad as unknown)).toBe(false);
    }
  });
  it("قائمة الأدوار مثبَّتة (أي توسيع يجب أن يكون قرارًا واعيًا)", () => {
    expect([...STAFF_ROLES]).toEqual(["admin", "worker"]);
  });
});

describe("decideAdminAccess — الحالات المسموحة", () => {
  it.each(["admin", "worker"] as const)("دور %s يمرّ", (role) => {
    expect(decideAdminAccess({ user: U, profile: { role } })).toEqual({ allow: true, role });
  });
});

describe("decideAdminAccess — الثغرة القديمة (أهم اختبار)", () => {
  it("مستخدم بلا سجل في profiles يُمنع — كان يمرّ قبل الإصلاح", () => {
    const d = decideAdminAccess({ user: U, profile: null, error: null });
    expect(d).toEqual({ allow: false, reason: "no-profile" }); // 🔴 قبل T7.2: كان allow
  });

  it("صف الدور موجود لكن role = null يُمنع", () => {
    expect(decideAdminAccess({ user: U, profile: { role: null } }))
      .toEqual({ allow: false, reason: "bad-role" });
  });

  it("دور غير مخوَّل (customer) يُمنع", () => {
    expect(decideAdminAccess({ user: U, profile: { role: "customer" } }))
      .toEqual({ allow: false, reason: "bad-role" });
  });

  it("حساب بلا جلسة يُمنع", () => {
    for (const user of [null, undefined, { id: "" }, {}]) {
      expect(decideAdminAccess({ user: user as never, profile: { role: "admin" } }))
        .toEqual({ allow: false, reason: "no-session" });
    }
  });

  it("خطأ في القراءة يُمنع حتى لو وُجد دور مدير (الشك ← منع)", () => {
    expect(decideAdminAccess({ user: U, profile: { role: "admin" }, error: new Error("network") }))
      .toEqual({ allow: false, reason: "error" });
    expect(decideAdminAccess({ user: null, profile: null, error: { message: "PGRST116" } }))
      .toEqual({ allow: false, reason: "error" });
  });

  it("لا يوجد أي مدخل يُنتج allow=true بلا سجل دور مخوَّل", () => {
    const users = [null, undefined, U] as const;
    const profiles = [null, undefined, { role: null }, { role: "" }, { role: "customer" }, { role: "admin" }] as const;
    for (const user of users) for (const profile of profiles) for (const error of [null, undefined, "x"]) {
      const d = decideAdminAccess({ user: user as never, profile: profile as never, error });
      const shouldAllow = !!user && profile?.role === "admin" && !error;
      expect(d.allow).toBe(shouldAllow);
    }
  });
});

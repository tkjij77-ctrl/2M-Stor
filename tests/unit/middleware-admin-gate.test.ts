// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 🔒 T7.2 — middleware الفعلي، لا المنطق وحده.
 * نُقلّد @supabase/ssr لنحاكي الخادم في الحالات التي لا يمكن بلوغها بمتصفح بلا كلمة سر:
 *   • مستخدم مسجّل لكن **بلا صف في profiles**  ← الثغرة القديمة
 *   • مستخدم بدور customer
 *   • خطأ شبكة أثناء قراءة الدور
 *   • الدور السليم (admin/worker) ← يجب أن يمرّ
 */

type Scenario = {
  user: { id: string } | null;
  profileRow: { role?: string | null } | null;
  userError?: unknown;
  profileError?: unknown;
  throwOnGetUser?: boolean;
};

let scenario: Scenario;

const fromSpy = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        if (scenario.throwOnGetUser) throw new Error("boom");
        return { data: { user: scenario.user }, error: scenario.userError ?? null };
      },
    },
    from: (table: string) => {
      fromSpy(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: scenario.profileRow, error: scenario.profileError ?? null }),
        // ندعم .single() أيضًا حتى يعمل هذا الاختبار على النسخة القديمة والجديدة معًا
        // (وإلا صار «أحمر» بسبب نقص المحاكاة لا بسبب الثغرة)
        single: async () => ({ data: scenario.profileRow, error: scenario.profileError ?? null }),
      };
      return builder;
    },
  }),
}));

const { middleware } = await import("../../middleware.js");

function req(path = "/admin/dashboard") {
  return new NextRequest(`http://127.0.0.1:3100${path}`);
}
function blocked(res: Response) {
  // redirect = 307 وحقل location = "/" على الأصل نفسه
  return res.status >= 300 && res.status < 400 && new URL(res.headers.get("location")!).pathname === "/";
}

beforeEach(() => {
  fromSpy.mockClear();
  scenario = { user: { id: "u1" }, profileRow: { role: "admin" } };
});

const U = { id: "u1" };

describe("middleware /admin — الثغرة القديمة صارت حاجزًا", () => {
  it("بلا جلسة → تحويل إلى /", async () => {
    scenario = { user: null, profileRow: null };
    expect(blocked(await middleware(req()))).toBe(true);
  });

  it("مستخدم مسجّل بلا صف في profiles → تحويل (كان يمرّ قبل T7.2)", async () => {
    scenario = { user: U, profileRow: null };
    const res = await middleware(req("/admin/dashboard"));
    expect(blocked(res)).toBe(true);
    expect(fromSpy).toHaveBeenCalledWith("profiles");
  });

  it("دور customer → تحويل", async () => {
    scenario = { user: U, profileRow: { role: "customer" } };
    expect(blocked(await middleware(req("/admin")))).toBe(true);
  });

  it("خطأ في قراءة الدور → تحويل (فشل مغلق)", async () => {
    scenario = { user: U, profileRow: null, profileError: { message: "PGRST301" } };
    expect(blocked(await middleware(req()))).toBe(true);
  });

  it("استثناء من عميل Supabase → تحويل لا 500 ولا مرور", async () => {
    scenario = { user: U, profileRow: { role: "admin" }, throwOnGetUser: true };
    const res = await middleware(req());
    expect(blocked(res)).toBe(true);
  });

  it("token غير صالح (userError) → تحويل", async () => {
    scenario = { user: null, profileRow: null, userError: { message: "invalid JWT" } };
    expect(blocked(await middleware(req()))).toBe(true);
  });

  it.each(["admin", "worker"] as const)("دور %s يمرّ إلى اللوحة", async (role) => {
    scenario = { user: U, profileRow: { role } };
    const res = await middleware(req("/admin/dashboard"));
    expect(blocked(res)).toBe(false);
    expect(res.status).toBe(200);
  });

  it("لا تخزين مؤقت لصفحات الإدارة (سماحًا ومنعًا)", async () => {
    expect((await middleware(req())).headers.get("cache-control")).toBe("no-store");
    scenario = { user: null, profileRow: null };
    expect((await middleware(req())).headers.get("cache-control")).toBe("no-store");
  });

  it("الطلب يفحص الدور من profiles بالمعرّف الصحيح", async () => {
    await middleware(req());
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith("profiles");
  });
});

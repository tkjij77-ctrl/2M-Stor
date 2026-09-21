// ═══════════════════════════════════════════════════════════════════
//  ⚖️ T4.3 — اختبار المحتوى القانوني (T4.2/T4.3)
//  القاعدة التي نحميها بهذا الاختبار: **لا وعد لا ينفّذه النظام**.
//  كان في الموقع «إرجاع مجاني 14 يوم» بلا أي أساس — وهذا ما نمنعه.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  contactLines,
  privacySections,
  returnPolicyText,
  termsSections,
} from "@/lib/legal/policy";

describe("T4.3 — سياسة الإرجاع لا تَعِد بما لم يُحدَّد", () => {
  it("بلا إعدادات: تقول صراحة إنها غير محدَّدة (بدل اختراع مدة)", () => {
    const t = returnPolicyText({});
    expect(t).toContain("لم تُحدَّد");
    expect(t).not.toMatch(/\d+\s*(يوم|أيام)/);
  });

  it("0 يوم = غير محدَّدة (ليست «إرجاع في نفس اليوم»)", () => {
    const t = returnPolicyText({ returnDays: 0 });
    expect(t).toContain("لم تُحدَّد");
  });

  it("مدة محدَّدة: تظهر كما هي", () => {
    const t = returnPolicyText({ returnDays: 7 });
    expect(t).toContain("7 أيام");
    expect(t).toContain("بحالته الأصلية");
  });

  it("صياغة عربية سليمة: 1 · 2 · 14 (لا «14 أيام»)", () => {
    expect(returnPolicyText({ returnDays: 1 })).toContain("يوم واحد");
    expect(returnPolicyText({ returnDays: 2 })).toContain("يومان");
    expect(returnPolicyText({ returnDays: 14 })).toContain("14 يومًا");
    expect(returnPolicyText({ returnDays: 14 })).not.toContain("14 أيام");
    expect(returnPolicyText({ returnDays: 30 })).toContain("30 يومًا");
    expect(returnPolicyText({ returnDays: 120 })).toContain("120 يوم");
  });

  it("ملاحظة المالك تُضاف للمدة", () => {
    const t = returnPolicyText({ returnDays: 14, returnNote: "بشرط الفاتورة الأصلية" });
    expect(t).toContain("14 يومًا");
    expect(t).toContain("الفاتورة الأصلية");
  });

  it("ملاحظة فقط بلا مدة: تُعرض الملاحظة", () => {
    const t = returnPolicyText({ returnNote: "الاستبدال متاح فورًا" });
    expect(t).toContain("الاستبدال متاح فورًا");
  });

  it("لا تُظهر «14 يوم» كمدة افتراضية في أي حالة", () => {
    for (const info of [{}, { returnDays: 0 }, { store: "متجر" }]) {
      expect(returnPolicyText(info)).not.toContain("14 يوم");
    }
  });
});

describe("T4.2 — بيانات التواصل حقيقية فقط", () => {
  it("لا يظهر أي سطر تواصل بلا بيانات", () => {
    expect(contactLines({})).toHaveLength(0);
  });

  it("يظهر الهاتف والعنوان عند وجودهما", () => {
    const l = contactLines({ phone: "0123", address: "المنصورة" });
    expect(l.join(" ")).toContain("0123");
    expect(l.join(" ")).toContain("المنصورة");
  });

  it("لا يخترع بريدًا أو مدينة عند غيابها", () => {
    const l = contactLines({ phone: "0123" }).join(" ");
    expect(l).not.toContain("@");
    expect(l).not.toContain("الرياض");
  });
});

describe("T4.3 — الخصوصية مبنية على ما يفعله النظام", () => {
  it("تذكر أن البيانات تُقرأ بحسب الصلاحيات لا الواجهة", () => {
    const all = privacySections({}).map((s) => s.body).join(" ");
    expect(all).toContain("صلاحيات");
  });

  it("تذكر إيقاف إرسال الفاتورة لخدمة خارجية (T1.2)", () => {
    const all = privacySections({}).map((s) => s.body).join(" ");
    expect(all).toContain("خدمة خارجية");
  });

  it("لا تدّعي عدم جمع أي بيانات (النظام يجمع فواتير فعلًا)", () => {
    const all = privacySections({}).map((s) => s.body).join(" ");
    expect(all).toContain("الفواتير");
  });
});

describe("T4.3 — الشروط تتطابق مع سلوك النظام", () => {
  it("تذكر أن الشحن يظهر في السلة قبل التأكيد", () => {
    const all = termsSections({ store: "متجر الاختبار" }).map((s) => s.body).join(" ");
    expect(all).toContain("السلة");
    expect(all).toContain("قبل التأكيد");
  });

  it("تذكر أن الطلب يُسجَّل باسم العميل (وهو ما يفعله النظام)", () => {
    const all = termsSections({}).map((s) => s.body).join(" ");
    expect(all).toContain("يُسجَّل");
  });

  it("تستخدم اسم المتجر من الإعدادات", () => {
    const all = termsSections({ store: "متجر النور" }).map((s) => s.body).join(" ");
    expect(all).toContain("متجر النور");
  });
});

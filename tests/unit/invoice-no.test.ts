// ═══════════════════════════════════════════════════════════════════
//  T3.1 — اختبار اعتماد الرقم الرسمي للفاتورة (تطبيق Next)
//  الثغرة D1: الرقم كان محليًا في كل جهاز ⇒ جهازان يُنتجان «طلب #7».
//  الحل: التسلسل مركزي، والطابور يُثبّت الرقم الذي يُسنده السيرفر.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { adoptServerInvoiceNo } from "@/lib/sync/outbox";

type Order = { no: number; total: number; noTemp?: boolean; at?: string };

const ORDERS: Order[] = [
  { no: 7, total: 220, noTemp: true, at: "2026-09-21T10:00:00Z" },
  { no: 6, total: 100, at: "2026-09-21T09:00:00Z" },
];

describe("T3.1 — تثبيت الرقم الرسمي بعد الرفع", () => {
  it("يستبدل الرقم المؤقت بالرقم الذي أسنده السيرفر", () => {
    const out = adoptServerInvoiceNo(ORDERS, 7, 1042);
    expect(out[0].no).toBe(1042);
    expect(out[0].noTemp).toBe(false);
  });

  it("لا يمسّ بقية الطلبات (لا يُعيد ترقيم ما ليس مؤقتًا)", () => {
    const out = adoptServerInvoiceNo(ORDERS, 7, 1042);
    expect(out[1]).toEqual(ORDERS[1]);
  });

  it("لا يُغيّر شيئًا إن لم يوجد الطلب (رفع متأخر أو حُذف السجل)", () => {
    const out = adoptServerInvoiceNo(ORDERS, 999, 1042);
    expect(out).toEqual(ORDERS);
  });

  it("لا يفقد بقية الحقول عند الاستبدال", () => {
    const out = adoptServerInvoiceNo(ORDERS, 7, 1042);
    expect(out[0].total).toBe(220);
    expect(out[0].at).toBe("2026-09-21T10:00:00Z");
  });

  it("يتعامل مع سجل فارغ بلا انكسار", () => {
    expect(adoptServerInvoiceNo([], 1, 2)).toEqual([]);
  });
});

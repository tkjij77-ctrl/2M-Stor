// ═══════════════════════════════════════════════════════════════════
//  T2.5 — اختبار منطق سلة تطبيق Next.js
//  (كانت السلة useState([]) داخل مكوّن: تفقد كل شيء عند التحديث)
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const RULES = { shipping: 20, freeShip: 200, couponCode: "SAVE10", couponPct: 10, tax: 0, oversell: "warn" as const };

async function fresh() {
  vi.resetModules();
  store.clear();
  return await import("@/lib/cart/store");
}

const ITEM = (over: Partial<{ lid: string; n: string; price: number; available: number }> = {}) => ({
  lid: over.lid ?? "La",
  cid: 101,
  n: over.n ?? "منتج أ",
  price: over.price ?? 60,
  priceText: "60",
  catName: "قسم",
  available: over.available ?? 10,
});

describe("سلة Next — الإضافة والحدود", () => {
  it("تُضاف القطعة وتُحفظ (كانت تضيع عند التحديث)", async () => {
    const c = await fresh();
    c.addToCart(ITEM(), 2);
    expect(c.cartCount()).toBe(2);
    expect(JSON.parse(store.get("al_sayed_cart_next")!)).toHaveLength(1);
  });

  it("دمج الكميات لنفس الصنف بدل تكرار الأسطر", async () => {
    const c = await fresh();
    c.addToCart(ITEM(), 1);
    c.addToCart(ITEM(), 2);
    expect(c.getCart()).toHaveLength(1);
    expect(c.cartCount()).toBe(3);
  });

  it("🔒 لا تتجاوز الرصيد المتاح", async () => {
    const c = await fresh();
    const r = c.addToCart(ITEM({ available: 5 }), 9);
    expect(r.ok).toBe(true);
    expect(c.cartCount()).toBe(5);
    const r2 = c.addToCart(ITEM({ available: 5 }), 1);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain("5");
  });

  it("رفض صنف غير متوفر", async () => {
    const c = await fresh();
    const r = c.addToCart(ITEM({ available: 0 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("غير متوفر");
  });

  it("الإنقاص إلى صفر يحذف السطر", async () => {
    const c = await fresh();
    c.addToCart(ITEM(), 1);
    c.setQty("La", 0);
    expect(c.getCart()).toHaveLength(0);
  });

  it("سقف الكمية يُحترم عند التعديل اليدوي", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ available: 4 }), 1);
    c.setQty("La", 99);
    expect(c.cartCount()).toBe(4);
  });
});

describe("سلة Next — الحسابات (نفس قواعد التطبيق الرئيسي T3.5)", () => {
  it("المجموع الفرعي = السعر × الكمية", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 60 }), 2);
    expect(c.computeTotals(c.getCart(), RULES).subtotal).toBe(120);
  });

  it("الشحن يُضاف تحت حد الإعفاء", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 60 }), 1); // 60 < 200
    const t = c.computeTotals(c.getCart(), RULES);
    expect(t.shipping).toBe(20);
    expect(t.total).toBe(80);
  });

  it("الشحن مجاني فوق الحد", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 250 }), 1);
    const t = c.computeTotals(c.getCart(), RULES);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(250);
  });

  it("الكوبون الصحيح يخصم بالنسبة", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 100 }), 2); // 200
    const t = c.computeTotals(c.getCart(), RULES, "save10"); // حروف صغيرة
    expect(t.couponApplied).toBe(true);
    expect(t.discount).toBe(20);
    expect(t.total).toBe(180);
  });

  it("الكوبون الخاطئ لا يخصم شيئًا", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 100 }), 2);
    const t = c.computeTotals(c.getCart(), RULES, "WRONG");
    expect(t.discount).toBe(0);
    expect(t.total).toBe(200);
  });

  it("الضريبة على (الفرعي − الخصم) بلا الشحن — مطابقة للتطبيق الرئيسي", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 100 }), 1);            // فرعي 100 · شحن 20
    const t = c.computeTotals(c.getCart(), { ...RULES, couponCode: "", tax: 14 });
    expect(t.tax).toBe(14);                          // 100 × 14% — لا يدخل الشحن
    expect(t.total).toBe(134);                       // 100 + 14 + 20
  });

  it("الإعفاء من الشحن يُقاس قبل الخصم (مطابق للتطبيق الرئيسي)", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 100 }), 2);            // فرعي 200 = حد الإعفاء
    const t = c.computeTotals(c.getCart(), RULES, "SAVE10");
    expect(t.discount).toBe(20);
    expect(t.freeShip).toBe(true);                   // 200 ≥ 200 رغم الخصم
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(180);
  });

  it("قواعد افتراضية آمنة عند غياب الإعدادات (لا أرقام مخترعة)", async () => {
    const c = await fresh();
    c.addToCart(ITEM({ price: 50 }), 1);
    const t = c.computeTotals(c.getCart(), {});
    expect(t.subtotal).toBe(50);
    expect(t.shipping).toBe(20);   // الافتراضي المعلن
    expect(t.couponApplied).toBe(false);
  });

  it("لا شحن على سلة فارغة", async () => {
    const c = await fresh();
    expect(c.computeTotals([], RULES).shipping).toBe(0);
  });
});

describe("سلة Next — فحص الرصيد قبل الإتمام", () => {
  it("وضع «تنبيه»: يسمح مع تحذير", async () => {
    const c = await fresh();
    const lines = [{ lid: "La", name: "منتج", price: 10, qty: 9, maxQty: 3 }];
    const r = c.checkStock(lines, { oversell: "warn" });
    expect(r.short).toHaveLength(1);
    expect(r.blocking).toBe(false);
  });

  it("وضع «منع»: يمنع الإتمام", async () => {
    const c = await fresh();
    const lines = [{ lid: "La", name: "منتج", price: 10, qty: 9, maxQty: 3 }];
    const r = c.checkStock(lines, { oversell: "block" });
    expect(r.blocking).toBe(true);
  });

  it("رصيد كافٍ: لا تحذير ولا منع", async () => {
    const c = await fresh();
    const lines = [{ lid: "La", name: "منتج", price: 10, qty: 2, maxQty: 3 }];
    const r = c.checkStock(lines, { oversell: "block" });
    expect(r.short).toHaveLength(0);
    expect(r.blocking).toBe(false);
  });
});

export function genLid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function getQ(it: { q?: number }) { return it.q ?? 0; }
export function getQs(it: { qs?: number }) { return it.qs ?? 0; }
export function getMin(it: { min?: number }) { return it.min ?? 5; }
export function firstNum(s: string) {
  const m = String(s).match(/\d+([.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : 0;
}

// 🔒 SEC-1 (2026-11-07): أرقام المخزون لم تعد تُرسل لغير الموظف؛ الواجهة العامة
// تقرأ `items_public` الذي يعطي **حالة** المخزون لا جرده:
//   'out' ⇒ 0 · 'low' ⇒ العدد الحقيقي (≤3 وهو ما يُعرض أصلًا) · 'in' ⇒ سقف واسع.
// التحقق الحقيقي من الإتاحة يحدث على الخادم (place_store_order / decrement_stock).
export const GUEST_IN_QTY = 9999;
export function guestQty(
  state: string | null | undefined,
  lowQty: number | null | undefined
): number {
  if (state === "out") return 0;
  if (state === "low") return typeof lowQty === "number" ? lowQty : 3;
  return GUEST_IN_QTY;
}

/** حالة المخزون من رقمه — تُستخدم في مسار التوافق الخلفي فقط (قاعدة بلا SEC-1). */
export function stateFromQty(qs: number): "out" | "low" | "in" {
  if (!qs || qs <= 0) return "out";
  return qs <= 3 ? "low" : "in";
}

/** نص الإتاحة كما يراه غير الموظف — لا يكشف أرقام الجرد أبدًا. */
export function availabilityText(qs: number): string {
  if (!qs || qs <= 0) return "غير متوفر";
  if (qs >= GUEST_IN_QTY) return "متوفر ✅";
  return qs <= 3 ? `آخر ${qs} قطع` : "متوفر ✅";
}

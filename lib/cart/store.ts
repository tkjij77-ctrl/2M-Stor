// ═══════════════════════════════════════════════════════════════════
//  🛒 سلة تطبيق Next.js — منطق نقي (قابل للاختبار) + حفظ محلي
//
//  T2.5 (2026-09-21): كانت السلة `useState([])` داخل مكوّن واحد، أي:
//   • تختفي بمجرّد إعادة تحميل الصفحة
//   • صفحة /cart لا تراها إطلاقًا (كل مكوّن له حالته) → السلة كانت وهمية
//   الآن: مخزن واحد مشترك + حفظ في localStorage + إشعار للمكوّنات
// ═══════════════════════════════════════════════════════════════════

export type CartLine = {
  lid: string;          // المعرّف المحلي
  cid?: number | null;  // المعرّف السحابي (للخصم من المخزون)
  name: string;
  price: number;        // سعر الوحدة
  priceText?: string;   // النص الأصلي «100 - 150» للعرض
  qty: number;
  catName?: string;
  maxQty?: number;      // المتاح للبيع وقت الإضافة
};

export type SaleRules = {
  shipping: number;
  freeShip: number;
  couponCode: string;
  couponPct: number;
  tax: number;
  oversell: "warn" | "block";
};

export const DEFAULT_RULES: SaleRules = {
  shipping: 20,
  freeShip: 200,
  couponCode: "",
  couponPct: 0,
  tax: 0,
  oversell: "warn",
};

const KEY = "al_sayed_cart_next";
let lines: CartLine[] = [];
const listeners = new Set<() => void>();
let loaded = false;

// ⚠️ مهم: React يقارن مرجع المصفوفة (useSyncExternalStore). تعديل المصفوفة
// في مكانها يعطي نفس المرجع فلا تُعاد الرسم إطلاقًا. لذلك نحتفظ بنسخة
// «لقطة» جديدة بعد كل تغيير — وإلا لن تظهر الإضافة/الحذف إلا بعد تحديث الصفحة.
let snapshot: CartLine[] = [];

function sync() {
  snapshot = lines.map((l) => ({ ...l }));
}

function emit() {
  sync();
  listeners.forEach((l) => l());
}

/** يُقرأ من التخزين مرة واحدة — ثم يعتمد على الحالة في الذاكرة */
export function loadCart(): CartLine[] {
  if (loaded) return lines;
  loaded = true;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    lines = Array.isArray(parsed) ? parsed.filter(validLine) : [];
  } catch {
    lines = [];
  }
  sync();
  return snapshot;
}

function validLine(l: unknown): l is CartLine {
  const x = l as CartLine;
  return !!x && typeof x.lid === "string" && typeof x.name === "string" && Number(x.qty) > 0;
}

function persist() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
}

export function subscribeCart(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCart(): CartLine[] {
  return loadCart();
}

/** لقطة ثابتة المرجع — هي ما يقرأه React */
export function getCartSnapshot(): CartLine[] {
  loadCart();
  return snapshot;
}

/** إضافة للسلة — تدمج الكميات وتلتزم بالرصيد المتاح */
export function addToCart(
  item: { lid: string; cid?: number | null; n: string; price: number; priceText?: string; catName?: string; available?: number },
  qty = 1
): { ok: boolean; added: number; reason?: string } {
  loadCart();
  const available = Number.isFinite(item.available as number) ? (item.available as number) : Infinity;
  if (available <= 0) return { ok: false, added: 0, reason: "غير متوفر" };

  const existing = lines.find((l) => l.lid === item.lid);
  const currentQty = existing ? existing.qty : 0;
  const target = Math.min(currentQty + qty, available);
  const added = Math.max(0, target - currentQty);
  if (added === 0) return { ok: false, added: 0, reason: `المتاح ${available} فقط` };

  if (existing) {
    existing.qty = target;
    existing.maxQty = available;
  } else {
    lines.push({
      lid: item.lid,
      cid: item.cid ?? null,
      name: item.n,
      price: item.price,
      priceText: item.priceText,
      qty: target,
      catName: item.catName,
      maxQty: available,
    });
  }
  persist();
  emit();
  return { ok: true, added };
}

export function setQty(lid: string, qty: number) {
  loadCart();
  const line = lines.find((l) => l.lid === lid);
  if (!line) return;
  const cap = Number.isFinite(line.maxQty as number) ? (line.maxQty as number) : Infinity;
  const next = Math.max(0, Math.min(qty, cap));
  if (next === 0) lines = lines.filter((l) => l.lid !== lid);
  else line.qty = next;
  persist();
  emit();
}

export function removeFromCart(lid: string) {
  loadCart();
  lines = lines.filter((l) => l.lid !== lid);
  persist();
  emit();
}

export function clearCart() {
  lines = [];
  persist();
  emit();
}

export function cartCount(list: CartLine[] = getCart()): number {
  return list.reduce((n, l) => n + l.qty, 0);
}

export function cartSubtotal(list: CartLine[] = getCart()): number {
  return round2(list.reduce((s, l) => s + l.price * l.qty, 0));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * نفس قواعد التطبيق الرئيسي (T3.5): الشحن والكشف والضريبة من الإعدادات.
 * لا أرقام مكتوبة هنا — تُمرَّر القواعد من الإعدادات المحلية/السحابية.
 */
export function computeTotals(list: CartLine[], rules: Partial<SaleRules> = DEFAULT_RULES, couponInput = "") {
  const r = { ...DEFAULT_RULES, ...rules };
  const subtotal = cartSubtotal(list);

  const codeOk = r.couponCode && couponInput.trim().toUpperCase() === String(r.couponCode).toUpperCase();
  const discount = codeOk ? round2(subtotal * (Number(r.couponPct) || 0) / 100) : 0;
  const afterDiscount = round2(subtotal - discount);

  // ⚠️ التوافق مع التطبيق الرئيسي (index.html → cartTotals) إلزامي:
  //   • الإعفاء من الشحن يُقاس على المجموع الفرعي **قبل** الخصم
  //   • الضريبة على (الفرعي − الخصم) **بلا** الشحن
  // كان هذا مختلفًا → نفس السلة بسعرين في تطبيقين (نفس صنف مشكلة E5).
  const freeShip = Number(r.freeShip) > 0 && subtotal >= Number(r.freeShip);
  const shipping = list.length === 0 ? 0 : freeShip ? 0 : Number(r.shipping) || 0;

  const taxPct = Number(r.tax) || 0;
  const tax = round2((subtotal - discount) * taxPct / 100);

  return {
    subtotal,
    discount,
    afterDiscount,
    shipping,
    freeShip,
    couponApplied: !!codeOk,
    tax,
    // ⚠️ نفس صيغة index.html حرفيًا: afterDiscount + ضريبة + شحن
    total: round2(afterDiscount + tax + shipping),
    count: cartCount(list),
  };
}

/** فحص الرصيد قبل الإتمام — يمنع البيع بلا رصيد إن كان الإعداد «منع» */
export function checkStock(list: CartLine[], rules: Partial<SaleRules> = DEFAULT_RULES) {
  const r = { ...DEFAULT_RULES, ...rules };
  const short = list
    .filter((l) => Number.isFinite(l.maxQty as number) && l.qty > (l.maxQty as number))
    .map((l) => ({ name: l.name, want: l.qty, avail: l.maxQty as number }));
  return { short, blocking: r.oversell === "block" && short.length > 0 };
}

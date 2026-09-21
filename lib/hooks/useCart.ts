// ═══════════════════════════════════════════════════════════════════
//  🛒 ربط مخزن السلة بـ React + إرسال الطلب (T2.5)
// ═══════════════════════════════════════════════════════════════════
"use client";
import { useSyncExternalStore, useCallback, useEffect, useState } from "react";
import {
  addToCart, clearCart, getCartSnapshot, removeFromCart, setQty, subscribeCart,
  computeTotals, checkStock, type CartLine, type SaleRules, DEFAULT_RULES,
} from "@/lib/cart/store";
import { queue } from "@/lib/sync/outbox";
import { createClient } from "@/lib/supabase/client";
import type { StoreInfo } from "@/lib/legal/policy";

const EMPTY: CartLine[] = [];

export function useCart() {
  const list = useSyncExternalStore(subscribeCart, getCartSnapshot, () => EMPTY);
  return {
    lines: list,
    add: addToCart,
    setQty,
    remove: removeFromCart,
    clear: clearCart,
  };
}

/** قواعد البيع: من الإعدادات المحلية أولًا ثم السحابة (تسري على كل الأجهزة) */
export function useSaleRules(): SaleRules {
  const [rules, setRules] = useState<SaleRules>(DEFAULT_RULES);

  useEffect(() => {
    // 1) محليًا (نفس المتصفح قد يكون فيه إعدادات التطبيق الرئيسي)
    try {
      const raw = localStorage.getItem("al_sayed_settings");
      if (raw) {
        const s = JSON.parse(raw);
        setRules((r) => ({ ...r, ...mapSettings(s) }));
      }
    } catch {}

    // 2) من السحابة — هي المرجع عند اختلاف الأجهزة
    (async () => {
      try {
        const sb = createClient();
        const { data, error } = await sb.from("settings").select("key,value");
        if (error || !data) return;
        const obj: Record<string, string> = {};
        data.forEach((r: { key: string; value: string }) => (obj[r.key] = r.value));
        setRules((r) => ({ ...r, ...mapSettings(obj) }));
      } catch {}
    })();
  }, []);

  return rules;
}

/** 🏪 T4.2 + ⚖️ T4.3: بيانات المتجر المعروضة للزائر (وصف · تواصل · سياسة إرجاع) */
export function useStoreInfo(): StoreInfo {
  const [info, setInfo] = useState<StoreInfo>({});

  useEffect(() => {
    const apply = (obj: Record<string, unknown>) => {
      setInfo((prev) => ({
        ...prev,
        store: str(obj.store_name ?? obj.store) ?? prev.store,
        phone: str(obj.phone) ?? prev.phone,
        address: str(obj.address) ?? prev.address,
        desc: str(obj.store_desc ?? obj.desc) ?? prev.desc,
        returnDays: numOr(obj.return_days ?? obj.returnDays, prev.returnDays),
        returnNote: str(obj.return_note ?? obj.returnNote) ?? prev.returnNote,
      }));
    };
    try {
      const raw = localStorage.getItem("al_sayed_settings");
      if (raw) apply(JSON.parse(raw));
    } catch {}
    (async () => {
      try {
        const sb = createClient();
        const { data, error } = await sb.from("settings").select("key,value");
        if (error || !data) return;
        const obj: Record<string, unknown> = {};
        data.forEach((r: { key: string; value: string }) => (obj[r.key] = r.value));
        apply(obj);
      } catch {}
    })();
  }, []);

  return info;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function numOr(v: unknown, fallback?: number): number | undefined {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** مفاتيح السحابة (نفس ما يرفعه التطبيق الرئيسي في T3.5) */
function mapSettings(s: Record<string, unknown>): Partial<SaleRules> {
  const num = (v: unknown) => (Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : undefined);
  const out: Partial<SaleRules> = {};
  const shipping = num(s.shipping_fee ?? s.shipping);
  const freeShip = num(s.free_shipping_over ?? s.freeShip);
  const tax = num(s.tax_pct ?? s.tax);
  const couponPct = num(s.coupon_pct ?? s.couponPct);
  const couponCode = (s.coupon_code ?? s.couponCode) as string | undefined;
  const oversell = (s.oversell_policy ?? s.oversell) as SaleRules["oversell"] | undefined;
  if (shipping !== undefined) out.shipping = shipping;
  if (freeShip !== undefined) out.freeShip = freeShip;
  if (tax !== undefined) out.tax = tax;
  if (couponPct !== undefined) out.couponPct = couponPct;
  if (typeof couponCode === "string") out.couponCode = couponCode;
  if (oversell === "warn" || oversell === "block") out.oversell = oversell;
  return out;
}

export type CheckoutResult =
  | { ok: true; invoiceNo: number; totals: ReturnType<typeof computeTotals> }
  | { ok: false; reason: string };

let invoiceCounter = 0;

/**
 * إتمام الطلب: يُنشئ فاتورة (تُرفع للسحابة عبر الطابور) + يخصم المخزون.
 * لا يُفقد الطلب عند انقطاع الشبكة: يدخل الطابور ويُرفع عند العودة.
 */
export function useCheckout() {
  const rules = useSaleRules();
  const { lines, clear } = useCart();

  return useCallback(
    (opts: { customer: string; coupon?: string; signedIn: boolean }): CheckoutResult => {
      if (lines.length === 0) return { ok: false, reason: "السلة فارغة" };

      const stock = checkStock(lines, rules);
      if (stock.blocking) {
        return { ok: false, reason: "الرصيد غير كافٍ لـ: " + stock.short.map((s) => s.name).join(" · ") };
      }

      const totals = computeTotals(lines, rules, opts.coupon || "");
      if (!opts.customer.trim()) return { ok: false, reason: "اكتب اسم العميل" };

      // رقم الفاتورة: آخر رقم مستخدم على هذا الجهاز + 1 (الرقم النهائي يُصحّح
      // على السيرفر عبر assign_invoice_no عند التنفيذ على القاعدة)
      try {
        invoiceCounter = parseInt(localStorage.getItem("al_sayed_invno_next") || "0", 10) || 0;
      } catch {
        invoiceCounter = 0;
      }
      const no = invoiceCounter + 1;
      try {
        localStorage.setItem("al_sayed_invno_next", String(no));
      } catch {}

      const invoice = {
        no,
        // 🔢 T3.1: الرقم المحلي مؤقّت — التسلسل الرسمي مركزي على السيرفر
        // (assign_invoice_no يستبدله تلقائيًا إن كان محجوزًا على جهاز آخر)
        noTemp: true,
        customer: opts.customer.trim(),
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        status: "قيد المعالجة",
        stockApplied: "both",
        items: lines.map((l) => ({
          name: l.name,
          cat: l.catName ?? null,
          qty: l.qty,
          price: l.price,
        })),
      };

      // 1) الفاتورة في الطابور (يُرفع تلقائيًا + يُعاد عند الفشل)
      queue({ t: "inv-ins", lid: "N" + no + "-" + Date.now(), inv: invoice });

      // 2) خصم المخزون على السيرفر (ذرّي — لا يعتمد على بيانات قديمة في المتصفح)
      lines.forEach((l) => {
        if (l.cid) {
          queue({ t: "stock-dec", lid: l.lid, cid: l.cid, qty: l.qty, so: 1 });
        }
      });

      // 3) سجل محلي للطلبات حتى تظهر للعميل فورًا
      try {
        const hist = JSON.parse(localStorage.getItem("al_sayed_orders_next") || "[]");
        hist.unshift({ ...invoice, at: new Date().toISOString(), synced: opts.signedIn });
        localStorage.setItem("al_sayed_orders_next", JSON.stringify(hist.slice(0, 50)));
      } catch {}

      clear();
      return { ok: true, invoiceNo: no, totals };
    },
    [lines, rules, clear]
  );
}

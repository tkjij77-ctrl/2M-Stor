// أزرار «أضف للسلة» — تعمل فعلًا (كانت بلا أي onClick في T2.5)
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/hooks/useCart";
import { setQty } from "@/lib/cart/store";
import { getQ, getQs } from "@/lib/db/lid";
import type { DbItem } from "@/lib/db/types";

/** شريط كمية + إضافة — يُستخدم في بطاقة المتجر */
export function AddToCartBar({ item, catName }: { item: DbItem; catName?: string }) {
  const { lines, add } = useCart();
  const qty = lines.find((l) => l.lid === item.lid)?.qty ?? 0;
  const [msg, setMsg] = useState<string | null>(null);
  const available = Math.min(getQs(item), getQ(item));

  const onAdd = (d: number) => {
    if (d < 0) {
      setQty(item.lid, qty - 1);
      return;
    }
    const r = add(
      { lid: item.lid, cid: item.cid ?? null, n: item.n, price: item.pn ?? 0, priceText: item.p, catName, available },
      1
    );
    if (!r.ok) {
      setMsg(r.reason || "تعذّرت الإضافة");
      setTimeout(() => setMsg(null), 2500);
    }
  };

  if (qty > 0) {
    return (
      <div className="shop-cartbar">
        <button className="cart-step" onClick={() => onAdd(-1)} aria-label="إنقاص">−</button>
        <span className="cart-badge-icon">{qty}</span>
        <button className="cart-step" onClick={() => onAdd(1)} aria-label="زيادة">+</button>
      </div>
    );
  }

  return (
    <>
      <button className={`cart-add ${available <= 0 ? "disabled" : ""}`} disabled={available <= 0} onClick={() => onAdd(1)}>
        {available <= 0 ? "غير متوفر" : "إضافة للسلة"}
      </button>
      {msg && <div style={{ fontSize: "0.7rem", color: "var(--danger)", fontWeight: 800, textAlign: "center" }}>{msg}</div>}
    </>
  );
}

/** أزرار صفحة المنتج: «أضف للسلة» و«اشترِ الآن» — كلاهما حقيقي */
export function ProductActions({ item, catName }: { item: DbItem; catName?: string }) {
  const { add } = useCart();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const available = Math.min(getQs(item), getQ(item));

  const doAdd = (goToCart: boolean) => {
    const r = add(
      { lid: item.lid, cid: item.cid ?? null, n: item.n, price: item.pn ?? 0, priceText: item.p, catName, available },
      1
    );
    if (!r.ok) {
      setMsg(r.reason || "تعذّرت الإضافة");
      setTimeout(() => setMsg(null), 2500);
      return;
    }
    if (goToCart) router.push("/cart");
  };

  if (available <= 0) {
    return (
      <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--danger)", marginTop: 10 }}>
        ❌ غير متوفر حاليًا — راجع المتجر قريبًا
      </div>
    );
  }

  return (
    <>
      <button
        className="amz-btn-cart"
        style={{ width: "100%", background: "#FFD814", color: "#0F1111", border: "1px solid #FCD200", borderRadius: 50, padding: 12, fontWeight: 800, marginTop: 10, cursor: "pointer" }}
        onClick={() => doAdd(false)}
      >
        🛒 إضافة إلى السلة
      </button>
      <button
        className="amz-btn-buy"
        style={{ width: "100%", background: "#FFA41C", color: "#0F1111", border: "1px solid #FF8F00", borderRadius: 50, padding: 12, fontWeight: 800, marginTop: 8, cursor: "pointer" }}
        onClick={() => doAdd(true)}
      >
        ⚡ شراء الآن
      </button>
      {msg && <div style={{ fontSize: "0.72rem", color: "var(--danger)", fontWeight: 800, marginTop: 6 }}>{msg}</div>}
    </>
  );
}

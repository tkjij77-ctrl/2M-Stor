import type { DbItem } from "@/lib/db/types";
import { getQs } from "@/lib/db/lid";
import Link from "next/link";

export function ShopCard({ item, onAdd, qtyInCart }: { item: DbItem; onAdd: (qty:number)=>void; qtyInCart: number }) {
  const qs = getQs(item);
  const available = qs > 0;
  const href = `/product/${item.cid || item.lid}`;
  return (
    <div className="shop-card">
      <Link href={href} className="shop-img" style={{ textDecoration: "none" }}>{item.imgUrl ? <img src={item.imgUrl} alt={item.n} loading="lazy" decoding="async"/> : "🛍️"}</Link>
      <div className="shop-body">
        <Link href={href} style={{ textDecoration: "none", color: "inherit" }}><div className="shop-name">{item.n}</div></Link>
        <div className="shop-price">{item.p} <span>ج.م</span></div>
        <div className={`shop-avail ${available ? "ok" : "no"}`}>{available ? `متاح (${qs})` : "غير متوفر"}</div>
      </div>
      {qtyInCart > 0 ? (
        <div className="shop-cartbar">
          <button className="cart-step" onClick={() => onAdd(-1)}>−</button>
          <span className="cart-badge-icon">{qtyInCart}</span>
          <button className="cart-step" onClick={() => onAdd(1)}>+</button>
        </div>
      ) : (
        <button className={`cart-add ${!available ? "disabled" : ""}`} disabled={!available} onClick={() => onAdd(1)}>إضافة للسلة</button>
      )}
    </div>
  );
}

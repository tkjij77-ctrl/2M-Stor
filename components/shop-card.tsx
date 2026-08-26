import type { DbItem } from "@/lib/db/types";
import { getQs } from "@/lib/db/lid";

export function ShopCard({ item, onAdd, qtyInCart }: { item: DbItem; onAdd: (qty:number)=>void; qtyInCart: number }) {
  const qs = getQs(item);
  const available = qs > 0;
  return (
    <div className="shop-card">
      <div className="shop-img">{item.imgUrl ? <img src={item.imgUrl} alt={item.n}/> : "🛍️"}</div>
      <div className="shop-body">
        <div className="shop-name">{item.n}</div>
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

import type { DbItem } from "@/lib/db/types";
import { getQ, getQs } from "@/lib/db/lid";

export function ProductCard({ item, cat, onEdit }: { item: DbItem; cat: string; onEdit: () => void }) {
  const q = getQ(item), qs = getQs(item);
  return (
    <div className="product-card" onClick={onEdit}>
      <div className="stock-card-top">
        {item.imgUrl ? <img src={item.imgUrl} alt={item.n} className="card-thumb" /> : <div className="card-thumb card-thumb-fb">📦</div>}
        <div className="stock-card-info">
          <div className="product-name">{item.n} <span className="cat">{cat}</span></div>
          <div className="product-price">{item.p} <small>ج.م</small></div>
          <div className="stock-qs">معروض: {qs} · مخزن: {q}</div>
        </div>
      </div>
    </div>
  );
}

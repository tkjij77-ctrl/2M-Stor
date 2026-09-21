import type { DbItem } from "@/lib/db/types";
import { getQ, getQs } from "@/lib/db/lid";

export function ProductCard({ item, cat }: { item: DbItem; cat: string; onEdit?: () => void }) {
  const q = getQ(item), qs = getQs(item);
  const low = q <= (item.min ?? 0);
  return (
    <div className="product-card">
      <div className="stock-card-top">
        {item.imgUrl ? <img src={item.imgUrl} alt={item.n} className="card-thumb" /> : <div className="card-thumb card-thumb-fb">📦</div>}
        <div className="stock-card-info">
          <div className="product-name">{item.n} <span className="cat">{cat}</span></div>
          <div className="product-price">{item.p} <small>ج.م</small></div>
          <div className="stock-qs" style={{ color: low ? "var(--danger)" : undefined }}>
            معروض: {qs} · مخزن: {q}{low ? " ⚠️" : ""}
          </div>
        </div>
      </div>
      {/* ℹ️ التعديل يتم من التطبيق الرئيسي (index.html) — الذي يملك صلاحيات
          الكتابة الكاملة. هنا نعرض القراءة فقط بصدق بدل زر لا يفعل شيئًا. */}
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, marginTop: 6 }}>
        للتعديل: افتح تطبيق الإدارة
      </div>
    </div>
  );
}

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createClient();
  const { data: item } = await sb.from("items").select("*, categories(name)").eq("id", id).single();

  if (!item) return <main className="content"><p>المنتج غير موجود</p><Link href="/" className="btn btn-outline">رجوع للمتجر</Link></main>;

  const qs = item.display_qs ?? 0;
  const available = qs > 0;
  return (
    <main className="content" style={{ maxWidth: 480, margin: "0 auto" }}>
      <Link href="/" className="btn btn-outline" style={{ marginBottom: 12 }}>← رجوع</Link>
      <div className="product-detail-card" style={{ maxWidth: "100%" }}>
        <div className="product-detail-img">
          {item.image_url ? <img src={item.image_url} alt={item.name} loading="eager" /> : "📦"}
        </div>
        <div className="product-detail-body">
          <h1 className="product-detail-name">{item.name}</h1>
          <div className="product-detail-cat">📂 {(item as any).categories?.name || "—"} {item.barcode ? `· 🔳 ${item.barcode}` : ""}</div>
          <div className="product-detail-price">{item.price_text} <small>ج.م</small></div>
          <div className={`product-detail-avail ${available ? "ok" : "no"}`}>{available ? `✅ متاح: ${qs} قطعة` : "❌ غير متوفر"}</div>
          <div className="product-detail-info">
            📦 في المخزن: {item.stock_q} · 🏪 معروض: {qs} · ⚠️ تنبيه عند: {item.min_alert}<br />
            💰 قيمة المخزن: {(item.stock_q * Number(item.price_num || 0)).toFixed(2)} ج.م
          </div>
          <div className="product-detail-actions">
            <button className="btn btn-primary" disabled={!available}>🛒 إضافة للسلة</button>
            <Link href="/" className="btn btn-outline">إغلاق</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

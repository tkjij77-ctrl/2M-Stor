import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: item } = await sb.from("items").select("*, categories(name)").eq("id", id).single();
  if (!item) return <main className="content"><p>المنتج غير موجود</p><Link href="/" className="btn btn-outline">رجوع للمتجر</Link></main>;
  const qs = item.display_qs ?? 0;
  const available = qs > 0;
  // منتجات من نفس الصنف
  const { data: related } = await sb.from("items").select("id, name, price_text, display_qs, image_url").eq("category_id", item.category_id).neq("id", item.id).eq("deleted_at", null).limit(6);
  return (
    <main className="content" style={{ maxWidth: 860, margin: "0 auto", paddingBottom: 40 }}>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 12 }}>← رجوع للمتجر</Link>
      <div className="product-detail-card" style={{ maxWidth: "100%", minHeight: "auto", borderRadius: "18px", overflow:"hidden", border:"1px solid var(--border)" }}>
        <div className="product-detail-img" style={{height:380}}>
          {item.image_url ? <img src={item.image_url} alt={item.name} loading="eager" /> : "📦"}
        </div>
        <div className="product-detail-body">
          <h1 className="product-detail-name">{item.name}</h1>
          <div className="product-detail-cat">📂 {(item as any).categories?.name || "—"} {item.barcode ? `· 🔳 ${item.barcode}` : ""} · 🔢 #{item.id}</div>
          <div className="product-detail-price">{item.price_text} <small>ج.م</small> <small style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>/ رقمي {item.price_num}</small></div>
          <div className={`product-detail-avail ${available ? "ok" : "no"}`}>{available ? `✅ متاح: ${qs} قطعة` : "❌ غير متوفر"}</div>
          <div className="product-detail-info">
            📦 في المخزن: <b>{item.stock_q}</b> · 🏪 معروض: <b>{qs}</b> · ⚠️ تنبيه عند: <b>{item.min_alert}</b><br />
            💰 قيمة المخزن: <b>{(item.stock_q * Number(item.price_num || 0)).toFixed(2)} ج.م</b> · المعروض: <b>{(qs * Number(item.price_num || 0)).toFixed(2)} ج.م</b>
            {item.barcode && <><br />🔳 باركود: {item.barcode}</>}
          </div>
          <div className="product-detail-actions">
            <button className="btn btn-primary" disabled={!available}>🛒 إضافة للسلة</button>
            <Link href="/" className="btn btn-outline">إغلاق</Link>
          </div>
          {related && related.length>0 && (
            <>
              <div className="product-related-title">📦 منتجات من نفس الصنف — {(item as any).categories?.name}</div>
              <div className="product-related">
                {related.map((r:any)=>(
                  <Link key={r.id} href={`/product/${r.id}`} className="related-card" style={{textDecoration:"none", color:"inherit"}}>
                    <div className="related-card-img">{r.image_url ? <img src={r.image_url} alt={r.name} loading="lazy"/> : "📦"}</div>
                    <div className="related-card-body"><div className="related-card-name">{r.name}</div><div className="related-card-price">{r.price_text} ج.م</div><div style={{fontSize:"0.72rem", fontWeight:700, color: r.display_qs>0 ? "#00c9a7" : "#e5484d"}}>{r.display_qs>0 ? `✅ متاح ${r.display_qs}` : "❌ غير متوفر"}</div></div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

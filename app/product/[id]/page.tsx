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
    <main className="content" style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 40 }}>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 12 }}>← رجوع للمتجر</Link>
      <div style={{display:"grid", gridTemplateColumns:"380px 1fr 280px", gap:24}} className="amz-layout">
        <div className="amz-gallery" style={{position:"sticky", top:18}}>
          <div className="amz-main-img" style={{height:380, background:"var(--bg-soft)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", border:"1px solid var(--border)", overflow:"hidden"}}>
            {item.image_url ? <img src={item.image_url} alt={item.name} style={{width:"100%",height:"100%",objectFit:"contain", background:"#fff"}} /> : <span style={{fontSize:"4rem"}}>📦</span>}
          </div>
          <div className="amz-thumbs" style={{display:"flex", gap:8, marginTop:10, overflowX:"auto"}}>
            {[item, ...(related||[])].slice(0,5).map((t:any)=><div key={t.id} className="amz-thumb" style={{width:60,height:60,borderRadius:10, border:"2px solid var(--border)", overflow:"hidden", flexShrink:0, background:"var(--bg-soft)", display:"flex", alignItems:"center", justifyContent:"center"}}>{t.image_url ? <img src={t.image_url} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : "📦"}</div>)}
          </div>
        </div>
        <div>
          <h1 className="amz-title" style={{fontSize:"1.55rem", fontWeight:900}}>{item.name}</h1>
          <div className="amz-meta" style={{fontSize:"0.85rem", color:"var(--text-muted)", fontWeight:700}}>📂 {(item as any).categories?.name || "—"} · 🔢 #{item.id} {item.barcode ? `· 🔳 ${item.barcode}`: ""}</div>
          <div className="amz-rating" style={{color:"var(--gold)", fontSize:"0.9rem"}}>⭐⭐⭐⭐☆ <span style={{color:"var(--text-muted)", fontSize:"0.82rem"}}>4.3 ({(item.stock_q||0)+(qs||0)+7} تقييم)</span></div>
          <div className="amz-price" style={{fontSize:"2rem", fontWeight:900}}>{item.price_text} <small style={{fontSize:"0.85rem", color:"var(--text-muted)"}}>ج.م</small></div>
          <div style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>السعر يشمل الضريبة — شحن مجاني فوق 500 ج.م</div>
          <ul className="amz-bullets" style={{fontSize:"0.88rem", lineHeight:1.9, margin:"12px 0", paddingRight:18}}>
            <li>الصنف: <b>{(item as any).categories?.name}</b> — كود #{item.id}</li>
            <li>السعر الرقمي: <b>{item.price_num} ج.م</b> — النص: {item.price_text}</li>
            <li>المخزن: <b>{item.stock_q}</b> · المعروض: <b>{qs}</b></li>
          </ul>
          <div style={{fontSize:"0.75rem", color:"var(--text-muted)"}}>✅ إرجاع مجاني 14 يوم · 🔒 دفع آمن</div>
        </div>
        <div className="amz-buybox" style={{border:"1px solid var(--border)", borderRadius:14, padding:16, background:"var(--bg-card)", position:"sticky", top:18, boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:"1.6rem", fontWeight:900, color:"var(--primary)"}}>{item.price_text} <small>ج.م</small></div>
          <div style={{fontSize: "0.78rem", color:"var(--text-muted)"}}>+ مصاريف الشحن</div>
          <div style={{fontSize:"0.85rem", fontWeight:800, margin:"8px 0", color: available ? "#067D62" : "var(--danger)"}}>{available ? `✅ متاح — ${qs} قطعة` : "❌ غير متوفر"}</div>
          <div style={{fontSize:"0.75rem", color:"var(--text-muted)", display:"flex", gap:6}}>🔒 عملية شراء آمنة</div>
          <button className="amz-btn-cart" style={{width:"100%", background:"#FFD814", color:"#0F1111", border:"1px solid #FCD200", borderRadius:50, padding:12, fontWeight:800, marginTop:10}} disabled={!available}>🛒 إضافة إلى السلة</button>
          <button className="amz-btn-buy" style={{width:"100%", background:"#FFA41C", color:"#0F1111", border:"1px solid #FF8F00", borderRadius:50, padding:12, fontWeight:800, marginTop:8}} disabled={!available}>⚡ شراء الآن</button>
        </div>
      </div>
      {related && related.length>0 && (
        <div style={{marginTop:24}}>
          <div className="product-related-title">📦 منتجات من نفس الصنف — {(item as any).categories?.name}</div>
          <div className="product-related">
            {related.map((r:any)=>(
              <Link key={r.id} href={`/product/${r.id}`} className="related-card" style={{textDecoration:"none", color:"inherit"}}>
                <div className="related-card-img">{r.image_url ? <img src={r.image_url} alt={r.name} loading="lazy"/> : "📦"}</div>
                <div className="related-card-body"><div className="related-card-name">{r.name}</div><div className="related-card-price">{r.price_text} ج.م</div><div style={{fontSize:"0.72rem", fontWeight:700, color: r.display_qs>0 ? "#00c9a7" : "#e5484d"}}>{r.display_qs>0 ? `✅ متاح ${r.display_qs}` : "❌ غير متوفر"}</div></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

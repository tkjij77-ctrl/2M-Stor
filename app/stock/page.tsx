"use client";
import { useShop } from "@/lib/hooks/useShop";
import { ProductCard } from "@/components/product-card";
import { useState } from "react";

export default function StockPage(){
  const { items, loading } = useShop();
  const [q, setQ] = useState("");
  const filtered = items.filter(it => !q || it.n.toLowerCase().includes(q.toLowerCase()));
  return (
    <main className="content">
      <h1 className="section-title">📦 المخزن — {filtered.length} صنف</h1>
      <div className="search-row"><input placeholder="🔍 بحث..." value={q} onChange={e=>setQ(e.target.value)} /></div>
      {loading ? <p className="empty-state">⏳ تحميل...</p> : (
        <div className="product-grid">
          {filtered.map(it=> <ProductCard key={it.lid} item={it} cat={(it as any).catName||''} onEdit={()=>{}} />)}
        </div>
      )}
    </main>
  );
}

"use client";
import { useShop } from "@/lib/hooks/useShop";
import { ShopCard } from "@/components/shop-card";
import { useState } from "react";

export default function ShopPage() {
  const { items, loading } = useShop();
  const [cart, setCart] = useState<Record<string, number>>({});
  const onAdd = (lid: string, d: number) => setCart(c => ({ ...c, [lid]: Math.max(0, (c[lid] || 0) + d) }));
  return (
    <main className="content">
      <div className="view-tabs">
        <a href="/" className="view-tab active">🛍️ المتجر</a>
        <a href="/admin" className="view-tab">📦 المخزن</a>
      </div>
      {loading ? <p className="empty-state">⏳ جاري التحميل من السحابة...</p> : items.length === 0 ? <p className="empty-state">📭 لا توجد منتجات — افتح المخزن وأضف أصناف</p> : (
        <div className="shop-grid">
          {items.map(it => (
            <ShopCard key={it.lid} item={it} qtyInCart={cart[it.lid]||0} onAdd={(d)=>onAdd(it.lid,d)} />
          ))}
        </div>
      )}
      <p style={{textAlign:"center", fontSize:"0.75rem", color:"var(--text-muted)", marginTop:12}}>⚡ Realtime — أي تعديل من المدير يظهر فوراً</p>
    </main>
  );
}

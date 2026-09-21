"use client";
import { useShop } from "@/lib/hooks/useShop";
import { AddToCartBar } from "@/components/add-to-cart";
import Link from "next/link";
import { getQ, getQs } from "@/lib/db/lid";

export default function ShopPage() {
  const { items, loading } = useShop();

  return (
    <main className="content">
      <div className="view-tabs">
        <span className="view-tab active">🛍️ المتجر</span>
        <Link href="/stock" className="view-tab">📦 المخزن</Link>
        <Link href="/cart" className="view-tab">🛒 السلة</Link>
      </div>

      {loading ? (
        <p className="empty-state">⏳ جاري التحميل من السحابة...</p>
      ) : items.length === 0 ? (
        <p className="empty-state">📭 لا توجد منتجات — افتح المخزن وأضف أصناف</p>
      ) : (
        <div className="shop-grid">
          {items.map((it) => {
            const available = Math.min(getQs(it), getQ(it));
            const href = { pathname: "/product/[id]" as const, query: { id: String(it.cid || it.lid) } };
            return (
              <div className="shop-card" key={it.lid}>
                <Link href={href} className="shop-img" style={{ textDecoration: "none" }}>
                  {it.imgUrl ? <img src={it.imgUrl} alt={it.n} loading="lazy" decoding="async" /> : "🛍️"}
                </Link>
                <div className="shop-body">
                  <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="shop-name">{it.n}</div>
                  </Link>
                  <div className="shop-price">{it.p} <span>ج.م</span></div>
                  <div className={`shop-avail ${available > 0 ? "ok" : "no"}`}>
                    {available > 0 ? `متاح (${available})` : "غير متوفر"}
                  </div>
                </div>
                {/* 🛒 T2.5: كان الزر يعدّل حالة محلية داخل هذه الصفحة فقط —
                    تختفي عند التحديث ولا تراها صفحة السلة. الآن مخزن مشترك. */}
                <AddToCartBar item={it} catName={(it as { catName?: string }).catName} />
              </div>
            );
          })}
        </div>
      )}
      <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 12 }}>
        ⚡ أي تعديل من المدير يظهر فورًا على كل الأجهزة
      </p>
    </main>
  );
}

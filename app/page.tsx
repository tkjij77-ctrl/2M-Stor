import { ShopCard } from "@/components/shop-card";

// صفحة المتجر — كانت renderShopView:1423 في index.html
export default function ShopPage() {
  return (
    <main className="content">
      <div className="view-tabs">
        <a href="/" className="view-tab active">🛍️ المتجر</a>
        <a href="/admin" className="view-tab">📦 المخزن</a>
      </div>
      <div className="shop-grid">
        {/* تُملأ من useShop() hook الذي يستخدم lib/sync + IndexedDB */}
        <p className="empty-state">المتجر الاحترافي — يُحمّل من السحابة مباشرة (Realtime)</p>
      </div>
    </main>
  );
}

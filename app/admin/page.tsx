import Link from "next/link";
export default function AdminPage() {
  return (
    <main className="content">
      <h1 className="section-title">📦 لوحة الإدارة — محمية بـ RLS + middleware</h1>
      <div style={{display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", marginTop:16}}>
        <Link href="/stock" className="dash-card" style={{textDecoration:"none"}}><h3>📦 المخزن</h3><p style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>229 صنف — إدارة الكميات</p></Link>
        <Link href="/admin/dashboard" className="dash-card" style={{textDecoration:"none"}}><h3>📊 التقارير</h3><p style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>مبيعات وأكثر مبيعاً</p></Link>
        <Link href="/cart" className="dash-card" style={{textDecoration:"none"}}><h3>🛒 السلة</h3><p style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>سلة التسوق</p></Link>
      </div>
    </main>
  );
}

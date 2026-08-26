export default function AdminPage() {
  return (
    <main className="content">
      <h1 className="section-title">📦 لوحة الإدارة — محمية بـ RLS + middleware</h1>
      <p>هنا المخزن، الفواتير، لوحة التحكم. الوصول فقط لـ admin/worker (my_role check).</p>
    </main>
  );
}

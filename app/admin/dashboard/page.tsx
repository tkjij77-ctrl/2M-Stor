import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage(){
  type TopRow = { item_name: string; qty: number };
  let totalItems: number | null = null, lowItems: number | null = null, top: TopRow[] | null = null;
  try{
    const supabase = await createClient();
    // 🔒 SEC-2: العدّ من items_staff (إسقاط الموظف) لا من الجدول الخام المقفل.
    //    لغير الموظف تُرجع صفرًا بدل خطأ — وmiddleware يمنع الوصول أصلًا.
    const [t, l, tp] = await Promise.all([
      supabase.from("items_staff").select("*", {count:"exact", head:true}).is("deleted_at", null),
      supabase.from("items_staff").select("*", {count:"exact", head:true}).lte("stock_q", 5).is("deleted_at", null),
      supabase.from("invoice_items").select("item_name, qty").order("qty", {ascending:false}).limit(5)
    ]);
    totalItems = t.count; lowItems = l.count; top = (tp.data ?? []) as TopRow[];
  }catch{
    // 🔒 T7.2: لا أرقام ملفَّقة. كان السقوط يعرض 229/2 وكأنها بيانات حقيقية،
    //    فيُخفي أن RLS منعت القراءة. الآن null ← تُعرض «—».
    totalItems = null; lowItems = null; top = null;
  }
  return (
    <main className="content">
      <h1 className="section-title">📊 لوحة التحكم</h1>
      <div className="dash-stat-row">
        <div className="dash-stat"><div className="num">{totalItems ?? "—"}</div><div className="lbl">إجمالي الأصناف</div></div>
        <div className="dash-stat"><div className="num">{lowItems ?? "—"}</div><div className="lbl">على وشك النفاد</div></div>
        <div className="dash-stat"><div className="num">{top?.length ?? "—"}</div><div className="lbl">أكثر مبيعاً</div></div>
      </div>
      <div className="dash-card" style={{marginTop:16}}>
        <h3>🏆 الأكثر مبيعاً</h3>
        <div className="dash-top-list">
          {(top||[]).map((r,i)=><div key={i} className="dash-top-item"><span className="rank">{i+1}</span><span className="name">{r.item_name}</span><span className="val">{r.qty}</span></div>)}
          {(!top||top.length===0) && <p style={{fontSize:"0.85rem", color:"var(--text-muted)"}}>لا توجد مبيعات بعد</p>}
        </div>
      </div>
    </main>
  );
}

import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ProductActions } from "@/components/add-to-cart";
import { guestQty, stateFromQty } from "@/lib/db/lid";

// شكل الصف كما يعود من PostgREST (العميل غير مؤنَّع في هذه الصفحة)
// 🔒 SEC-1: الصفحة العامة تقرأ items_public (حالة مخزون لا أرقام جرد)
type ItemRow = {
  id: number; name: string; price_text: string; price_num: number;
  stock_state: "out" | "low" | "in" | null; low_qty: number | null;
  barcode: string | null; image_url: string | null; category_id: number | null;
  description: string | null; old_price: number | null;
};
type RelatedRow = { id: number; name: string; price_text: string; stock_state: string | null; low_qty: number | null; image_url: string | null };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const publicRes = await sb.from("items_public").select("*").eq("id", id).maybeSingle();
  const viewErr = publicRes.error;
  let rawItem = publicRes.data;
  // 🔁 توافق خلفي: قاعدة لم يُنفَّذ عليها SEC-1 بعد ⇒ نقرأ الجدول الخام (للقراءة فقط)
  if (viewErr) {
    const legacy = await sb.from("items").select("*").eq("id", id).maybeSingle();
    const lr = legacy.data as (ItemRow & { stock_q?: number; display_qs?: number }) | null;
    rawItem = lr
      ? ({ ...lr, stock_state: stateFromQty(lr.display_qs ?? 0), low_qty: (lr.display_qs ?? 0) > 0 && (lr.display_qs ?? 0) <= 3 ? lr.display_qs ?? null : null } as ItemRow)
      : null;
  }
  const item = rawItem as ItemRow | null;
  if (!item) return <main className="content"><p>المنتج غير موجود</p><Link href="/" className="btn btn-outline">رجوع للمتجر</Link></main>;
  // اسم القسم منفصلًا: الإسقاط ليس جدولًا، فلا علاقة تلقائية للـembed في PostgREST
  let catName: string | undefined;
  if (item.category_id) {
    const { data: cat } = await sb.from("categories").select("name").eq("id", item.category_id).maybeSingle();
    catName = (cat as { name?: string } | null)?.name ?? undefined;
  }
  const qs = guestQty(item.stock_state, item.low_qty);
  const available = qs > 0;

  // قواعد البيع من إعدادات المتجر (T3.5) — لا أرقام مكتوبة في الكود
  let r: { shipping?: number; freeShip?: number; tax?: number } = {};
  try {
    const { data: sets } = await sb.from("settings").select("key,value");
    const map: Record<string, string> = {};
    (sets || []).forEach((x: { key: string; value: string }) => (map[x.key] = x.value));
    const num = (k: string) => (Number.isFinite(parseFloat(map[k])) ? parseFloat(map[k]) : undefined);
    r = { shipping: num("shipping_fee"), freeShip: num("free_shipping_over"), tax: num("tax_pct") };
  } catch {}
  const shippingNote =
    r.freeShip && r.freeShip > 0
      ? `الشحن ${r.shipping ?? 0} ج.م — ومجاني للطلبات فوق ${r.freeShip} ج.م`
      : `الشحن ${r.shipping ?? 0} ج.م`;
  // منتجات من نفس الصنف
  let { data: rawRelated } = await sb.from("items_public").select("id, name, price_text, stock_state, low_qty, image_url").eq("category_id", item.category_id).neq("id", item.id).limit(6);
  if (!rawRelated) {
    const legacyRel = await sb.from("items").select("id, name, price_text, display_qs, image_url").eq("category_id", item.category_id).neq("id", item.id).eq("deleted_at", null).limit(6);
    rawRelated = (legacyRel.data ?? []).map((r) => {
      const lr = r as { id: number; name: string; price_text: string; display_qs: number | null; image_url: string | null };
      const qs = lr.display_qs ?? 0;
      return { id: lr.id, name: lr.name, price_text: lr.price_text, stock_state: stateFromQty(qs), low_qty: qs > 0 && qs <= 3 ? qs : null, image_url: lr.image_url };
    });
  }
  const related = (rawRelated ?? []) as RelatedRow[];
  return (
    <main className="content" style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 40 }}>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 12 }}>← رجوع للمتجر</Link>
      <div style={{display:"grid", gridTemplateColumns:"380px 1fr 280px", gap:24}} className="amz-layout">
        <div className="amz-gallery" style={{position:"sticky", top:18}}>
          <div className="amz-main-img" style={{height:380, background:"var(--bg-soft)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", border:"1px solid var(--border)", overflow:"hidden"}}>
            {item.image_url ? <img src={item.image_url} alt={item.name} style={{width:"100%",height:"100%",objectFit:"contain", background:"#fff"}} /> : <span style={{fontSize:"4rem"}}>📦</span>}
          </div>
          <div className="amz-thumbs" style={{display:"flex", gap:8, marginTop:10, overflowX:"auto"}}>
            {[item, ...related].slice(0,5).map((t)=><div key={t.id} className="amz-thumb" style={{width:60,height:60,borderRadius:10, border:"2px solid var(--border)", overflow:"hidden", flexShrink:0, background:"var(--bg-soft)", display:"flex", alignItems:"center", justifyContent:"center"}}>{t.image_url ? <img src={t.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : "📦"}</div>)}
          </div>
        </div>
        <div>
          <h1 className="amz-title" style={{fontSize:"1.55rem", fontWeight:900}}>{item.name}</h1>
          <div className="amz-meta" style={{fontSize:"0.85rem", color:"var(--text-muted)", fontWeight:700}}>📂 {catName || "—"} · 🔢 #{item.id} {item.barcode ? `· 🔳 ${item.barcode}`: ""}</div>
          {/* 🔴 T2.5: أُزيل تقييم مفبرك كان يُحسب من المخزون نفسه!
              «⭐⭐⭐⭐☆ 4.3 (X تقييم)» حيث X = stock + display + 7 — رقم لا علاقة له
              بأي تقييم حقيقي. لا نعرض تقييمات حتى تتوفر تقييمات فعلية من العملاء. */}
          {available && <div style={{fontSize:"0.82rem", fontWeight:800, color:"#067D62"}}>✅ متوفر في المخزن</div>}
          <div className="amz-price" style={{fontSize:"2rem", fontWeight:900}}>{item.price_text} <small style={{fontSize:"0.85rem", color:"var(--text-muted)"}}>ج.م</small></div>
          {/* 🔴 T2.5: كان مكتوبًا «شحن مجاني فوق 500» بينما التطبيق الرئيسي يستخدم
              قيمة من الإعدادات (200) — رقمين مختلفين في نفس المتجر (E5). */}
          <div style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>
            {shippingNote}
          </div>
          <ul className="amz-bullets" style={{fontSize:"0.88rem", lineHeight:1.9, margin:"12px 0", paddingRight:18}}>
            <li>الصنف: <b>{catName || "—"}</b> — كود #{item.id}</li>
            <li>السعر الرقمي: <b>{item.price_num} ج.م</b> — النص: {item.price_text}</li>
            {/* 🔒 SEC-1: لا أرقام جرد في الصفحة العامة — الحالة فقط */}
            <li>الإتاحة: <b>{available ? (qs <= 3 ? `آخر ${qs} قطع` : "متوفر") : "غير متوفر"}</b></li>
          </ul>
          {/* 🔴 T2.5: أُزيلت ادعاءات غير مؤكدة («إرجاع مجاني 14 يوم» · «دفع آمن»)
              لا سياسة إرجاع منشورة بعد (T4.3) ولا دفع أونلاين مفعّل (T4.4). */}
          <div style={{fontSize:"0.75rem", color:"var(--text-muted)"}}>💵 الدفع عند الاستلام — الطلب يُسجَّل ويُتواصل معك للتأكيد</div>
        </div>
        <div className="amz-buybox" style={{border:"1px solid var(--border)", borderRadius:14, padding:16, background:"var(--bg-card)", position:"sticky", top:18, boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:"1.6rem", fontWeight:900, color:"var(--primary)"}}>{item.price_text} <small>ج.م</small></div>
          <div style={{fontSize: "0.78rem", color:"var(--text-muted)"}}>+ مصاريف الشحن</div>
          <div style={{fontSize:"0.85rem", fontWeight:800, margin:"8px 0", color: available ? "#067D62" : "var(--danger)"}}>{available ? (qs <= 3 ? `✅ متاح — آخر ${qs} قطع` : "✅ متوفر") : "❌ غير متوفر"}</div>
          <div style={{fontSize:"0.75rem", color:"var(--text-muted)", display:"flex", gap:6}}>🔒 عملية شراء آمنة</div>
          <ProductActions
            item={{ n: item.name, p: item.price_text, pn: item.price_num, q: qs, qs: qs, min: 0,
                    b: item.barcode || "", img: item.image_url || "", imgUrl: item.image_url || "",
                    lid: String(item.id), cid: item.id }}
            catName={catName}
          />
        </div>
      </div>
      {related.length > 0 && (
        <div style={{marginTop:24}}>
          <div className="product-related-title">📦 منتجات من نفس الصنف — {catName || "—"}</div>
          <div className="product-related">
            {related.map((r)=>(
              <Link key={r.id} href={{ pathname: "/product/[id]", query: { id: String(r.id) } }} className="related-card" style={{textDecoration:"none", color:"inherit"}}>
                <div className="related-card-img">{r.image_url ? <img src={r.image_url} alt={r.name} loading="lazy"/> : "📦"}</div>
                <div className="related-card-body"><div className="related-card-name">{r.name}</div><div className="related-card-price">{r.price_text} ج.م</div><div style={{fontSize:"0.72rem", fontWeight:700, color: guestQty(r.stock_state, r.low_qty) > 0 ? "#00c9a7" : "#e5484d"}}>{guestQty(r.stock_state, r.low_qty) > 0 ? (guestQty(r.stock_state, r.low_qty) <= 3 ? `آخر ${guestQty(r.stock_state, r.low_qty)} قطع` : "✅ متاح") : "❌ غير متوفر"}</div></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

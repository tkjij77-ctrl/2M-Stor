// ═══════════════════════════════════════════════════════════════════
//  🛒 السلة — حقيقية (T2.5)
//  كانت: useState([]) فارغة للأبد. الآن: أسطر حقيقية · كميات · كوبون ·
//  شحن من الإعدادات · تسجيل دخول عند الحاجة · إتمام طلب بخصم مخزون.
// ═══════════════════════════════════════════════════════════════════
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCart, useCheckout, useSaleRules } from "@/lib/hooks/useCart";
import { computeTotals, checkStock } from "@/lib/cart/store";
import { createClient } from "@/lib/supabase/client";

type LocalOrder = {
  no: number; customer: string; total: number; at: string; synced: boolean;
  items: { name: string; qty: number; price: number }[];
};

export default function CartPage() {
  const { lines, setQty, remove } = useCart();
  const rules = useSaleRules();
  const checkout = useCheckout();

  const [customer, setCustomer] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: number; total: number } | null>(null);
  const [orders, setOrders] = useState<LocalOrder[]>([]);

  const totals = useMemo(() => computeTotals(lines, rules, coupon), [lines, rules, coupon]);
  const stock = useMemo(() => checkStock(lines, rules), [lines, rules]);

  // ── الجلسة الحالية + سجل الطلبات المحلي ──
  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const { data } = await sb.auth.getSession();
        setSignedIn(!!data.session);
      } catch {
        setSignedIn(false);
      }
    })();
    try {
      setOrders(JSON.parse(localStorage.getItem("al_sayed_orders_next") || "[]"));
      setCustomer(localStorage.getItem("al_sayed_last_customer") || "");
    } catch {}
  }, []);

  const applyCoupon = () => {
    const t = computeTotals(lines, rules, coupon);
    setCouponMsg(
      !rules.couponCode
        ? "ℹ️ لا يوجد كوبون مُفعّل حاليًا"
        : t.couponApplied
        ? `✅ تم تطبيق الكوبون — خصم ${t.discount.toLocaleString("en-EG")} ج.م`
        : coupon.trim()
        ? "❌ الكود غير صحيح"
        : "اكتب كود الخصم أولًا"
    );
  };

  const doLogin = async () => {
    setBusy(true);
    setLoginMsg(null);
    try {
      const sb = createClient();
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (error) {
        setLoginMsg(/Invalid login credentials/i.test(error.message) ? "الإيميل أو كلمة المرور غير صحيحة" : error.message);
      } else {
        setSignedIn(true);
        setLoginMsg("✅ تم تسجيل الدخول");
      }
    } catch (e) {
      setLoginMsg("تعذّر الاتصال — تحقق من الشبكة");
    }
    setBusy(false);
  };

  const confirm = () => {
    setLoginMsg(null);
    if (!signedIn) {
      setLoginMsg("🔒 إتمام الطلب يحتاج تسجيل دخول (نفس حسابك في التطبيق)");
      return;
    }
    const r = checkout({ customer, coupon, signedIn: true });
    if (!r.ok) {
      setLoginMsg("⚠️ " + r.reason);
      return;
    }
    try {
      localStorage.setItem("al_sayed_last_customer", customer.trim());
      setOrders(JSON.parse(localStorage.getItem("al_sayed_orders_next") || "[]"));
    } catch {}
    setDone({ no: r.invoiceNo, total: r.totals.total });
  };

  // ═══ تم الطلب ═══
  if (done) {
    return (
      <main className="content" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 18, padding: 26, boxShadow: "var(--shadow-sm)", textAlign: "center" }}>
          <div style={{ fontSize: "2.4rem" }}>✅</div>
          <h1 className="section-title" style={{ marginBottom: 6 }}>تم تسجيل الطلب #{String(done.no).padStart(4, "0")}</h1>
          <p style={{ fontWeight: 800, color: "var(--primary)", fontSize: "1.2rem" }}>{done.total.toLocaleString("en-EG")} ج.م</p>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 700 }}>
            الطلب في «قيد المعالجة» — يُرفع للسحابة تلقائيًا ويمكن متابعة حالته من التطبيق.
            لو انقطع النت، سيبقى في طابور المزامنة حتى تعود الشبكة.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
            <Link href="/" className="btn btn-primary">🛍️ متابعة التسوق</Link>
            <button className="btn btn-outline" onClick={() => setDone(null)}>🛒 سلة جديدة</button>
          </div>
        </div>
      </main>
    );
  }

  // ═══ سلة فارغة ═══
  if (lines.length === 0) {
    return (
      <main className="content">
        <p className="empty-state">🛒 السلة فارغة</p>
        {orders.length > 0 && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 900, marginBottom: 8 }}>🧾 طلباتك الأخيرة على هذا الجهاز</h3>
            {orders.slice(0, 5).map((o) => (
              <div key={o.at} className="user-row tight">
                <div>
                  <div style={{ fontWeight: 800 }}>طلب #{String(o.no).padStart(4, "0")} — {o.total.toLocaleString("en-EG")} ج.م</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700 }}>
                    {o.items.length} صنف · {new Date(o.at).toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {!o.synced && " · ⏳ لم يُرفع بعد (يحتاج دخول)"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <Link href="/" className="btn btn-primary">العودة للمتجر</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="content" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 className="section-title">🛒 السلة — {totals.count} قطعة</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 330px", gap: 18 }} className="cart-layout">
        {/* ── أسطر السلة ── */}
        <div>
          {lines.map((l) => (
            <div key={l.lid} className="user-row line">
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontWeight: 900 }}>{l.name}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700 }}>
                  {l.catName ? l.catName + " · " : ""}
                  {l.priceText || l.price} ج.م للقطعة
                  {l.maxQty !== undefined && ` · المتاح ${l.maxQty}`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn btn-outline" aria-label={`إنقاص ${l.name}`} style={{ padding: "4px 12px" }} onClick={() => setQty(l.lid, l.qty - 1)}>−</button>
                <b style={{ minWidth: 26, textAlign: "center" }}>{l.qty}</b>
                <button
                  className="btn btn-outline"
                  aria-label={`زيادة ${l.name}`}
                  style={{ padding: "4px 12px" }}
                  onClick={() => setQty(l.lid, l.qty + 1)}
                  disabled={l.maxQty !== undefined && l.qty >= l.maxQty}
                >
                  +
                </button>
                <b style={{ minWidth: 86, textAlign: "left", color: "var(--primary)" }}>{(l.price * l.qty).toLocaleString("en-EG")} ج.م</b>
                <button className="btn btn-outline" style={{ padding: "4px 10px", color: "var(--danger)", borderColor: "var(--danger)" }} aria-label={`حذف ${l.name}`} onClick={() => remove(l.lid)}>🗑️</button>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Link href="/" className="btn btn-outline">← متابعة التسوق</Link>
          </div>
        </div>

        {/* ── ملخص الطلب ── */}
        <aside style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, height: "fit-content", position: "sticky", top: 14, boxShadow: "var(--shadow-sm)" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 10 }}>🧾 ملخص الطلب</h3>

          <div className="sum-row"><span>المجموع الفرعي</span><b>{totals.subtotal.toLocaleString("en-EG")} ج.م</b></div>
          {totals.discount > 0 && <div className="sum-row" style={{ color: "var(--success)" }}><span>خصم الكوبون</span><b>− {totals.discount.toLocaleString("en-EG")} ج.م</b></div>}
          <div className="sum-row">
            <span>الشحن</span>
            <b>{totals.shipping === 0 ? "مجاني 🎉" : totals.shipping.toLocaleString("en-EG") + " ج.م"}</b>
          </div>
          {rules.freeShip > 0 && totals.shipping > 0 && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700 }}>
              الشحن مجاني فوق {rules.freeShip.toLocaleString("en-EG")} ج.م
            </div>
          )}
          {totals.tax > 0 && <div className="sum-row"><span>ضريبة {rules.tax}%</span><b>{totals.tax.toLocaleString("en-EG")} ج.م</b></div>}
          <div className="sum-row total">
            <span>الإجمالي</span>
            <b style={{ color: "var(--primary)" }}>{totals.total.toLocaleString("en-EG")} ج.م</b>
          </div>

          {/* الكوبون */}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <input
              placeholder={rules.couponCode ? `كود الخصم` : "لا يوجد كوبون مُفعّل"}
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
              style={inputStyle}
            />
            <button className="btn btn-outline" style={{ padding: "8px 14px" }} onClick={applyCoupon}>تطبيق</button>
          </div>
          {couponMsg && <div style={{ fontSize: "0.72rem", fontWeight: 800, marginTop: 6, color: couponMsg.startsWith("✅") ? "var(--success)" : "var(--text-muted)" }}>{couponMsg}</div>}

          {/* اسم العميل */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--text-muted)" }}>اسم العميل</label>
            <input placeholder="نقدي" value={customer} onChange={(e) => setCustomer(e.target.value)} style={inputStyle} />
          </div>

          {/* تحذير الرصيد */}
          {stock.short.length > 0 && (
            <div style={{ marginTop: 10, background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 10, padding: 10, fontSize: "0.74rem", fontWeight: 800, color: "var(--danger)" }}>
              ⚠️ رصيد غير كافٍ: {stock.short.map((s) => `${s.name} (مطلوب ${s.want} · متاح ${s.avail})`).join(" · ")}
              {stock.blocking && <div>⛔ الإعداد الحالي يمنع البيع بلا رصيد</div>}
            </div>
          )}

          {/* تسجيل الدخول عند الحاجة */}
          {signedIn === false && (
            <div style={{ marginTop: 12, background: "var(--bg-soft)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 800, marginBottom: 6 }}>🔒 لإتمام الطلب: سجّل الدخول</div>
              <input placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, marginBottom: 6, direction: "ltr", textAlign: "left" }} />
              <input type="password" placeholder="كلمة المرور" value={pass} onChange={(e) => setPass(e.target.value)} style={{ ...inputStyle, direction: "ltr", textAlign: "left" }} />
              <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={doLogin}>
                {busy ? "⏳ جاري الدخول..." : "🔓 تسجيل الدخول"}
              </button>
            </div>
          )}

          {loginMsg && <div style={{ fontSize: "0.74rem", fontWeight: 800, marginTop: 8, color: loginMsg.startsWith("✅") ? "var(--success)" : "var(--danger)" }}>{loginMsg}</div>}

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={stock.blocking || signedIn === false}
            onClick={confirm}
          >
            ✅ تأكيد الطلب — {totals.total.toLocaleString("en-EG")} ج.م
          </button>

          <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, marginTop: 8 }}>
            يُخصم المخزون تلقائيًا عند التأكيد · الإلغاء من التطبيق يُرجِع الكميات
          </p>
        </aside>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)",
  background: "var(--bg-body)", color: "var(--text-main)", fontWeight: 700, fontSize: "0.82rem",
};

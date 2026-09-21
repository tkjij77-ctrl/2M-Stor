// ═══════════════════════════════════════════════════════════════════
//  ⚖️ T4.3 — مكوّنات عرض المحتوى القانوني (تُستخدمه 3 صفحات)
//  المحتوى نفسه في lib/legal/policy.ts — بلا وعد لا ينفّذه النظام.
// ═══════════════════════════════════════════════════════════════════
"use client";

import Link from "next/link";
import { useStoreInfo } from "@/lib/hooks/useCart";
import {
  contactLines,
  privacySections,
  returnPolicyText,
  termsSections,
} from "@/lib/legal/policy";

function Shell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  const info = useStoreInfo();
  const contacts = contactLines(info);
  return (
    <main className="content" style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 className="section-title">{title}</h1>
      {intro && <p style={{ fontSize: "0.9rem", opacity: 0.85, marginBottom: 14 }}>{intro}</p>}
      <div style={{ fontSize: "0.92rem", lineHeight: 1.9 }}>{children}</div>

      {contacts.length > 0 && (
        <div className="user-row" style={{ marginTop: 16 }}>
          <b>تواصل معنا</b>
          <div style={{ marginTop: 6, fontSize: "0.88rem" }}>{contacts.join(" · ")}</div>
        </div>
      )}

      <p style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: 16 }}>
        آخر تحديث: {new Date().toISOString().slice(0, 10)} · هذا النص يشرح ما يفعله النظام فعليًا
      </p>
      <div style={{ marginTop: 14 }}>
        <Link href="/" className="btn btn-outline">← العودة للمتجر</Link>
      </div>
    </main>
  );
}

function Sections({ items }: { items: { title: string; body: string }[] }) {
  return (
    <>
      {items.map((s) => (
        <section key={s.title} style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 4 }}>{s.title}</h3>
          <p>{s.body}</p>
        </section>
      ))}
    </>
  );
}

export function PrivacyView() {
  const info = useStoreInfo();
  return (
    <Shell title="🔒 الخصوصية — ما نجمعه فعلًا">
      <Sections items={privacySections(info)} />
    </Shell>
  );
}

export function TermsView() {
  const info = useStoreInfo();
  return (
    <Shell title="📄 شروط الاستخدام">
      <Sections items={termsSections(info)} />
    </Shell>
  );
}

export function ReturnsView() {
  const info = useStoreInfo();
  const days = Number(info.returnDays) || 0;
  return (
    <Shell title="↩️ سياسة الإرجاع والاستبدال">
      <p style={{ fontWeight: 800 }}>{returnPolicyText(info)}</p>
      {days <= 0 && (
        <p style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 8 }}>
          (يحدّد هذه المدة صاحب المتجر من الإعدادات — لن نكتب مدة من عندنا)
        </p>
      )}
      <section style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 4 }}>كيف يُنفَّذ الإرجاع</h3>
        <p>
          بعد إلغاء الفاتورة في النظام <b>يُرجَع المخزون تلقائيًا</b> إلى الرصيد المعروض،
          فلا تبقى الكميات المُرْجَعة ناقصة من الجرد.
        </p>
      </section>
      <section>
        <h3 style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 4 }}>ما يُستثنى عادةً</h3>
        <p>الأصناف المستخدمة أو التالفة، والأصناف المقطوعة أو المصنّعة حسب الطلب — إلا إن كان بها عيب.</p>
      </section>
    </Shell>
  );
}

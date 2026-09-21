import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { CartBadge } from "@/components/cart-badge";

export const metadata: Metadata = {
  title: "2M-Stor — آل السيد",
  description: "نظام متكامل لإدارة المخزون والفواتير والمبيعات",
  manifest: "/manifest.json",
};

export const viewport = { themeColor: "#0ca678" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* ═══ رأس التطبيق (T2.4/T2.5) — كان الموقع بلا هيدر إطلاقًا ═══ */}
        <header className="app-header">
          <Link href="/" className="app-logo" style={{ textDecoration: "none", color: "inherit" }}>
            <span style={{ fontSize: "1.3rem" }}>🛍️</span>
            <span>2M-Stor</span>
          </Link>
          <nav className="app-nav">
            <Link href="/" className="app-nav-link">المتجر</Link>
            <Link href="/stock" className="app-nav-link">المخزن</Link>
            <Link href="/admin" className="app-nav-link">الإدارة</Link>
            <CartBadge />
          </nav>
        </header>
        {children}
        <footer className="app-footer">
          <span>آل السيد — نظام إدارة المخزون والمبيعات</span>
          <span style={{ opacity: 0.7 }}>· المزامنة تلقائية كل تعديل</span>
          {/* ⚖️ T4.3: روابط قانونية — كانت الصفحات غير موجودة إطلاقًا */}
          <span className="app-footer-links">
            <a href="/privacy">🔒 الخصوصية</a>
            <a href="/terms">📄 الشروط</a>
            <a href="/returns">↩️ الإرجاع</a>
          </span>
        </footer>
      </body>
    </html>
  );
}

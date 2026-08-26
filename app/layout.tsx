import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2M-Stor — آل السيد",
  description: "نظام متكامل لإدارة المخزون والفواتير والمبيعات",
  manifest: "/manifest.json",
  themeColor: "#0ca678",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

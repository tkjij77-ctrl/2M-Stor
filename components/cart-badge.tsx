// شارة السلة في الرأس — تتحدّث فورًا مع أي إضافة (T2.5)
"use client";
import Link from "next/link";
import { useCart } from "@/lib/hooks/useCart";
import { cartCount } from "@/lib/cart/store";

export function CartBadge() {
  const { lines } = useCart();
  const n = cartCount(lines);
  return (
    <Link
      href="/cart"
      aria-label="السلة"
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", gap: 8,
        textDecoration: "none", color: "inherit", fontWeight: 800,
      }}
    >
      <span style={{ fontSize: "1.15rem" }}>🛒</span>
      <span>السلة</span>
      {n > 0 && (
        <span
          style={{
            background: "var(--accent)", color: "#04262c", borderRadius: 50,
            minWidth: 22, height: 22, display: "inline-flex", alignItems: "center",
            justifyContent: "center", fontSize: "0.72rem", fontWeight: 900, padding: "0 6px",
          }}
        >
          {n}
        </span>
      )}
    </Link>
  );
}

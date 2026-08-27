"use client";
import { useState } from "react";
import Link from "next/link";

export default function CartPage(){
  const [cart] = useState<any[]>([]);
  if(cart.length===0) return <main className="content"><p className="empty-state">🛒 السلة فارغة</p><Link href="/" className="btn btn-primary">العودة للمتجر</Link></main>;
  return <main className="content"><h1>🛒 السلة</h1><p>{cart.length} منتج</p></main>;
}

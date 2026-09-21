"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getIDB, setIDB } from "@/lib/db/indexedDB";
import type { DbItem } from "@/lib/db/types";

// شكل الصف كما يعود من PostgREST مع العلاقة categories(name)
type ItemRow = {
  id: number; name: string; price_text: string; price_num: number;
  stock_q: number | null; display_qs: number | null; min_alert: number | null;
  barcode: string | null; image_url: string | null; updated_at: string;
  categories: { name?: string | null } | null;
};

export function useShop() {
  const [items, setItems] = useState<DbItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // ⚠️ العميل يُنشأ **داخل** الدوال لا في جسم المكوّن: جسم المكوّن يُنفَّذ
    // أثناء `next build` (تصيير مسبق) حيث لا متغيرات Next_PUBLIC_SUPABASE_*
    // ⇒ كان البناء يفشل بـ"Your project's URL and API key are required".
    const supabase = createClient();
    // حاول السحابة أولاً (NetworkFirst)
    try {
      const { data, error } = await supabase.from("items").select("*, categories(name)").eq("deleted_at", null).limit(40).order("updated_at", { ascending: false });
      if (!error && data) {
        const mapped: DbItem[] = (data as ItemRow[]).map((r) => ({
          n: r.name, p: r.price_text, pn: r.price_num, q: r.stock_q ?? 0, qs: r.display_qs ?? 0,
          min: r.min_alert ?? 0, b: r.barcode || "", img: r.image_url || "", imgUrl: r.image_url || "",
          lid: String(r.id), cid: r.id, _ts: r.updated_at, catName: r.categories?.name ?? undefined
        }));
        setItems(mapped);
        await setIDB("db", mapped).catch(()=>{});
        setLoading(false);
        return;
      }
    } catch {}
    // fallback IndexedDB
    try {
      const cached = await getIDB<DbItem[]>("db");
      if (cached) setItems(cached);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Realtime v3 — 11ms p99 (johal.in) — القناة تُبنى في المتصفح فقط
    const supabase = createClient();
    const ch = supabase.channel("al-sayed-live", { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, load)
      .on("system", { event: "disconnect" }, () => setTimeout(load, 1000 + Math.random()*2000))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { items, loading, reload: load };
}

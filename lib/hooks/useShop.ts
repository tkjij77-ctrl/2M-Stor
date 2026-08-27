"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getIDB, setIDB } from "@/lib/db/indexedDB";
import type { DbItem } from "@/lib/db/types";

export function useShop() {
  const [items, setItems] = useState<DbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    // حاول السحابة أولاً (NetworkFirst)
    try {
      const { data, error } = await supabase.from("items").select("*, categories(name)").eq("deleted_at", null).limit(40).order("updated_at", { ascending: false });
      if (!error && data) {
        const mapped: DbItem[] = data.map((r: any) => ({
          n: r.name, p: r.price_text, pn: r.price_num, q: r.stock_q, qs: r.display_qs,
          min: r.min_alert, b: r.barcode || "", img: r.image_url || "", imgUrl: r.image_url || "",
          lid: String(r.id), cid: r.id, _ts: r.updated_at, catName: r.categories?.name
        }));
        setItems(mapped);
        await setIDB("db", mapped as any).catch(()=>{});
        setLoading(false);
        return;
      }
    } catch {}
    // fallback IndexedDB
    try {
      const cached = await getIDB<any>("db");
      if (cached) setItems(cached);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Realtime v3 — 11ms p99 (johal.in)
    const ch = supabase.channel("al-sayed-live", { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, load)
      .on("system", { event: "disconnect" }, () => setTimeout(load, 1000 + Math.random()*2000))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { items, loading, reload: load };
}

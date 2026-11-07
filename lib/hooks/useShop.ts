"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getIDB, setIDB } from "@/lib/db/indexedDB";
import type { DbItem } from "@/lib/db/types";
import { guestQty, stateFromQty } from "@/lib/db/lid";

// شكل الصف كما يعود من PostgREST (items_public — إسقاط الزائر)
// 🔒 SEC-1 (2026-11-07): الواجهة العامة تقرأ `items_public` لا `items`، لأن
//    جدول items صار ممنوعًا على anon (فيه stock_q/display_qs/min_alert).
type PublicItemRow = {
  id: number; name: string; price_text: string; price_num: number;
  stock_state: "out" | "low" | "in" | null; low_qty: number | null;
  barcode: string | null; image_url: string | null; description: string | null;
  old_price: number | null; images: string[] | null; updated_at: string;
};

// شكل الصف الكامل (items_staff — للموظف فقط)
type StaffItemRow = {
  id: number; name: string; price_text: string; price_num: number;
  stock_q: number | null; display_qs: number | null; min_alert: number | null;
  barcode: string | null; image_url: string | null; updated_at: string;
  categories: { name?: string | null } | null;
};

// guestQty مُشتقّة في lib/db/lid.ts (دالة نقية تُستخدم في السيرفر والمتصفح)
export { guestQty };

/** صف كامل (items_staff) → شكل التطبيق الداخلي. */
function mapStaff(r: StaffItemRow): DbItem {
  return {
    n: r.name, p: r.price_text, pn: r.price_num, q: r.stock_q ?? 0, qs: r.display_qs ?? 0,
    min: r.min_alert ?? 0, b: r.barcode || "", img: r.image_url || "", imgUrl: r.image_url || "",
    lid: String(r.id), cid: r.id, _ts: r.updated_at, catName: r.categories?.name ?? undefined
  } as DbItem;
}

/** أي إسقاط نقرأ منه: الموظف يرى الأرقام، وغيره لا. */
export type ShopMode = "public" | "staff";

export function useShop(mode: ShopMode = "public") {
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
      let mapped: DbItem[] | null = null;
      if (mode === "staff") {
        const { data, error } = await supabase
          .from("items_staff").select("*, categories(name)")
          .limit(200).order("updated_at", { ascending: false });
        if (!error && data) {
          mapped = (data as StaffItemRow[]).map(mapStaff);
        } else if (error) {
          // 🔁 توافق خلفي: items_staff غير موجودة بعد ⇒ الجدول الخام (RLS يحميها للموظف)
          const legacy = await supabase.from("items").select("*")
            .is("deleted_at", null).limit(200).order("updated_at", { ascending: false });
          if (!legacy.error && legacy.data) mapped = (legacy.data as StaffItemRow[]).map(mapStaff);
        }
      } else {
        // 🔒 SEC-1: الواجهة العامة — بلا أرقام مخزون
        const { data, error } = await supabase
          .from("items_public").select("*")
          .limit(40).order("updated_at", { ascending: false });
        if (!error && data) {
          mapped = (data as PublicItemRow[]).map((r) => {
            const qs = guestQty(r.stock_state, r.low_qty);
            return {
              n: r.name, p: r.price_text, pn: r.price_num, q: qs, qs,
              min: 0, b: r.barcode || "", img: r.image_url || "", imgUrl: r.image_url || "",
              lid: String(r.id), cid: r.id, _ts: r.updated_at,
              desc: r.description ?? undefined, oldP: r.old_price ?? undefined
            } as DbItem;
          });
        } else if (error) {
          // 🔁 توافق خلفي: قاعدة لم يُنفَّذ عليها ترحيل SEC-1 بعد ⇒ نقرأ الجدول
          //    الخام ونشتق الحالة منه. الإصلاح الحقيقي يبقى على السيرفر.
          const legacy = await supabase
            .from("items").select("*").is("deleted_at", null)
            .limit(40).order("updated_at", { ascending: false });
          if (!legacy.error && legacy.data) {
            mapped = (legacy.data as StaffItemRow[]).map((r) => {
              const qs = guestQty(stateFromQty(r.display_qs ?? 0), r.display_qs ?? 0);
              return {
                n: r.name, p: r.price_text, pn: r.price_num, q: qs, qs,
                min: 0, b: r.barcode || "", img: r.image_url || "", imgUrl: r.image_url || "",
                lid: String(r.id), cid: r.id, _ts: r.updated_at,
                catName: r.categories?.name ?? undefined
              } as DbItem;
            });
          }
        }
      }
      if (mapped) {
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
  }, [mode]);

  useEffect(() => {
    load();
    // Realtime v3 — 11ms p99 (johal.in) — القناة تُبنى في المتصفح فقط
    const supabase = createClient();
    // 🔒 SEC-1: المتصفح العام لا يملك select على items (أرقام المخزون) —
    //    فيستمع لتغيّر الأقسام فقط، ويُحدَّث بالمقابل عبر `reload` عند الحاجة.
    const table = mode === "staff" ? "items" : "categories";
    const ch = supabase.channel("al-sayed-live", { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, load)
      .on("system", { event: "disconnect" }, () => setTimeout(load, 1000 + Math.random()*2000))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, mode]);

  return { items, loading, reload: load };
}

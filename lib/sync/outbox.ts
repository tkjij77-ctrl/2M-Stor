// كان queue/schedulePush/flushOutbox في index.html:3060-3210 — الآن module
import { createSupabaseClient } from "@/lib/supabase/client";
import type { DbItem, DbCategory } from "@/lib/db/types";
import { getQ, getQs, getMin, firstNum } from "@/lib/db/lid";

type Entry = { t: string; lid: string; catLid?: string; cid?: number; so?: number; key?: string; value?: string; ts: number };

let outbox: Entry[] = JSON.parse(typeof localStorage !== "undefined" ? localStorage.getItem("al_sayed_outbox") || "[]" : "[]");
let flushing = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function persist() { try { localStorage.setItem("al_sayed_outbox", JSON.stringify(outbox)); } catch {} }

export function queue(entry: Omit<Entry, "ts">) {
  outbox.push({ ...entry, ts: Date.now() });
  persist();
  schedulePush();
}
function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flushOutbox(), 500); // كان 1500 → 500
}
function itemPayload(it: DbItem, cat?: DbCategory | null) {
  return {
    category_id: cat?.cid ?? null,
    name: it.n,
    price_text: it.p,
    price_num: it.pn ?? firstNum(it.p),
    stock_q: getQ(it),
    display_qs: getQs(it),
    min_alert: getMin(it),
    barcode: it.b || null,
    image_url: it.imgUrl || null,
  };
}
export async function flushOutbox(db: DbCategory[]) {
  if (flushing || outbox.length === 0) return;
  const sb = createSupabaseClient();
  flushing = true;
  while (outbox.length > 0) {
    const e = outbox.shift()!;
    persist();
    try {
      // ... نفس منطق applyEntry:3106 لكن مجمع — للاختصار يستدعي upsert batch
      // التفاصيل الكاملة في docs/sync.md
      await applyEntry(e, db, sb);
    } catch {
      outbox.unshift(e);
      persist();
      flushing = false;
      return;
    }
  }
  flushing = false;
  persist();
  await pullAll(db);
}
async function applyEntry(e: Entry, db: DbCategory[], sb: ReturnType<typeof createSupabaseClient>) {
  // يحافظ على نفس سلوك index.html:3106-3184 مع دعم batch
  if (e.t === "item-ins" || e.t === "item-upd") {
    // compress image قبل الرفع (المرحلة 2)
  }
  throw new Error("not yet: applyEntry batch");
}
export async function pullAll(db: DbCategory[]) {
  const sb = createSupabaseClient();
  const [catsR, itemsR] = await Promise.all([
    sb.from("categories").select("*"),
    sb.from("items").select("*"),
  ]);
  // mergeCats/mergeItems كما في index.html:3238-3272 مع IndexedDB
}

// ═══════════════════════════════════════════════════════════════════
//  طابور المزامنة — تطبيق Next.js
//
//  🔄 T3.2 (2026-09-21): أُعيدت كتابته لأن النسخة السابقة كانت:
//   • تحذف نهائيًا (delete) في حين أن التطبيق الرئيسي صار يحذف ناعمًا (T3.4)
//     → العنصر المحذوف من Next كان يختفي نهائيًا ويصطدم بـ«سلة المحذوفات»
//   • تحتوي كتلة batch وهمية: تُبنى المصفوفة ثم لا يُفعل بها شيء
//   • تعلق الطابور للأبد عند أول خطأ (بلا محاولات ولا تصنيف ولا قائمة فشل)
//   • لا تعرف الفواتير إطلاقًا (inv-ins / inv-status)
//
//  السلوك الجديد: تصنيف الأخطاء (عابر/دائم) · عزل الفاشل فلا يعلّق الطابور
//  · إعادة محاولة بتأخير متزايد · تنظيف التكرار · سقف للطابور · دعم الفواتير.
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/client";
import type { DbItem, DbCategory } from "@/lib/db/types";
import { getQ, getQs, getMin, firstNum } from "@/lib/db/lid";
import { saveDB } from "@/lib/db/indexedDB";

// 🔢 T3.1: بعد رفع الطلب، السيرفر قد يُسند رقمًا رسميًا مختلفًا (لأن التسلسل
// مركزي وتصادم الأرقام المحلية بين الأجهزة وارد). نُثبّت الرقم في السجل
// المحلي حتى لا يبقى رقم مؤقت أمام العميل للأبد.
export function adoptServerInvoiceNo<T extends { no?: number; noTemp?: boolean }>(
  orders: T[],
  localNo: number,
  serverNo: number
): T[] {
  return orders.map((o) =>
    o.no === localNo ? { ...o, no: serverNo, noTemp: false } : o
  );
}

export type OutboxEntry = {
  t: string;
  lid: string;
  catLid?: string;
  cid?: number;
  so?: number;
  key?: string;
  value?: string;
  // ── للفواتير (inv-ins / inv-status) ──
  inv?: {
    no?: number;
    /** 🔢 T3.1: رقم مؤقت بانتظار التسلسل الرسمي على السيرفر */
    noTemp?: boolean;
    customer?: string;
    subtotal?: number;
    discount?: number;
    tax?: number;
    total?: number;
    status?: string;
    stockApplied?: string | false;
    items?: { name: string; cat?: string | null; qty: number; price: number }[];
  };
  status?: string;
  /** كمية الخصم من المخزون (stock-dec) */
  qty?: number;
  // ── إدارة الطابور ──
  id?: string;
  ts?: number;
  attempts?: number;
  lastError?: string;
  failedAt?: number;
};

const MAX_ATTEMPTS = 5;
const MAX_QUEUE = 800;

const read = <T,>(k: string, fb: T): T => {
  try {
    return typeof localStorage !== "undefined" ? (JSON.parse(localStorage.getItem(k) || "null") ?? fb) : fb;
  } catch {
    return fb;
  }
};

let outbox: OutboxEntry[] = read<OutboxEntry[]>("al_sayed_outbox", []);
let outboxFailed: OutboxEntry[] = read<OutboxEntry[]>("al_sayed_outbox_failed", []);
let flushing = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  try {
    localStorage.setItem("al_sayed_outbox", JSON.stringify(outbox));
    localStorage.setItem("al_sayed_outbox_failed", JSON.stringify(outboxFailed));
  } catch {}
}

/** مفتاح التكرار: العمليات التي تحمل «الحالة النهائية» يُستبدل الأقدم فيها */
function dedupeKey(e: OutboxEntry): string | null {
  if (e.t === "item-upd" || e.t === "item-ins") return "i:" + e.lid;
  if (e.t === "cat-upd" || e.t === "cat-ins") return "c:" + e.lid;
  if (e.t === "set") return "s:" + e.key;
  if (e.t === "inv-status") return "v:" + e.lid;
  // stock-dec لا يُدمج: كل خصم يمثّل قطعًا فعلية خرجت من المخزن
  return null; // الحذف والإدراج لا يُنظَّفان (ترتيبهم مهم)
}

export function queue(entry: Omit<OutboxEntry, "ts">) {
  const k = dedupeKey(entry as OutboxEntry);
  if (k) {
    for (let i = outbox.length - 1; i >= 0; i--) {
      if (dedupeKey(outbox[i]) === k && outbox[i].t === entry.t) outbox.splice(i, 1);
    }
  }
  outbox.push({ ...entry, ts: Date.now(), attempts: 0 });
  if (outbox.length > MAX_QUEUE) {
    const dropped = outbox.splice(0, outbox.length - MAX_QUEUE);
    outboxFailed.push(
      ...dropped.slice(0, 50).map((d) => ({ ...d, lastError: "تجاوز سقف الطابور" }))
    );
  }
  persist();
  schedulePush();
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flushOutbox(globalDb), 500);
}

let globalDb: DbCategory[] = [];
export function bindDB(db: DbCategory[]) {
  globalDb = db;
}

/** حالة الطابور — للعرض في الواجهة */
export function outboxStatus() {
  return {
    pending: outbox.length,
    failed: outboxFailed.length,
    failures: outboxFailed.map((f) => ({ op: describeEntry(f), error: f.lastError || "" })),
  };
}

/** حالة العطل: عابر (شبكة/سيرفر) أم دائم (خطأ في البيانات) */
export function classifyError(err: unknown): "transient" | "permanent" {
  const e = (err || {}) as { message?: string; code?: string | number; status?: number };
  const msg = String(e.message || err || "");
  const code = String(e.code ?? e.status ?? "");
  if (/Failed to fetch|NetworkError|network|timeout|timed out|fetch failed|Load failed|ERR_/i.test(msg))
    return "transient";
  if (/^5\d\d$/.test(code)) return "transient";
  if (code === "429") return "transient";
  if (/JWT|token|refresh|expired/i.test(msg)) return "transient";
  if (code === "23505" || /duplicate key|unique constraint/i.test(msg)) return "permanent";
  if (/column .* does not exist|could not find the .* column|schema cache/i.test(msg)) return "permanent";
  if (code === "23503" || /foreign key/i.test(msg)) return "permanent";
  if (code === "42P01" || /relation .* does not exist/i.test(msg)) return "permanent";
  if (/permission denied|violates row-level security|42501/i.test(msg)) return "permanent";
  return "permanent";
}

export function describeEntry(e: OutboxEntry): string {
  const names: Record<string, string> = {
    "cat-ins": "إضافة قسم",
    "cat-upd": "تعديل قسم",
    "cat-del": "حذف قسم",
    "item-ins": "إضافة صنف",
    "item-upd": "تعديل صنف",
    "item-del": "حذف صنف",
    "inv-ins": "فاتورة جديدة",
    "inv-status": "حالة طلب",
    "stock-dec": "خصم مخزون",
    set: "إعداد",
  };
  return (names[e.t] || e.t) + (e.key ? ` (${e.key})` : "");
}

/** تجاهل ما فشل نهائيًا (يُستدعى من الواجهة) */
export function clearFailed(): number {
  const n = outboxFailed.length;
  outboxFailed = [];
  persist();
  return n;
}

/** تفريغ الطابور بالكامل — يُستخدم عند تسجيل الخروج أو التصفير */
export function clearQueue(): void {
  outbox = [];
  outboxFailed = [];
  persist();
}

/** إعادة محاولة كل ما فشل (يُستدعى من الواجهة) */
export function retryFailed(): number {
  const n = outboxFailed.length;
  if (!n) return 0;
  outbox.push(
    ...outboxFailed.map((f) => {
      const c = { ...f, attempts: 0 };
      delete c.failedAt;
      delete c.lastError;
      return c;
    })
  );
  outboxFailed = [];
  persist();
  void flushOutbox(globalDb);
  return n;
}

function findLocalItem(lid: string, db: DbCategory[]) {
  for (const c of db) for (const it of c.items) if (it.lid === lid) return it;
  return null;
}
function findLocalCat(lid: string, db: DbCategory[]) {
  return db.find((c) => c.lid === lid) || null;
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
async function compressDataUrl(dataUrl: string) {
  if (typeof window === "undefined" || !dataUrl.startsWith("data:image")) return dataUrl;
  return new Promise<string>((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      let w = img.width,
        h = img.height,
        maxW = 1024;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
async function uploadImage(item: DbItem, sb: ReturnType<typeof createClient>) {
  if (!item.img || typeof window === "undefined") return null;
  try {
    let dataUrl = item.img;
    if (dataUrl.startsWith("data:image")) dataUrl = await compressDataUrl(dataUrl);
    const blob = await (await fetch(dataUrl)).blob();
    const path = item.lid + ".jpg";
    const { error } = await sb.storage
      .from("products")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) return null;
    return sb.storage.from("products").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

export async function flushOutbox(db: DbCategory[] = globalDb) {
  if (flushing || outbox.length === 0) return;
  const sb = createClient();
  flushing = true;
  while (outbox.length > 0) {
    const e = outbox.shift()!;
    persist();
    try {
      await applyEntry(e, db, sb);
      e.attempts = 0;
    } catch (err) {
      const kind = classifyError(err);
      e.attempts = (e.attempts || 0) + 1;
      e.lastError = String((err as Error)?.message || err).slice(0, 200);

      if (kind === "transient" && e.attempts < MAX_ATTEMPTS) {
        outbox.unshift(e); // عابر: نحفظ الترتيب ونعيد لاحقًا
        persist();
        break;
      }
      if (e.attempts >= MAX_ATTEMPTS || kind === "permanent") {
        // 🛑 لا يعلّق الطابور: يُعزل مع سبب واضح
        outboxFailed.push({ ...e, failedAt: Date.now() });
        if (outboxFailed.length > 100) outboxFailed = outboxFailed.slice(-100);
        persist();
      } else {
        outbox.push(e); // عابر مع محاولات متبقية → آخره ليكمل الباقي
      }
    }
  }
  flushing = false;
  persist();
  // إعادة محاولة تلقائية بتأخير متزايد
  if (outbox.length > 0) {
    const tries = Math.max(...outbox.map((x) => x.attempts || 0), 0);
    const delay = Math.min(60000, 3000 * Math.pow(2, tries));
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void flushOutbox(globalDb), delay);
  }
  await pullAll(db);
}

async function applyEntry(e: OutboxEntry, db: DbCategory[], sb: ReturnType<typeof createClient>) {
  if (e.t === "cat-ins") {
    const c = findLocalCat(e.lid, db);
    if (!c || c.cid) return;
    const { data, error } = await sb
      .from("categories")
      .insert({ name: c.name, sort_order: e.so || 0 })
      .select()
      .single();
    if (error) throw error;
    c.cid = data.id;
    c._ts = data.updated_at;
  } else if (e.t === "cat-upd") {
    const c = findLocalCat(e.lid, db);
    if (!c || !c.cid) return;
    const { error } = await sb.from("categories").update({ name: c.name }).eq("id", c.cid);
    if (error) throw error;
  } else if (e.t === "cat-del") {
    if (!e.cid) return;
    // 🔒 T3.4: حذف ناعم لا نهائي — يحفظ إمكانية الاستعادة
    const { error } = await sb
      .from("categories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", e.cid);
    if (error) throw error;
  } else if (e.t === "item-ins") {
    const it = findLocalItem(e.lid, db);
    if (!it || it.cid) return;
    const cat = findLocalCat(e.catLid || "", db);
    if (cat && !cat.cid && outbox.some((o) => o.t === "cat-ins" && o.lid === e.catLid)) {
      outbox.push(e);
      return;
    }
    if (it.img && !it.imgUrl) it.imgUrl = (await uploadImage(it, sb)) || it.imgUrl;
    const { data, error } = await sb.from("items").insert(itemPayload(it, cat)).select().single();
    if (error) throw error;
    it.cid = data.id;
    it._ts = data.updated_at;
  } else if (e.t === "item-upd") {
    const it = findLocalItem(e.lid, db);
    if (!it) return;
    if (!it.cid) {
      queue({ t: "item-ins", lid: it.lid, catLid: e.catLid });
      return;
    }
    const cat = findLocalCat(e.catLid || "", db);
    if (it.img && !it.imgUrl) it.imgUrl = (await uploadImage(it, sb)) || it.imgUrl;
    const { error } = await sb.from("items").update(itemPayload(it, cat)).eq("id", it.cid);
    if (error) throw error;
  } else if (e.t === "item-del") {
    if (!e.cid) return;
    // 🔒 T3.4: حذف ناعم — الصنف يبقى قابلًا للاستعادة من «سلة المحذوفات»
    const { error } = await sb
      .from("items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", e.cid);
    if (error) throw error;
  } else if (e.t === "inv-ins") {
    // 📄 دعم الفواتير (جاهز لسلة Next الحقيقية — T2.5)
    const v = e.inv;
    if (!v) return;
    // idempotency: فحص الرقم قبل الإدراج (نجاح جزئي سابق لا يُنشئ فاتورة مكرّرة)
    if (v.no) {
      const { data: exist } = await sb.from("invoices").select("id").eq("invoice_no", v.no).maybeSingle();
      if (exist && exist.id) {
        e.cid = exist.id;
        return;
      }
    }
    const { data, error } = await sb
      .from("invoices")
      .insert({
        invoice_no: v.no,
        customer_name: v.customer || "نقدي",
        subtotal: v.subtotal || 0,
        discount: v.discount || 0,
        tax: v.tax || 0,
        total: v.total || 0,
        status: v.status || "قيد المعالجة",
        stock_applied: v.stockApplied || null,
      })
      .select()
      .single();
    if (error) throw error;
    e.cid = data.id;
    // 🔢 T3.1: اعتماد الرقم الرسمي الذي أسنده السيرفر
    if (data.invoice_no && v.no && data.invoice_no !== v.no) {
      try {
        const orders = JSON.parse(localStorage.getItem("al_sayed_orders_next") || "[]");
        localStorage.setItem(
          "al_sayed_orders_next",
          JSON.stringify(adoptServerInvoiceNo(orders, v.no, data.invoice_no))
        );
      } catch {}
      v.no = data.invoice_no;
    }
    v.noTemp = false;
    if (v.items && v.items.length) {
      const rows = v.items.map((it) => ({
        invoice_id: data.id,
        item_name: it.name,
        category_name: it.cat ?? null,
        qty: it.qty,
        price: it.price,
      }));
      const { error: itemsErr } = await sb.from("invoice_items").insert(rows);
      if (itemsErr) throw itemsErr;
    }
  } else if (e.t === "inv-status") {
    if (!e.cid || !e.status) return;
    const { error } = await sb
      .from("invoices")
      .update({ status: e.status, updated_at: new Date().toISOString() })
      .eq("id", e.cid);
    if (error) {
      if (/column.*status/i.test(error.message || "")) return;
      throw error;
    }
  } else if (e.t === "stock-dec") {
    // 📦 T3.3/T2.5: خصم ذرّي على السيرفر (greatest(0, ...)) — لا يعتمد على
    // بيانات قديمة في المتصفح، ولا يمكن أن ينزل تحت الصفر.
    if (!e.cid || !e.qty) return;
    const { error } = await sb.rpc("decrement_stock", {
      p_item_id: e.cid,
      p_qty: e.qty,
      p_both: e.so === 1,
    });
    if (error) throw error;
  } else if (e.t === "set") {
    const { error } = await sb.from("settings").upsert({ key: e.key!, value: e.value! });
    if (error) throw error;
  }
}

export async function pullAll(db: DbCategory[]) {
  const sb = createClient();
  const [catsR, itemsR] = await Promise.all([sb.from("categories").select("*"), sb.from("items").select("*")]);
  if (catsR.error) throw catsR.error;
  if (itemsR.error) throw itemsR.error;
  // merge كما في index.html — مع استبعاد المحذوف ناعمًا (T3.4)
  const aliveCats = new Set(
    (catsR.data as { deleted_at?: string; id: number }[]).filter((r) => !r.deleted_at).map((r) => r.id)
  );
  for (let i = db.length - 1; i >= 0; i--)
    if (db[i].cid != null && !aliveCats.has(db[i].cid as number)) db.splice(i, 1);
  for (const rc of catsR.data as { id: number; name: string; deleted_at?: string; updated_at?: string }[]) {
    if (rc.deleted_at) continue;
    const lc = db.find((c) => c.cid === rc.id);
    if (!lc) {
      db.push({ name: rc.name, lid: "L" + rc.id, cid: rc.id, _ts: rc.updated_at, items: [] });
    } else if (rc.updated_at && (!lc._ts || rc.updated_at > lc._ts)) {
      lc.name = rc.name;
      lc._ts = rc.updated_at;
    }
  }
  const aliveItems = new Set(
    (itemsR.data as { deleted_at?: string; id: number }[]).filter((r) => !r.deleted_at).map((r) => r.id)
  );
  for (const c of db)
    for (let i = c.items.length - 1; i >= 0; i--)
      if (c.items[i].cid != null && !aliveItems.has(c.items[i].cid as number)) c.items.splice(i, 1);
  for (const ri of itemsR.data as {
    id: number;
    name: string;
    price_text: string;
    price_num: number;
    stock_q: number;
    display_qs: number;
    min_alert: number;
    barcode?: string;
    image_url?: string;
    category_id: number | null;
    deleted_at?: string;
    updated_at?: string;
  }[]) {
    if (ri.deleted_at) continue;
    let local: DbItem | null = null;
    for (const c of db) for (const it of c.items) if (it.cid === ri.id) local = it;
    if (!local) {
      const cat = db.find((c) => c.cid === ri.category_id);
      if (!cat) continue;
      cat.items.push({
        n: ri.name,
        p: ri.price_text,
        pn: ri.price_num,
        q: ri.stock_q,
        qs: ri.display_qs,
        min: ri.min_alert,
        b: ri.barcode || "",
        img: ri.image_url || "",
        imgUrl: ri.image_url || "",
        lid: "L" + ri.id,
        cid: ri.id,
        _ts: ri.updated_at,
      });
    } else if (ri.updated_at && (!local._ts || ri.updated_at > local._ts)) {
      local.n = ri.name;
      local.p = ri.price_text;
      local.pn = ri.price_num;
      local.q = ri.stock_q;
      local.qs = ri.display_qs;
    }
  }
  await saveDB(db);
}

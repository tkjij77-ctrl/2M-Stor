// ═══════════════════════════════════════════════════════════════════
//  T3.2 — اختبار طابور مزامنة تطبيق Next.js
//  يتحقق من: تصنيف الأخطاء · تنظيف التكرار · الحذف الناعم ·
//            دعم الفواتير (idempotent) · عزل الفاشل فلا يعلّق الطابور
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@/lib/db/types";

// ── بيئة مصغّرة: localStorage + عميل Supabase وهمي ──
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

type Row = Record<string, unknown>;
let calls: { table: string; op: string; payload?: Row | Row[] }[] = [];
let responder: (table: string, op: string, payload?: Row | Row[]) => { data?: unknown; error?: unknown } = () => ({
  data: { id: 1, updated_at: "t" },
  error: null,
});

// pullAll يجلب الأقسام والأصناف كمصفوفات — نضمن ذلك مهما كان المُجيب
const respond = (table: string, op: string, payload?: Row | Row[]) => {
  if (op === "select" && (table === "categories" || table === "items")) {
    const r = responder(table, op, payload);
    if (r && Array.isArray(r.data)) return r;
    return { data: [], error: null };
  }
  return responder(table, op, payload);
};

function fakeClient() {
  const chain = (table: string, op: string, payload?: Row | Row[]) => {
    calls.push({ table, op, payload });
    const res = respond(table, op, payload);
    // عميل مُقلَّد: كائن ثم (thenable) يحمل سلسلة PostgREST
    type Res = ReturnType<typeof respond>;
    type Chain = Promise<Res> & {
      select(): { single(): Promise<Res>; maybeSingle(): Promise<Res> };
      eq(): Chain;
      single(): Promise<Res>;
      maybeSingle(): Promise<Res>;
    };
    const p: Chain = Object.assign(Promise.resolve(res) as Promise<Res>, {
      select: () => ({ single: () => Promise.resolve(res), maybeSingle: () => Promise.resolve(res) }),
      single: () => Promise.resolve(res),
      maybeSingle: () => Promise.resolve(res),
      eq: () => p,
    });
    return p;
  };
  return {
    from: (table: string) => ({
      insert: (payload: Row | Row[]) => chain(table, "insert", payload),
      update: (payload: Row) => chain(table, "update", payload),
      select: () => chain(table, "select"),
      upsert: (payload: Row) => chain(table, "upsert", payload),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "u" } }),
      }),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({ createClient: () => fakeClient() }));
vi.mock("@/lib/db/indexedDB", () => ({ saveDB: async () => {} }));

import { queue, flushOutbox, classifyError, outboxStatus, retryFailed, clearQueue } from "@/lib/sync/outbox";

const DB = (): Db => [
  {
    name: "قسم",
    lid: "Lc1",
    cid: 1,
    _ts: "t",
    items: [{ n: "صنف", p: "10", pn: 10, q: 5, qs: 5, min: 1, b: "", img: "", lid: "La", cid: 101 }],
  },
];

beforeEach(() => {
  store.clear();
  calls = [];
  clearQueue();   // حالة الطابور في الذاكرة لا تُصفَّر مع localStorage
  responder = () => ({ data: { id: 1, updated_at: "t" }, error: null });
});

describe("تصنيف أخطاء المزامنة", () => {
  it("العابر: الشبكة والسيرفر وانتهاء الرمز", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe("transient");
    expect(classifyError({ code: "503", message: "unavailable" })).toBe("transient");
    expect(classifyError({ message: "JWT expired" })).toBe("transient");
  });

  it("الدائم: البيانات والسياسات", () => {
    expect(classifyError({ code: "23505", message: "duplicate key" })).toBe("permanent");
    expect(classifyError({ code: "42703", message: 'column "x" does not exist' })).toBe("permanent");
    expect(classifyError({ code: "42501", message: "permission denied" })).toBe("permanent");
  });
});

describe("طابور المزامنة", () => {
  it("ينظّف التعديلات المكرّرة على نفس الصنف", async () => {
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    expect(outboxStatus().pending).toBe(1);
  });

  it("يحذف ناعمًا (deleted_at) لا نهائيًا — لا تضيع البيانات", async () => {
    queue({ t: "item-del", lid: "La", cid: 101 });
    await flushOutbox(DB());
    const del = calls.find((c) => c.op === "update" && c.payload && "deleted_at" in c.payload);
    expect(del).toBeTruthy();
    expect(del!.table).toBe("items");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("يحذف القسم ناعمًا أيضًا (كان يمحو أصنافه بالتسلسل)", async () => {
    queue({ t: "cat-del", lid: "Lc1", cid: 1 });
    await flushOutbox(DB());
    const del = calls.find((c) => c.table === "categories" && c.op === "update");
    expect(del && "deleted_at" in (del.payload as Row)).toBe(true);
  });

  it("فاتورة: لا يُنشئ فاتورة مكرّرة إن كانت موجودة", async () => {
    responder = (table, op) => (op === "select" && table === "invoices" ? { data: { id: 777 }, error: null } : { data: null, error: null });
    queue({ t: "inv-ins", lid: "Lx", inv: { no: 42, total: 60, items: [{ name: "صنف", qty: 1, price: 60 }] } });
    await flushOutbox(DB());
    expect(calls.some((c) => c.table === "invoices" && c.op === "insert")).toBe(false);
  });

  it("فاتورة جديدة: تُدرَج مع أسطرها وحالة الخصم", async () => {
    responder = (table, op) => {
      if (op === "select") return { data: null, error: null };
      if (table === "invoices" && op === "insert") return { data: { id: 5, updated_at: "t" }, error: null };
      return { data: null, error: null };
    };
    queue({
      t: "inv-ins",
      lid: "Lx",
      inv: { no: 43, total: 60, status: "قيد المعالجة", stockApplied: "both", items: [{ name: "صنف", qty: 1, price: 60 }] },
    });
    await flushOutbox(DB());
    const inv = calls.find((c) => c.table === "invoices" && c.op === "insert");
    expect(inv).toBeTruthy();
    expect((inv!.payload as Row).stock_applied).toBe("both");
    const lines = calls.find((c) => c.table === "invoice_items" && c.op === "insert");
    expect(Array.isArray(lines!.payload)).toBe(true);
  });

  it("🔒 عملية فاشلة دائمًا لا تمنع تنفيذ ما بعدها (كانت تعلّق الطابور)", async () => {
    responder = (table, op) => {
      if (table === "items" && op === "update") return { error: { code: "42703", message: 'column "x" does not exist' } };
      return { data: { id: 9, updated_at: "t" }, error: null };
    };
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    queue({ t: "set", lid: "s1", key: "store_name", value: "متجري" });
    await flushOutbox(DB());
    expect(calls.some((c) => c.table === "settings" && c.op === "upsert")).toBe(true); // التالي نُفِّذ رغم فشل الأول
    const st = outboxStatus();
    expect(st.failed).toBe(1);            // الفاشل معزول ومُبلَّغ عنه
    expect(st.failures[0].error).toMatch(/does not exist/);
    expect(st.pending).toBe(0);           // لم يبقَ شيء معلّقًا
  });

  it("الفشل العابر يبقى في الطابور بانتظار المحاولة التالية", async () => {
    responder = (table, op) => (op === "update" ? { error: { message: "Failed to fetch" } } : { data: { id: 1, updated_at: "t" }, error: null });
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    await flushOutbox(DB());
    const st = outboxStatus();
    expect(st.pending).toBe(1);
    expect(st.failed).toBe(0);            // عابر ≠ فشل نهائي
  });

  it("«أعد المحاولة» تُرجع الفاشل للطابور", async () => {
    responder = (table, op) => (op === "update" ? { error: { code: "42703", message: 'column "x" does not exist' } } : { data: { id: 1, updated_at: "t" }, error: null });
    queue({ t: "item-upd", lid: "La", catLid: "Lc1" });
    await flushOutbox(DB());
    expect(outboxStatus().failed).toBe(1);

    // المستخدم أصلح السبب (كان عمودًا مفقودًا) → إعادة المحاولة تنجح
    responder = () => ({ data: { id: 1, updated_at: "t" }, error: null });
    expect(retryFailed()).toBe(1);
    await flushOutbox(DB());

    const st = outboxStatus();
    expect(st.pending).toBe(0);          // رُفعت فعلًا
    expect(st.failed).toBe(0);           // ولم تعد في قائمة الفشل
    expect(calls.some((c) => c.table === "items" && c.op === "update")).toBe(true);
  });
});

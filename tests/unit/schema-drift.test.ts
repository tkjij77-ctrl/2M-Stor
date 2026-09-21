// ═══════════════════════════════════════════════════════════════════
//  T3.7 — اختبارات فاحص انحراف المخطط
//
//  ما نحميه هنا: أن يبقى الفاحص نفسه صادقًا. الفاحص الذي يخطئ يصنع
//  ثقة كاذبة — وقد حدث فعلًا أثناء بنائه (ثلاثة أخطاء حقيقية):
//   1) `drop policy if exists "x" on t` لم يكن يُطابَق ⇒ سياسة محذوفة
//      كانت تبدو موجودة.
//   2) مقارنة المشغّلات بصدق القيمة لا بوجود المفتاح — وقيمة المشغّل
//      نص فارغ (كاذبة في JS) ⇒ كل المشغّلات بدت «ناقصة على القاعدة».
//   3) تمرير اسم الملف لم يكن يعمل ⇒ المقارنة تُستبدل بالفحص الذاتي صامتًا.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const drift = require("../../scripts/verify-schema-drift.js") as {
  parseSql: (sql: string) => Inv;
  parseInventoryText: (text: string) => { inv: Inv; lines: number; kinds: string[] };
  repoInventory: () => { inv: Inv; files: string[] };
  selfCheck: () => { results: { name: string; ok: boolean; detail: string }[]; inv: Inv; files: string[] };
  drift: (repo: Inv, live: Inv, label: string) => DriftRow[];
  emitMigration: (repo: Inv, live: Inv, file: string, label: string) => void;
};
const { parseSql, parseInventoryText, repoInventory, selfCheck } = drift;

type Inv = {
  tables: Record<string, string[]>;
  rls: Set<string>;
  indexes: Record<string, string>;
  policies: Record<string, { table: string; name: string; command: string; roles: string }>;
  functions: Record<string, { args: string }>;
  triggers: Record<string, string>;
  publications: Set<string>;
  buckets: Set<string>;
  // ⚠️ كان ناقصًا في هذا النوع بينما السكربت يُنتجه فعلًا ⇒ فشل tsc --noEmit
  raw: Record<string, string>;
};
type DriftRow = { kind: string; name: string; note: string };

// ── 1) التحليل ─────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "../..");

describe("تحليل SQL إلى جرد", () => {
  it("يستخرج الجداول وأعمدتها", () => {
    const inv = parseSql(`
      create table public.items (
        id bigint generated always as identity primary key,
        name text not null,
        price_num numeric(12,2) not null default 0,
        deleted_at timestamptz
      );
    `);
    expect(Object.keys(inv.tables)).toEqual(["items"]);
    expect(inv.tables.items).toContain("price_num");
    expect(inv.tables.items).toContain("deleted_at");
    expect(inv.tables.items).not.toContain("primary"); // قيد لا عمود
  });

  it("يستخرج السياسات وأوامرها وجدولها", () => {
    const inv = parseSql(`
      create policy "inv_update" on public.invoices
        for update using (public.my_role() = 'admin');
    `);
    const p = inv.policies["invoices.inv_update"];
    expect(p).toBeTruthy();
    expect(p.command).toBe("UPDATE");
    expect(p.table).toBe("invoices");
  });

  it("يحذف السياسة عند «drop policy if exists» (خطأ كان يكذب)", () => {
    const inv = parseSql(`
      create policy "products_auth_insert" on storage.objects for insert with check (true);
      drop policy if exists "products_auth_insert" on storage.objects;
    `);
    expect(Object.keys(inv.policies)).toEqual([]);
  });

  it("يحذف الفهرس عند «drop index»", () => {
    const inv = parseSql(`
      create index idx_old on public.items (name);
      drop index if exists idx_old;
    `);
    expect(inv.indexes.idx_old).toBeUndefined();
  });

  it("يتابع تفعيل/تعطيل RLS", () => {
    const inv = parseSql(`
      alter table public.items enable row level security;
      alter table public.audit_log enable row level security;
      alter table public.audit_log disable row level security;
    `);
    expect(inv.rls.has("items")).toBe(true);
    expect(inv.rls.has("audit_log")).toBe(false);
  });

  it("يفهم جداول Realtime المذكورة صراحةً ومصفوفة الحلقة", () => {
    const explicit = parseSql("alter publication supabase_realtime add table public.items;");
    expect(explicit.publications.has("items")).toBe(true);

    const loop = parseSql(`
      do $$
      declare t text;
        tables text[] := array['items', 'categories', 'settings', 'invoices'];
      begin
        foreach t in array tables loop
          execute format('alter publication supabase_realtime add table public.%I', t);
        end loop;
      end $$;
    `);
    expect([...loop.publications].sort()).toEqual(["categories", "invoices", "items", "settings"]);
    expect(loop.publications.has("public")).toBe(false); // ⚠️ %I ليست اسمًا
    expect(loop.publications.has("*")).toBe(false); // عرفنا الأسماء بالاسم
  });

  it("لا يخلط دلو التخزين بجدول", () => {
    const inv = parseSql(`
      insert into storage.buckets (id, name, public)
      values ('products', 'products', true)
      on conflict (id) do nothing;
    `);
    expect(inv.buckets.has("products")).toBe(true);
    expect(inv.tables.products).toBeUndefined();
  });

  it("يربط المشغّل بسكيما auth", () => {
    const inv = parseSql(`
      create trigger on_auth_user_created
        after insert on auth.users
        for each row execute function public.handle_new_user();
    `);
    expect(Object.keys(inv.triggers)).toContain("users.on_auth_user_created");
  });
});

// ── 2) الجرد النصي القادم من SQL Editor ─────────────────────────────
describe("قراءة الجرد النصي (kind|name|extra)", () => {
  it("يقرأ الأنواع كلها", () => {
    const { inv, lines } = parseInventoryText(
      [
        "table|items|",
        "column|price_num|items",
        "rls|items|",
        "index|idx_x|items",
        "policy|items_read|items",
        "function|my_role|",
        "trigger|items.trg_items_touch|",
        "publication|items|",
        "bucket|products|",
      ].join("\n")
    );
    expect(lines).toBe(9);
    expect(Object.keys(inv.tables)).toEqual(["items"]);
    expect(inv.policies["items.items_read"]).toBeTruthy();
    expect(inv.publications.has("items")).toBe(true);
    expect(inv.buckets.has("products")).toBe(true);
  });
});

// ── 3) المستودع نفسه ───────────────────────────────────────────────
describe("المستودع الحقيقي (T3.7)", () => {
  const { results, inv } = selfCheck();

  it("كل الفحوص الذاتية ناجحة", () => {
    const failed = results.filter((r: { name: string; ok: boolean; detail: string }) => !r.ok).map((r: { name: string; ok: boolean; detail: string }) => r.name + " → " + r.detail);
    expect(failed).toEqual([]);
  });

  it("ثمانية جداول وRLS على كلها", () => {
    expect(Object.keys(inv.tables).sort()).toEqual(
      ["audit_log", "categories", "invoice_items", "invoices", "items", "login_attempts", "profiles", "settings"]
    );
    for (const t of Object.keys(inv.tables)) expect(inv.rls.has(t)).toBe(true);
  });

  it("كل جدول عليه سياسة إلا login_attempts (استثناء موثَّق عن قصد)", () => {
    const withPolicy = new Set(Object.values(inv.policies).map((p: { table: string }) => p.table));
    const without = Object.keys(inv.tables).filter((t) => !withPolicy.has(t));
    // الفاحص يقبل هذا الاستثناء فقط لأنه مكتوب في docs/rls.md — لا لأنه مُدرَج في كود
    expect(without).toEqual(["login_attempts"]);
    const doc = fs.readFileSync(path.join(ROOT, "docs", "rls.md"), "utf8");
    expect(doc).toContain("login_attempts");
    expect(doc.toLowerCase()).toContain("revoke");
  });

  it("دوال القفل (F2) وقراءة الزائر (N-2) موجودة", () => {
    for (const f of ["login_gate", "login_fail", "login_ok", "public_settings"]) {
      expect(Object.keys(inv.functions)).toContain(f);
    }
  });

  it("دوال الترقيم والمخزون موجودة", () => {
    for (const f of ["next_invoice_no", "assign_invoice_no", "invoice_number_health",
                     "decrement_stock", "increment_stock", "restore_item", "soft_delete_item"]) {
      expect(inv.functions[f]).toBeTruthy();
    }
  });

  it("cloud-schema.sql لا يتباعد عن ترحيل الأساس (مرجع واحد لا مرجعان)", () => {
    const names = results.map((r) => r.name).join(" | ");
    expect(names).toContain("cloud-schema.sql مطابق لترحيل الأساس");
    expect(names).toContain("cloud-schema.sql يحذّر");
    const cloud = results.find((r) => r.name.includes("مطابق لترحيل الأساس"));
    expect(cloud?.ok).toBe(true);
  });

  it("الجداول الحيّة الأربعة مُفعَّل عليها Realtime في المستودع", () => {
    for (const t of ["items", "categories", "settings", "invoices"]) {
      expect(inv.publications.has(t)).toBe(true);
    }
  });
});

// ── 4) المقارنة مع القاعدة ─────────────────────────────────────────
const cleanInventory = () => {
  const { inv } = repoInventory();
  const L: string[] = [];
  for (const [t, cols] of Object.entries(inv.tables as Record<string, string[]>)) {
    L.push(`table|${t}|`);
    for (const c of cols) L.push(`column|${c}|${t}`);
  }
  for (const [n, t] of Object.entries(inv.indexes as Record<string, string>)) L.push(`index|${n}|${t}`);
  for (const p of Object.values(inv.policies as Record<string, { name: string; table: string }>)) {
    L.push(`policy|${p.name}|${p.table}`);
  }
  for (const f of Object.keys(inv.functions)) L.push(`function|${f}|`);
  for (const t of Object.keys(inv.triggers)) L.push(`trigger|${t}|`);
  for (const t of inv.publications) L.push(`publication|${t}|`);
  return L.join("\n");
};

describe("مقارنة المستودع بالقاعدة الحقيقية", () => {
  const { inv: repo } = repoInventory();

  it("جرد مطابق تمامًا ⇒ لا انحراف", () => {
    const live = parseInventoryText(cleanInventory()).inv;
    expect(drift.drift(repo, live, "اختبار")).toEqual([]);
  });

  it("يكشف كل نوع من الانحراف", () => {
    const live = parseInventoryText(
      cleanInventory()
        .split("\n")
        .filter((l) => l !== "policy|inv_delete|invoices") // ناقص على القاعدة
        .concat([
          "index|idx_items_barcode_manual|items",
          "policy|custom_report_read|invoices",
          "publication|invoice_items",
          "column|supplier_phone|items",
          "function|legacy_report_total|",
        ])
        .join("\n")
    ).inv;
    const rows = drift.drift(repo, live, "اختبار");
    const key = (r: DriftRow) => r.kind + ":" + r.name;
    expect(rows.map(key)).toContain("فهرس:idx_items_barcode_manual");
    expect(rows.map(key)).toContain("سياسة:invoices.custom_report_read");
    expect(rows.map(key)).toContain("عمود:items.supplier_phone");
    expect(rows.map(key)).toContain("دالة:legacy_report_total");
    expect(rows.map(key)).toContain("realtime:invoice_items");
    expect(rows.map(key)).toContain("سياسة:invoices.inv_delete");
    // الاتجاه: هذا على القاعدة وليس في المستودع (الأخطر)
    const missingInRepo = rows.find((r) => r.name === "idx_items_barcode_manual") as DriftRow;
    expect(missingInRepo.note).toContain("على القاعدة وليس في المستودع");
    // ⚠️ ولا تُبلَّغ المشغّلات كذبًا (قيمتها نص فارغ)
    expect(rows.some((r) => r.kind === "مشغّل")).toBe(false);
  });
});

// ── 5) مسوّدة الترحيل من نسخة pg_dump ──────────────────────────────
describe("إصدار مسوّدة ترحيل", () => {
  it("تنقل تعريفات ما على القاعدة وليس في المستودع", () => {
    const dumpText = `
      CREATE TABLE public.reports (id bigint, title text);
      CREATE INDEX idx_items_barcode_manual ON public.items USING btree (barcode);
      ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_items;
    `;
    const live = parseSql(dumpText);
    const file = path.join(os.tmpdir(), "t37-draft-" + Date.now() + ".sql");
    drift.emitMigration(repoInventory().inv, live, file, "dump.sql");
    const written = fs.readFileSync(file, "utf8");
    // المسوّدة **آمنة الإعادة**: تُضاف «if not exists» بلا تغيير حالة الأحرف
    // (قياسًا على خطأ حقيقي: إعادة كتابة الكلمة بحروف صغيرة كسرت هذا الفحص)
    expect(written).toMatch(/CREATE INDEX if not exists idx_items_barcode_manual/i);
    expect(written.toLowerCase()).toContain("create table if not exists public.reports");
    expect(written).toContain("alter publication supabase_realtime add table public.invoice_items;");
    expect(written).toContain("راجعها قبل الالتزام");
    fs.unlinkSync(file);
  });

  it("السياسة في المسوّدة تُسبَق بـdrop policy … on <جدول> (صياغة صحيحة)", () => {
    // خطأ حقيقي: `drop policy if exists x;` وحده **خطأ صياغة في PostgreSQL**،
    // كشفه تنفيذ المسوّدة فعلًا («syntax error at or near ;»)
    const live = parseSql(
      "create policy rogue_p on public.items for select using (true);"
    );
    const file = path.join(os.tmpdir(), "t37-draft-pol-" + Date.now() + ".sql");
    drift.emitMigration(repoInventory().inv, live, file, "dump.sql");
    const written = fs.readFileSync(file, "utf8");
    expect(written).toContain("drop policy if exists rogue_p on public.items;");
    expect(written).toContain("create policy rogue_p on public.items");
    fs.unlinkSync(file);
  });
});

// ── 6) عيوب حقيقية اكتشفها اختبار الدورة الكاملة ────────────────────
describe("دروس الدورة الكاملة (الترحيلات ← الجرد ← المقارنة)", () => {
  it("كل `add column` في العبارة تُقرأ — لا الأولى فقط", () => {
    // العطل: `exec` كان يلتقط أول `add column` في العبارة، فضاع updated_at
    // وكان يظهر للمستخدم «على القاعدة وليس في المستودع» كذبًا
    const inv = parseSql(
      "CREATE TABLE public.invoices (id bigint);\n" +
      "ALTER TABLE public.invoices \nADD COLUMN IF NOT EXISTS status text,\nADD COLUMN IF NOT EXISTS updated_at timestamptz;"
    );
    expect(inv.tables["invoices"]).toContain("status");
    expect(inv.tables["invoices"]).toContain("updated_at");
  });

  it("الجرد المُسبَّق بـpublic./storage. لا يُنتج فروقًا كاذبة", () => {
    const live = parseInventoryText(
      "table|public.items|\n" +
      "column|barcode|public.items\n" +
      "index|idx_items_cat|public.items\n" +
      "policy|items_read|public.items\n" +
      "policy|products_public_read|storage.objects\n" +
      "function|next_invoice_no|\n"
    ).inv;
    expect(Object.keys(live.tables)).toEqual(["items"]);
    expect(Object.keys(live.policies)).toEqual(["items.items_read", "objects.products_public_read"]);
    expect(live.indexes["idx_items_cat"]).toBe("items");
  });

  it("تعليق في أول العبارة لا يُبتلع داخل النص المحفوظ للمسوّدة", () => {
    // لو بقي التعليق في النص، صار السطر كله تعليقًا في المسوّدة ⇒ لا تُنفَّذ بصمت
    const inv = parseSql("-- شرح عربي\ncreate index idx_x on public.items(barcode);");
    expect(inv.raw["index:idx_x"]).toMatch(/^create index/i);
    expect(inv.raw["index:idx_x"]).not.toContain("--");
  });

  it("التعليق داخل نص حرفي لا يُحذف (وإلا تغيّر منطق السياسة)", () => {
    const inv = parseSql("create policy p_note on public.items for select using (name <> '--ملاحظة');");
    expect(Object.keys(inv.policies)).toEqual(["items.p_note"]);
    expect(inv.raw["policy:items.p_note"]).toContain("'--ملاحظة'");
  });
});

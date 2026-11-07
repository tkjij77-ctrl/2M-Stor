// ═══════════════════════════════════════════════════════════════════════════
//  🔒 SEC-2 (2026-11-07) — لا قراءة ولا كتابة مباشرة على جدول `items`
//
//  لماذا هذا الاختبار: بعد SEC-1 بقيت ثغرة واحدة — الحساب المسجَّل (عميل)
//  يستطيع قراءة `items?select=stock_q` لأنه يملك `select` على الجدول، وهو
//  ما يحتاجه **مسار الكتابة** (insert/update مع return=representation).
//  الحل: سحب كل صلاحية جدولية + نقل الكتابة إلى upsert_item/soft_delete_item.
//
//  هذا الملف يحرس ثلاث طبقات:
//   1) الترحيل: يسحب الصلاحيات فعلًا ويضع الحارس داخل الدالة (لا في المتصفح).
//   2) التطبيق الرئيسي (web/): يكتب عبر RPC، ويسقط للمسار القديم بأمان.
//   3) تطبيق Next (lib/sync): نفس السلوك — لا يبقى مسار كتابة مباشر.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const MIGRATION = "supabase/migrations/20261107100000_items_write_rpc.sql";

describe("SEC-2 — ترحيل الكتابة المحصورة", () => {
  const sql = existsSync(path.join(ROOT, MIGRATION)) ? read(MIGRATION) : "";

  it("الترحيل موجود", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
  });

  it("يعرّف upsert_item و archive_all_items", () => {
    expect(sql).toMatch(/create or replace function public\.upsert_item\(p jsonb\)/i);
    expect(sql).toMatch(/create or replace function public\.archive_all_items\(\)/i);
  });

  it("الدالتان security definer ومحميتان بـis_staff", () => {
    const upsert = sql.split(/create or replace function public\.upsert_item/i)[1]?.split("$$;")[0] ?? "";
    expect(upsert).toMatch(/security definer/i);
    expect(upsert).toMatch(/set search_path = public/i);
    expect(upsert).toMatch(/if not public\.is_staff\(\) then/i);
    const archive = sql.split(/create or replace function public\.archive_all_items/i)[1]?.split("$$;")[0] ?? "";
    expect(archive).toMatch(/if not public\.is_staff\(\) then/i);
  });

  it("ترفض المدخلات غير الصالحة على السيرفر", () => {
    expect(sql).toMatch(/اسم الصنف مطلوب/i);
    expect(sql).toMatch(/السعر لا يكون سالبًا/i);
    expect(sql).toMatch(/الكميات لا تكون سالبة/i);
  });

  it("تسحب select/insert/update/delete من anon و authenticated معًا", () => {
    expect(sql).toMatch(/revoke select, insert, update, delete on public\.items from anon, authenticated/i);
  });

  it("تحتفظ بمقروئية الإسقاطين (وإلا انكسر المتجر والكاشير)", () => {
    expect(sql).toMatch(/has_table_privilege\('anon', 'public\.items_public', 'select'\)/);
    expect(sql).toMatch(/has_table_privilege\('authenticated', 'public\.items_staff', 'select'\)/);
  });
});

describe("SEC-2 — التطبيق الرئيسي يكتب عبر الدوال", () => {
  const cloud = read("web/cloud.js");

  it("لا يوجد insert/update مباشر على items في مسار الدفع", () => {
    // المسار القديم مسموح فقط داخل دالة السقوط (توافق خلفي) — لا في flushOutbox
    const flush = cloud.split("async function flushOutbox")[1]?.split("function ")[0] ?? "";
    expect(flush.length).toBeGreaterThan(100);
    expect(flush).not.toMatch(/from\('items'\)\.insert/);
    expect(flush).not.toMatch(/from\('items'\)\s*\.update/);
  });

  it("تستدعي upsert_item و soft_delete_item و archive_all_items", () => {
    expect(cloud).toMatch(/rpc\('upsert_item'/);
    expect(cloud).toMatch(/rpc\('soft_delete_item'/);
    expect(cloud).toMatch(/rpc\('archive_all_items'\)/);
  });

  it("تسقط للمسار القديم عند غياب الدالة (PGRST202) — نشر بلا تعطيل", () => {
    expect(cloud).toMatch(/function rpcMissing/);
    expect(cloud).toMatch(/PGRST202/);
  });

  it("الاستعادة من سلة المحذوفات تمر بدالة محصورة (مدير فقط)", () => {
    const ui = read("web/ui.js");
    expect(ui).toMatch(/rpc\(fn, \{ p_id: id \}\)/);
    expect(ui).toMatch(/restore_item/);
    expect(ui).toMatch(/restore_category/);
  });

  it("قراءة سلة المحذوفات من items_staff لا من الجدول الخام", () => {
    const ui = read("web/ui.js");
    expect(ui).toMatch(/from\('items_staff'\)/);
  });
});

describe("SEC-2 — نسخة Next لا تكتب على الجدول مباشرة", () => {
  const outbox = read("lib/sync/outbox.ts");

  it("تستخدم upsert_item و soft_delete_item", () => {
    expect(outbox).toMatch(/rpc\("upsert_item"/);
    expect(outbox).toMatch(/rpc\("soft_delete_item"/);
  });

  it("مسار flush لا يحتوي إدراجًا/تحديثًا مباشرًا على items", () => {
    const head = outbox.split("function rpcMissing")[0] ?? "";
    const tail = outbox.split("function rpcMissing")[1] ?? "";
    // المسار المباشر مسموح فقط داخل دالتي السقوط (pushItemUpsert/pushItemDelete)
    const afterHelpers = tail.split("pushItemDelete")[1] ?? tail;
    expect(head).not.toMatch(/from\("items"\)\.insert/);
    expect(afterHelpers).not.toMatch(/from\("items"\)\.insert/);
  });

  it("السحب (pullAll) يقرأ من items_staff", () => {
    expect(outbox).toMatch(/from\("items_staff"\)/);
  });
});

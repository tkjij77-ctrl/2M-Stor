// ═══════════════════════════════════════════════════════════════════════════
//  🔒 SEC-1 (2026-11-07) — أرقام المخزون لا تُرسل لغير الموظف
//
//  الثغرة التي يحميها هذا الاختبار:
//    سياسة `items_read` صفّية لا عمودية، ومع منح select كامل لـ`anon` كان أي
//    زائر يستطيع `GET /rest/v1/items?select=stock_q,display_qs` فيقرأ جرد
//    المتجر — بينما التطبيق كان يخفي الأرقام «في العرض» فقط.
//
//  ما نفحصه:
//   1) الترحيل ينشئ الإسقاطين (items_public · items_staff) ويسحب select من anon.
//   2) الإسقاط العام لا يذكر أي عمود مخزون رقمي في قائمته.
//   3) التطبيق الرئيسي (web/cloud.js) يقرأ من الإسقاط الصحيح بحسب الدور،
//      ويسقط إلى items إن لم يُنفَّذ الترحيل (توافق خلفي).
//   4) منطق التحويل guestQty: 'out' ⇒ 0 · 'low' ⇒ العدد · 'in' ⇒ سقف واسع.
//   5) خدمة الـService Worker رُفع إصدارها (وإلا لا يصل الإصلاح للأجهزة).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { guestQty, GUEST_IN_QTY } from "@/lib/db/lid";

const ROOT = process.cwd();
const MIGRATION = "supabase/migrations/20261107090000_items_stock_projection.sql";
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("SEC-1 — ترحيل إسقاط المخزون", () => {
  const sql = existsSync(path.join(ROOT, MIGRATION)) ? read(MIGRATION) : "";

  it("الترحيل موجود", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
  });

  it("ينشئ items_public و items_staff", () => {
    expect(sql).toMatch(/create or replace view public\.items_public as/i);
    expect(sql).toMatch(/create or replace view public\.items_staff as/i);
  });

  it("يسحب القراءة الخام للأصناف من anon", () => {
    expect(sql).toMatch(/revoke\s+select\s+on\s+public\.items\s+from\s+anon/i);
  });

  it("يمنح anon قراءة الإسقاط العام فقط", () => {
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.items_public\s+to\s+anon/i);
    expect(sql).not.toMatch(/grant\s+select\s+on\s+public\.items_staff\s+to\s+anon/i);
  });

  it("إسقاط الزائر لا يُخرج أي عمود مخزون رقمي (لا في الأسماء ولا كعمود ظاهر)", () => {
    // استخرج جسم view items_public فقط (حتى نهاية الفاصلة المنقوطة)
    const body = sql.split(/create or replace view public\.items_public as/i)[1]?.split(";")[0] ?? "";
    expect(body.length).toBeGreaterThan(50);
    expect(body).toMatch(/stock_state/);
    expect(body).toMatch(/deleted_at is null/i);

    // الأعمدة المُخرَجة = كل سطر «i.col,» أو «… as alias»
    const outs = new Set<string>();
    for (const raw of body.split("\n")) {
      const line = raw.replace(/--.*$/, "").trim();
      const alias = line.match(/\bas\s+([a-z_][a-z0-9_]*)\s*,?$/i);
      if (alias) { outs.add(alias[1].toLowerCase()); continue; }
      const bare = line.match(/^i\.([a-z_][a-z0-9_]*)\s*,?$/i);
      if (bare) outs.add(bare[1].toLowerCase());
    }
    expect([...outs].length).toBeGreaterThan(5);
    for (const forbidden of ["stock_q", "display_qs", "min_alert"]) {
      expect(outs.has(forbidden)).toBe(false);
    }
    // الأرقام يجوز استخدامها داخليًا لحساب الحالة — لكن ليس كهروب مباشر
    expect(body).not.toMatch(/^\s*i\.display_qs\s*,?\s*$/im);
    expect(body).not.toMatch(/^\s*i\.stock_q\s*,?\s*$/im);
  });

  it("يفلتر إسقاط الموظفين بـis_staff() ويحتوي الأرقام", () => {
    const body = sql.split(/create or replace view public\.items_staff as/i)[1]?.split(";")[0] ?? "";
    expect(body).toMatch(/public\.is_staff\(\)/);
    expect(body).toMatch(/i\.\*/);
  });

  it("يتحقق من نفسه داخل الترحيل (do $$ … raise exception)", () => {
    expect(sql).toMatch(/has_table_privilege\('anon', 'public\.items', 'select'\)/);
    expect(sql).toMatch(/raise exception/i);
  });
});

describe("SEC-1 — التطبيق الرئيسي يقرأ الإسقاط الصحيح", () => {
  const cloud = read("web/cloud.js");

  it("يختار items_staff للموظف و items_public لغيره", () => {
    expect(cloud).toMatch(/items_staff/);
    expect(cloud).toMatch(/items_public/);
    expect(cloud).toMatch(/staffMode/);
  });

  it("يسقط إلى items عند غياب الترحيل (توافق خلفي — لا تعطيل للمتجر)", () => {
    expect(cloud).toMatch(/if \(itemsR\.error\) \{[\s\S]{0,200}from\('items'\)\.select\('\*'\)/);
  });

  it("يحوّل صف الزائر إلى الشكل الداخلي", () => {
    expect(cloud).toMatch(/function normalizeItemRow/);
    expect(cloud).toMatch(/\.map\(normalizeItemRow\)/);
  });

  it("خدمة الـService Worker رُفع إصدارها (الإصلاح يصل للأجهزة)", () => {
    const sw = read("sw.js");
    expect(sw).toMatch(/const CACHE = 'al-sayed-v3[6-9]'/);
  });
});

describe("SEC-1 — منطق كمية الزائر (guestQty)", () => {
  it("نفد المخزون ⇒ صفر", () => {
    expect(guestQty("out", null)).toBe(0);
    expect(guestQty("out", 2)).toBe(0);
  });

  it("قارب النفاد ⇒ العدد الحقيقي (وهو ما تعرضه الواجهة أصلًا)", () => {
    expect(guestQty("low", 1)).toBe(1);
    expect(guestQty("low", 3)).toBe(3);
    // حالة ناقصة من الخادم: لا نكشف صفرًا ولا سقفًا — 3 هي القيمة المعلنة
    expect(guestQty("low", null)).toBe(3);
  });

  it("متوفر ⇒ سقف واسع لا يكشف حجم الجرد (الخادم هو من يتحقق)", () => {
    expect(guestQty("in", null)).toBe(GUEST_IN_QTY);
    expect(guestQty(undefined, null)).toBe(GUEST_IN_QTY);
  });
});

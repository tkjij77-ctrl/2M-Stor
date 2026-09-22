// ═══════════════════════════════════════════════════════════════════════════
//  T5.1 — فحص تفكيك index.html (الكونوليث) إلى web/*.js
//
//  السبب: كود التطبيق كان 233 ك.ب داخل index.html نفسه. بعد فكّه إلى سبعة
//  ملفات بحسب المسؤولية، صار ممكنًا أن «يتفتّت» التفكيك بصمت: ملف يُحذف، أو
//  يُنسى من index.html، أو تسقط السطر الأخير منه، أو يعود كود مضمَّن داخل HTML.
//  هذا الفحص يمنع كل ذلك ويُشغَّل في CI (vitest) بلا حاجة إلى متصفح.
//
//  ملاحظة: web/*.js سكربتات كلاسيكية (لا import/export) تعمل في النطاق العام
//  وتعتمد على ترتيب التحميل — ولذلك نفحص الترتيب صراحةً هنا.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

/** ترتيب التحميل الملزم — تغييره يكسر التطبيق (كل ملف يعتمد على ما قبله) */
const ORDER = ["core", "views", "ui", "ops", "admin", "cloud", "boot"];

/** الملفات التي لا تدخل في هذا الفحص (مكتبات خارجية محلية) */
const VENDOR = /^vendor\//;

function scriptSources(): string[] {
  return [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)]
    .map((m) => m[1])
    .filter((s) => !VENDOR.test(s));
}

describe("T5.1 — تفكيك الكود إلى web/*.js", () => {
  it("index.html يحمّل ملفات التطبيق بالترتيب الصحيح فقط", () => {
    expect(scriptSources()).toEqual(ORDER.map((n) => `web/${n}.js`));
  });

  it("لا يبقى أي كود جافاسكربت مضمَّن داخل index.html", () => {
    // <script> بلا src وبلا جسم = ممنوع (الكود يجب أن يكون في web/)
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1].trim())
      .filter((body) => body.length > 0);
    expect(inline).toEqual([]);
  });

  it("كل ملف موجود وغير فارغ ويجتاز فحص الصياغة (node --check)", () => {
    for (const name of ORDER) {
      const file = path.join(ROOT, "web", `${name}.js`);
      expect(existsSync(file), `${name}.js مفقود`).toBe(true);
      const code = readFileSync(file, "utf8");
      expect(code.trim().length, `${name}.js فارغ`).toBeGreaterThan(50);
      // node --check = فحص نحوي حقيقي (المتصفح لا يشتكي إلا عند التشغيل)
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    }
  });

  it("الحجم الكلي منطقي (التفكيك لم يُسقط كودًا)", () => {
    const total = ORDER.reduce(
      (n, name) => n + readFileSync(path.join(ROOT, "web", `${name}.js`), "utf8").split("\n").length,
      0,
    );
    expect(total).toBeGreaterThan(3000);
    // index.html صار هيكلًا وواجهة فقط
    expect(html.split("\n").length).toBeLessThan(1500);
  });

  it("كل ملفات web/ مُدرجة في التخزين المسبق لـ Service Worker", () => {
    const sw = readFileSync(path.join(ROOT, "sw.js"), "utf8");
    for (const name of ORDER) {
      expect(sw, `${name}.js غير مُخزَّن مسبقًا`).toContain(`web/${name}.js`);
    }
  });

  it("دوال النطاق العام المشتركة معرّفة مرة واحدة (لا تكرار بين الملفات)", () => {
    // تحميل مزدوج لدالة من ملفين = آخر تعريف يطغى بصمت
    const defs = new Map<string, string[]>();
    for (const name of ORDER) {
      const code = readFileSync(path.join(ROOT, "web", `${name}.js`), "utf8");
      for (const m of code.matchAll(/^\s{0,4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
        const list = defs.get(m[1]) ?? [];
        list.push(name);
        defs.set(m[1], list);
      }
    }
    const dupes = [...defs.entries()].filter(([, files]) => new Set(files).size > 1);
    expect(dupes).toEqual([]);
  });

  it("كود المستوى الأعلى لا ينادي دوالًّا من ملفات لاحقة (فخ التفكيك)", () => {
    // في ملف واحد كان رفع الدوال يجعل الترتيب غير مهم. بعده، أي تنفيذ في المستوى
    // الأعلى ينادي دالة معرّفة لاحقًا = ReferenceError يوقف الملف كله بصمت.
    // هذا الفحص أثبت نفسه: كشف measureHeader فعلًا قبل أن يصل المستخدم.
    // نشغّل المدقّق نفسه (نفس ما يشغّله المطور يدويًا) بدل استنساخ منطقه
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/verify-boot-order.js")], { encoding: "utf8" });
    expect(out).toContain("لا اعتماد على ملفات لاحقة");
  });
});

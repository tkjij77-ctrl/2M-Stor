// ═══════════════════════════════════════════════════════════════════════════
//  🏪 2026-10-25 — اختبارات ترقية المتجر الاحترافي (لوحة التحكم + الدفع)
//
//  ما يحميه هذا الاختبار (كله أعطال حقيقية وقعت أثناء البناء):
//   1) ملفات pro-* لم تُحمَّل أو حُمِّلت قبل boot ⇒ التطبيق يفتح بلا واجهة.
//   2) الـ Service Worker لا يخزّنها ⇒ الملفات تختفي أوفلاين.
//   3) ترحيل SQL يحذف/يعدّل بيانات قائمة — ممنوع تمامًا (الإضافة فقط).
//   4) دالة الطلب تثق بسعر المتصفح ⇒ تلاعب بالأسعار من أي زائر.
//   5) استخدام وسم <header> داخل الوحدات الجديدة ⇒ يلتقط ستايل الهيدر العام
//      (position:fixed) ويظهر الشريط العلوي خارج مكانه — عطل وقع فعلًا.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const PRO = ["pro-store", "pro-admin", "pro-checkout"];
const MIGRATION = "supabase/migrations/20261025120000_pro_store.sql";

describe("تحميل وحدات المتجر الاحترافي", () => {
  it("index.html يحمّل الوحدات الثلاث بعد boot.js وبالترتيب", () => {
    const html = read("index.html");
    const bootAt = html.indexOf('src="web/boot.js"');
    expect(bootAt).toBeGreaterThan(-1);
    let last = bootAt;
    for (const name of PRO) {
      const at = html.indexOf(`src="web/${name}.js"`);
      expect(at, `web/${name}.js غير محمّل`).toBeGreaterThan(last);
      last = at;
    }
  });

  it("index.html يربط ملف الأنماط pro.css", () => {
    expect(read("index.html")).toContain('href="web/pro.css"');
  });

  it("الـ Service Worker يخزّن كل ملفات المتجر مسبقًا (وإلا اختفت أوفلاين)", () => {
    const sw = read("sw.js");
    for (const name of PRO) expect(sw).toContain(`web/${name}.js`);
    expect(sw).toContain("web/pro.css");
  });

  it("كل وحدة صحيحة الصياغة وغير فارغة", () => {
    for (const name of PRO) {
      const code = read(`web/${name}.js`);
      expect(code.length).toBeGreaterThan(3000);
      expect(() => new Function(code)).not.toThrow();
    }
  });

  it("لا تستخدم وسم <header> (يصطدم بستايل الهيدر العام position:fixed)", () => {
    for (const name of PRO) {
      expect(read(`web/${name}.js`), `${name}.js يستخدم <header>`).not.toMatch(/<header[\s>]/);
    }
  });

  it("كل مفاتيح التخزين المحلي مسبوقة بـal_sayed_ (لا تلوّث تخزين الموقع)", () => {
    for (const name of PRO) {
      const code = read(`web/${name}.js`);
      for (const m of code.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) {
        expect(m[1].startsWith("al_sayed_"), `${name}.js: مفتاح غير مسبوق → ${m[1]}`).toBe(true);
      }
    }
  });
});

describe("لوحة التحكم الجديدة", () => {
  const admin = read("web/pro-admin.js");

  it("تحتوي الشاشات الثماني المطلوبة", () => {
    for (const v of ["overview", "orders", "products", "categories", "banners", "customers", "settings"]) {
      expect(admin, `شاشة ${v} ناقصة`).toContain(`'${v}'`);
    }
    expect(admin).toContain("proViewOrderDetail");
  });

  it("لا تكتب على السحابة في وضع المعاينة", () => {
    expect(admin).toContain("function proQueueSafe");
    expect(admin).toMatch(/function proQueueSafe\(entry\)\s*\{\s*\n\s*if \(proPreview\) return;/);
  });

  it("حذف المنتج ناعم ويمر بسلة المحذوفات (لا حذف نهائي)", () => {
    expect(admin).toContain("trashPush(");
    expect(admin).toContain("t: 'item-del'");
  });

  it("تغيير حالة الطلب يمر بدالة المخزون القائمة (لا خصم/استرجاع مزدوج)", () => {
    expect(admin).toContain("updateOrderStatus(");
  });
});

describe("صفحة إتمام الطلب للزائر", () => {
  const co = read("web/pro-checkout.js");

  it("تستدعي دالة السيرفر الآمنة place_store_order", () => {
    expect(co).toContain("rpc('place_store_order'");
    expect(co).toContain("get_order_by_token");
  });

  it("تتحقق من صيغة الرقم المصري قبل الإرسال", () => {
    expect(co).toContain("/^01[0-9]{9}$/");
  });

  it("لا تُرسل السعر من المتصفح — تُرسل معرّف الصنف والكمية فقط", () => {
    expect(co).toMatch(/items:\s*invoiceCart\.map\(c\s*=>/);
    expect(co).toContain("{ id: it ? it.cid : null, qty: c.qty }");
  });

  it("لها مسار احتياطي محلي فلا يضيع الطلب لو السحابة غير متاحة", () => {
    expect(co).toContain("function proCreateLocalOrder");
  });

  it("على جهاز واحد: لا تكتب في السحابة في وضع المعاينة", () => {
    expect(co).toContain("const canRpc = !proPreview");
  });
});

describe("ترحيل قاعدة البيانات — إضافي بالكامل", () => {
  const sql = read(MIGRATION);

  it("الملف موجود", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
  });

  it("لا يحذف ولا يمس أي بيانات قائمة", () => {
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);
  });

  it("كل إضافة عمود آمنة الإعادة (if not exists)", () => {
    const adds = [...sql.matchAll(/add column (?!if not exists)/gi)];
    expect(adds).toEqual([]);
  });

  it("ينشئ جدول البنرات مع RLS وسياسات", () => {
    expect(sql).toContain("create table if not exists public.banners");
    expect(sql).toContain("alter table public.banners enable row level security");
    expect(sql).toMatch(/create policy banners_public_read/);
    expect(sql).toMatch(/create policy banners_admin_write/);
  });

  it("دالة الطلب: definer + search_path ثابت + قفل صفوف + الأسعار من الجدول", () => {
    const fn = sql.slice(sql.indexOf("function public.place_store_order"));
    const body = fn.slice(0, fn.indexOf("$public$") > 0 ? undefined : undefined);
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    expect(fn).toContain("for update");          // منع بيع نفس القطعة مرتين
    expect(fn).toContain("from public.items");   // السعر من قاعدة البيانات
    expect(fn).toContain("v_item.price_num");
    // لا يستخدم أي سعر قادم من المتصفح
    expect(fn).not.toMatch(/v_line->>'price'/);
    expect(body.length).toBeGreaterThan(100);
  });

  it("دالة الطلب لا تُنفَّذ إلا للمصرَّح لهم (revoke من public ثم grant)", () => {
    expect(sql).toMatch(/revoke all on function public\.place_store_order\(jsonb\) from public/);
    expect(sql).toMatch(/grant execute on function public\.place_store_order\(jsonb\) to anon, authenticated/);
  });

  it("قائمة الإعدادات العامة تشمل مفاتيح المتجر السبعة الجديدة", () => {
    for (const k of ["store_open", "announce_text", "store_logo", "brand_color", "pay_vodafone", "pay_instapay", "pay_bank"]) {
      expect(sql, `المفتاح ${k} غير موجود`).toContain(`'${k}'`);
    }
  });

  it("يفشل بصوت عالٍ إن لم تكتمل الترقية (فحص ذاتي داخلي)", () => {
    expect(sql).toContain("raise exception 'ترقية المتجر ناقصة");
  });
});

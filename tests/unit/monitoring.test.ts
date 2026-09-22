// ═══════════════════════════════════════════════════════════════════════════
//  T5.3 — فحص بنية المراقبة (بلا متصفح، يعمل في CI)
//
//  ما يحميه هذا الفحص: أن تبقى المراقبة *فعّالة* لا شكلية —
//   • لو حُذف أحد ملفات web/ من فحص الجاهزية، صار الموقع «سليمًا» وهو معطوب.
//   • لو أُضيف `secrets.` في الـworkflow، صار يعتمد على أسرار غير مضبوطة ويمرّ فارغًا.
//   • لو نُسي `enable row level security` أو سياسة، صار سجل الأخطاء مكشوفًا للزوار.
//   • لو تغيّر اسم الجدول في الكود بلا ترحيل، صار الإرسال السحابي يفشل بلا سبب ظاهر.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const UPTIME = ".github/workflows/uptime.yml";
const MIGRATION = "supabase/migrations/20260922120000_client_errors.sql";

describe("T5.3 — مراقبة الجاهزية (GitHub Actions)", () => {
  it("ملف المراقبة موجود وله جدول زمني وتشغيل يدوي", () => {
    expect(existsSync(path.join(ROOT, UPTIME))).toBe(true);
    const y = read(UPTIME);
    expect(y).toMatch(/cron:\s*'\*\/30 \* \* \* \*'/);
    expect(y).toContain("workflow_dispatch");
  });

  it("يفحص الصفحة وكل ملفات web/ السبعة والباك اند", () => {
    const y = read(UPTIME);
    for (const f of ["core", "views", "ui", "ops", "admin", "cloud", "boot"]) {
      expect(y, `web/${f}.js غير مفحوص`).toContain(f);
    }
    expect(y).toContain("rest/v1/items");
    expect(y).toContain("loginOverlay");
  });

  it("لا يعتمد على أي سر (وإلا صار يمرّ فارغًا بلا تنبيه)", () => {
    const y = read(UPTIME);
    expect(y).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it("يفشل التشغيل عند العطل (فيتولّى GitHub التنبيه بالبريد)", () => {
    const y = read(UPTIME);
    expect(y).toMatch(/exit 1/);
    expect(y).toContain("::error::");
  });
});

describe("T5.3 — سجل أخطاء المستخدمين في قاعدة البيانات", () => {
  it("الترحيل موجود ويحتوي الجدول و RLS وسياساته", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
    const sql = read(MIGRATION);
    expect(sql).toContain("create table if not exists public.client_errors");
    expect(sql).toContain("enable row level security");
    // الإدراج للجميع · القراءة والحذف للمدير · لا تعديل
    expect(sql).toMatch(/for insert to anon, authenticated/);
    expect(sql).toMatch(/for select to authenticated[\s\S]*?role = 'admin'/);
    expect(sql).toMatch(/for delete to authenticated/);
    expect(sql).toMatch(/revoke update on public\.client_errors/);
  });

  it("دالة التنظيف تحرس نفسها (المدير فقط) — لا يمسح زائر سجل الأعطال", () => {
    const sql = read(MIGRATION);
    const fn = sql.slice(sql.indexOf("client_errors_purge"));
    expect(fn).toMatch(/role = 'admin'/);
    expect(fn).toMatch(/raise exception/);
  });

  it("اسم الجدول في الكود مطابق للترحيل (وإلا فشل الإرسال بصمت)", () => {
    const ops = read("web/ops.js");
    const migration = read(MIGRATION);
    const used = [...ops.matchAll(/from\('([a-z_]+)'\)\s*\.insert/g)].map((m) => m[1]);
    expect(used).toContain("client_errors");
    expect(migration).toContain(`public.${used.find((t) => t === "client_errors")}`);
  });
});

describe("T5.3 — المراقبة داخل التطبيق نفسه", () => {
  it("تلتقط أخطاء الجافاسكربت والوعود المرفوضة", () => {
    const ops = read("web/ops.js");
    expect(ops).toContain("window.addEventListener('error'");
    expect(ops).toContain("window.addEventListener('unhandledrejection'");
  });

  it("محميّة من التضخّم (سقف 50 وخطأ واحد لا يتكرر أكثر من 10)", () => {
    const ops = read("web/ops.js");
    expect(ops).toMatch(/rows\.length > 50/);
    expect(ops).toMatch(/_errSeen\[key\] > 10/);
  });

  it("تتوقف عن الإرسال السحابي بعد أول فشل (لا طلبات فاشلة متكررة)", () => {
    const ops = read("web/ops.js");
    expect(ops).toContain("_errRemoteOff = true");
  });

  it("السجل للمدير فقط، وله زر في لوحة التحكم", () => {
    const ops = read("web/ops.js");
    const admin = read("web/admin.js");
    expect(ops).toMatch(/function showErrorsModal[\s\S]{0,120}can\('dash'\)/);
    expect(admin).toContain("showErrorsModal()");
  });

  it("لا يُسجَّل أي محتوى حسّاس في السجل", () => {
    const ops = read("web/ops.js");
    // لا كلمة مرور ولا مفتاح ولا بريد في حقول السجل
    const logger = ops.slice(ops.indexOf("function logClientError"), ops.indexOf("async function reportErrorRemote"));
    expect(logger).not.toMatch(/password|pass|secret|apiKey|apikey/i);
  });
});

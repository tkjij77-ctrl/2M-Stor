#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  T3.7 — فحص انحراف المخطط بين المستودع وقاعدة البيانات الحقيقية
//
//  المشكلة التي يحلّها: المستودع كان يقول إنه «مرجع المخطط» بينما
//  الفهارس وبعض السياسات وتفعيل Realtime أُنشئت يدويًا في Supabase —
//  فمن يعيد بناء النظام من المستودع يحصل على نظام ناقص بلا أن يدري.
//
//  ثلاث طرق استخدام:
//   1) node scripts/verify-schema-drift.js --repo
//      فحص ذاتي بلا إنترنت: المستودع متّسق مع نفسه ومع ما يستدعيه
//      التطبيق فعلًا (دوال rpc · الجداول · النافذة/الدلو). يعمل في CI.
//
//   2) node scripts/verify-schema-drift.js <ملف الجرد أو النسخة>
//      يقارن المستودع بما على القاعدة الحقيقية ويطبع الانحراف:
//        • كائن على القاعدة وليس في المستودع  ← لم يُحفظ في المستودع
//        • كائن في المستودع وليس على القاعدة  ← لم يُنفَّذ بعد
//        • عمود/أمر سياسة مختلف
//      ملف الجرد يأتي من: scripts/schema-inventory.sql (الصقه في SQL Editor)
//      أو من `supabase db dump --schema public -f dump.sql`.
//
//   3) --emit-migration <ملف>  (مع الوضع 2)
//      يكتب مسوّدة ترحيل تحتوي تعريفات ما على القاعدة وليس في المستودع
//      — لتُراجَع وتُلتزم بدل أن يبقى المخطط الحقيقي خارج المستودع.
//
//  معيار القبول (الخطة): «مشروع فارغ + ملفات المستودع = نظام يعمل مطابقًا
//  للإنتاج · لا اختلاف في الجداول/السياسات/الفهارس/جداول publication»
// ═══════════════════════════════════════════════════════════════════
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const APPS = ["index.html", "app", "lib"]; // مصادر التطبيق لاستخراج ما يستدعيه فعلًا

// ── أدوات نصية ─────────────────────────────────────────────────────
// ⚠️ النسخة السابقة كانت `replace(/--[^\n]*/g, " ")` — تحذف أي `--` حتى داخل
// نص حرفي أو داخل جسم دالة ($$ … $$). والنتيجة الأخطر: مسوّدة ترحيل مُصدَّرة
// قد يبتلع تعليق في أولها بقية السطر فتصير العبارة معلَّقة بصمت ولا تُنفَّذ.
// هذه نسخة ماسحة تحترم: 'النصوص' · $tag$ الكتل · /* */ والـ-- .
function stripComments(sql) {
  let out = "", i = 0, inSingle = false, dollar = null;
  while (i < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, i)) { out += dollar; i += dollar.length; dollar = null; continue; }
      out += sql[i++]; continue;
    }
    if (inSingle) {
      out += sql[i];
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") { out += "'"; i += 2; continue; }  // '' = علامة مهرَّبة
        inSingle = false;
      }
      i++; continue;
    }
    const ch = sql[i];
    if (ch === "'") { inSingle = true; out += ch; i++; continue; }
    const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dm) { dollar = dm[0]; out += dm[0]; i += dm[0].length; continue; }
    if (ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2; continue;
    }
    out += ch; i++;
  }
  return out.replace(/\s+/g, " ");
}

/** تقسيم SQL إلى عبارات مع احترام الكتل النصية ($$ .. $$ · '...') */
function splitStatements(sql) {
  const out = [];
  let cur = "";
  let dollar = null;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (dollar) {
      cur += ch;
      if (sql.startsWith(dollar, i)) {
        cur += sql.slice(i + dollar.length - 1, i + dollar.length);
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === "'") { inSingle = true; cur += ch; continue; }
    const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (m) { dollar = m[0]; cur += m[0]; i += m[0].length - 1; continue; }
    if (ch === ";") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

// ── تحليل الجرد من نص SQL ──────────────────────────────────────────
/** يستخرج كل الكائنات: جداول/أعمدة · فهارس · سياسات · دوال · مشغّلات · realtime */
function parseSql(sql) {
  const inv = {
    tables: {},      // name -> [أعمدة]
    rls: new Set(),  // جداول عليها RLS
    indexes: {},     // name -> جدول
    policies: {},    // "جدول.اسم" -> { table, command, roles, body }
    functions: {},   // name -> { args, raw }
    triggers: {},    // "جدول.اسم" -> raw
    publications: new Set(), // جداول داخل supabase_realtime
    buckets: new Set(),
    grants: [],      // نصوص grant/revoke على الدوال
    raw: {},         // "نوع:اسم" -> نص العبارة (لإصدار مسوّدة الترحيل)
  };
  const stmts = splitStatements(sql); // العبارات الأصلية (بلا حذف تعليقات داخل النصوص)

  for (const rawStmt of stmts) {
    const st = clean(stripComments(rawStmt));
    // ⚠️ نحفظ **العبارة بلا تعليقات**: العبارة الأصلية قد تبدأ بـ`-- وصف`، وعند
    // إصدار مسوّدة ترحيل يصير السطر كله تعليقًا ⇒ العبارة لا تُنفَّذ ولا أحد يلاحظ.
    const keep = (kind, name) => { inv.raw[kind + ":" + name] = clean(stripComments(rawStmt)); };

    // ── جداول + أعمدة ──
    let m = /create table (?:if not exists )?(?:public\.|storage\.)?([a-z_][\w]*)\s*\(([\s\S]*)\)\s*$/i.exec(st) ||
            /create table (?:if not exists )?(?:public\.|storage\.)?([a-z_][\w]*)\s*\(([\s\S]*)\)/i.exec(st);
    if (m) {
      const name = m[1].toLowerCase().trim();
      const body = m[2];
      if (!/^(select|as)\b/i.test(body.trim())) {
        const cols = [];
        let depth = 0;
        for (const part of splitTopLevel(body)) {
          depth = 0;
          const p = part.trim();
          if (!p) continue;
          if (/^(constraint|primary key|unique|foreign key|check|exclude)\b/i.test(p)) continue;
          const cm = /^"?([a-z_][\w]*)"?\s+([a-z][\w ]*(?:\([^)]*\))?)/i.exec(p);
          if (cm) cols.push(cm[1].toLowerCase());
        }
        void depth;
        inv.tables[name] = cols;
        keep("table", name);
      }
    }

    // ── تعديلات الأعمدة (alter table … add/drop column) ──
    // ⚠️ خطأ حقيقي (اكتُشف 21 سبتمبر 2026 في دورة الجرد الكاملة): العبارة الواحدة
    // قد تحمل **عدة** `add column` بفواصل — و`exec` كان يلتقط الأول فقط. النتيجة:
    // `invoices.updated_at` (الثاني في نفس العبارة) بدا «على القاعدة وليس في
    // المستودع» — أي إنذار كاذب في أداة مهمتها كشف الانحراف. الآن نطابق الكل.
    const alters = /alter table (?:if exists )?(?:only )?(?:public\.|storage\.)?([a-z_][\w]*)\s+((?:add|drop) column [\s\S]*)$/i.exec(st);
    if (alters) {
      const t = alters[1].toLowerCase();
      const keys = new Set(["add", "column", "drop", "if", "not", "exists"]);
      for (const mm of alters[2].matchAll(/add column (?:if not exists )?"?([a-z_][\w]*)"?/gi)) {
        const c = mm[1].toLowerCase();
        if (!keys.has(c) && inv.tables[t] && !inv.tables[t].includes(c)) inv.tables[t].push(c);
      }
      for (const mm of alters[2].matchAll(/drop column (?:if exists )?"?([a-z_][\w]*)"?/gi)) {
        const c = mm[1].toLowerCase();
        if (!keys.has(c) && inv.tables[t]) inv.tables[t] = inv.tables[t].filter((x) => x !== c);
      }
    }

    // ── RLS ──
    m = /alter table (?:if exists )?(?:public\.)?([a-z_][\w]*)\s+enable row level security/i.exec(st);
    if (m) inv.rls.add(m[1].toLowerCase());
    m = /alter table (?:if exists )?(?:public\.)?([a-z_][\w]*)\s+disable row level security/i.exec(st);
    if (m) inv.rls.delete(m[1].toLowerCase());

    // ── Realtime (بما فيه الكتلة التي تُديره بحلقة) ──
    if (/alter publication supabase_realtime add table/i.test(st)) {
      // لا نلتقط شيئًا من عبارات التنسيق الديناميكي (format(... %I)) — الأسماء تأتي من المصفوفة أسفله
      if (!/%I/.test(st)) for (const g of st.matchAll(/add table\s+(?:public\.)?([a-z_][\w]*)/gi)) inv.publications.add(g[1].toLowerCase());
      const arr = /tables\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i.exec(rawStmt);
      if (arr) {
        for (const g of arr[1].matchAll(/'([a-z_][\w]*)'/gi)) inv.publications.add(g[1].toLowerCase());
      }
      const loop = /foreach\s+\w+\s+in\s+array\s+(\w+)/i.exec(rawStmt);
      // «*» تعني «مغطّى بالكامل» — ولا تُستعمل إلا إن كانت الحلقة على مصدر غير مذكور.
      if (loop && !/tables\s+text\[\]/i.test(rawStmt)) inv.publications.add("*");
    }
    if (/alter publication supabase_realtime drop table/i.test(st)) {
      for (const g of st.matchAll(/drop table\s+(?:public\.)?([a-z_][\w]*)/gi)) {
        inv.publications.delete(g[1].toLowerCase());
        inv.publications.delete("*");
      }
    }

    // ── الفهارس ──
    m = /create (?:unique )?index (?:concurrently )?(?:if not exists )?"?([a-z_][\w]*)"?\s+on\s+(?:only\s+)?(?:public\.|storage\.)?([a-z_][\w]*)/i.exec(st);
    if (m) { inv.indexes[m[1].toLowerCase()] = m[2].toLowerCase(); keep("index", m[1].toLowerCase()); }
    m = /drop index (?:concurrently )?(?:if exists )?(?:public\.)?"?([a-z_][\w]*)"?/i.exec(st);
    if (m) { delete inv.indexes[m[1].toLowerCase()]; delete inv.raw["index:" + m[1].toLowerCase()]; }

    // ── السياسات ──
    m = /create policy\s+"?([^"\s]+)"?\s+on\s+(?:public\.|storage\.)?([a-z_][\w]*)/i.exec(st);
    if (m) {
      const name = m[1], table = m[2].toLowerCase();
      const cmd = /for\s+(all|select|insert|update|delete)/i.exec(st);
      const roles = /to\s+([a-z_,\s]*?)(?:\s+using|\s+with check|$)/i.exec(st);
      inv.policies[table + "." + name] = {
        table,
        name,
        command: cmd ? cmd[1].toUpperCase() : "ALL",
        roles: roles ? clean(roles[1]) : "public",
        body: st,
      };
      keep("policy", table + "." + name);
    }
    m = /drop policy\s+(?:if exists\s+)?"?([^"\s]+)"?\s+on\s+(?:public\.|storage\.)?([a-z_][\w]*)/i.exec(st);
    if (m) { delete inv.policies[m[2].toLowerCase() + "." + m[1]]; delete inv.raw["policy:" + m[2].toLowerCase() + "." + m[1]]; }

    // ── الدوال ──
    m = /create (?:or replace )?function\s+(?:public\.|storage\.|extensions\.)?([a-z_][\w]*)\s*\(([^)]*)\)/i.exec(st);
    if (m) {
      const name = m[1].toLowerCase();
      const args = m[2]
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => (a.split(/\s+/)[1] || a.split(/\s+/)[0]).toLowerCase())
        .join(",");
      inv.functions[name] = { args, raw: clean(stripComments(rawStmt)) };
      keep("function", name);
    }
    m = /drop function (?:if exists )?(?:public\.)?([a-z_][\w]*)/i.exec(st);
    if (m && !/create/i.test(st)) { delete inv.functions[m[1].toLowerCase()]; delete inv.raw["function:" + m[1].toLowerCase()]; }

    // ── المشغّلات ──
    m = /create (?:or replace )?trigger\s+"?([a-z_][\w]*)"?\s+[\s\S]*?on\s+(?:public\.|auth\.|storage\.)?([a-z_][\w]*)/i.exec(st);
    if (m) { inv.triggers[m[2].toLowerCase() + "." + m[1].toLowerCase()] = clean(rawStmt); keep("trigger", m[2].toLowerCase() + "." + m[1].toLowerCase()); }
    m = /drop trigger (?:if exists )?"?([a-z_][\w]*)"?\s+on\s+(?:public\.|auth\.|storage\.)?([a-z_][\w]*)/i.exec(st);
    if (m) delete inv.triggers[m[2].toLowerCase() + "." + m[1].toLowerCase()];

    // ── الصلاحيات على الدوال ──
    if (/^(grant|revoke)\b/i.test(st) && /function/i.test(st)) inv.grants.push(st);

    // ── الدلاء (Storage) ──
    m = /insert into storage\.buckets\s*\([^)]*\)\s*values\s*\(\s*'([a-z_-]+)'/i.exec(st) ||
        /insert into storage\.buckets[\s\S]*?values\s*\(\s*'([a-z_-]+)'/i.exec(st);
    if (m) inv.buckets.add(m[1].toLowerCase());
  }

  // كائنات مُعرَّفة نصًّا (لجرد يُنسخ من SQL Editor)
  return inv;
}

/** تقسيم جسم الجدول إلى عناصر على مستوى الفاصلة العليا */
function splitTopLevel(body) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── جرد المستودع = كل الترحيلات بالترتيب (الأحدث يفوز) ─────────────
function repoInventory() {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const inv = parseSql(files.map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8")).join("\n;\n"));
  return { inv, files };
}

// ── جرد الجرد القادم من القاعدة (ملف نص بصيغة kind|name|extra) ────
function parseInventoryText(text) {
  const inv = parseSql(""); // فارغ، ثم نملؤه من السطور
  // ⚠️ درس حقيقي (21 سبتمبر 2026): استعلام الجرد الحقيقي في SQL Editor يُخرج
  // `public.items` و`storage.objects`، أما أسماء المستودع فبلا تسبيق (`items`).
  // بلا هذا التجريد تظهر **كل** الكائنات مرتين: مرة «على القاعدة وليس في المستودع»
  // ومرة «في المستودع وليس على القاعدة» — أي أن الأداة كانت ستعطي المستخدم
  // مئات الفروق الكاذبة. (اكتُشف باختبار الدورة الكاملة: الترحيلات ← الجرد ← المقارنة.)
  const bare = (n) => (n || "").toLowerCase().replace(/^(public|storage|auth)\./, "");
  const seenKinds = new Set();
  let lines = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("--") || t.startsWith("#")) continue;
    const p = t.split("|").map((x) => x.trim());
    if (p.length < 2) continue;
    const [kind, name, extra] = p;
    const k = kind.toLowerCase();
    seenKinds.add(k);
    lines++;
    if (k === "table") { const n = bare(name); inv.tables[n] = (inv.tables[n] || []); inv.rls.add(n); }
    else if (k === "column") { const tbl = bare(extra); inv.tables[tbl] = (inv.tables[tbl] || []).concat([name.toLowerCase()]); }
    else if (k === "index") inv.indexes[name.toLowerCase()] = bare(extra);
    else if (k === "policy") {
      // `storage.objects` في الجرد ⇄ `objects` في المستودع (سياسات الدلو)
      const table = bare(extra).replace(/^objects$/, "objects");
      inv.policies[table + "." + name.toLowerCase()] = { table, name: name.toLowerCase(), command: "UNKNOWN", roles: "", body: "" };
    } else if (k === "function") inv.functions[name.toLowerCase()] = { args: "", raw: "" };
    else if (k === "trigger") inv.triggers[name.toLowerCase()] = "";
    else if (k === "publication") inv.publications.add(name.toLowerCase());
    else if (k === "bucket") inv.buckets.add(name.toLowerCase());
    else if (k === "rls") inv.rls.add(bare(name));
  }
  return { inv, lines, kinds: [...seenKinds] };
}

// ── الوضع 1: فحص ذاتي (بلا إنترنت · يصلح لـCI) ─────────────────────
function selfCheck() {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail });
  const { inv, files } = repoInventory();

  // 1) RLS مُفعَّل على كل جدول فيه بيانات عملاء
  const missingRls = Object.keys(inv.tables).filter((t) => !inv.rls.has(t));
  check("كل جدول مُفعَّل عليه RLS", missingRls.length === 0, missingRls.join(" · "));

  // 2) كل جدول له سياسة واحدة على الأقل — ما عدا جداول مستثناة **صراحةً وموثَّقة**
  //    الاستثناء لا يمرّ إلا إذا ذُكر اسم الجدول في docs/rls.md؛ فمن يضيف جدولًا بلا
  //    سياسات (كما يلزم أحيانًا لأسباب أمنية) يُجبَر على كتابة السبب في الوثيقة،
  //    بدل أن يتحوّل الاستثناء إلى باب خلفي صامت.
  const NO_POLICY_TABLES = {
    login_attempts: "revoke كامل من anon/authenticated + بلا سياسات: لا يُقرأ ولا يُكتب إلا عبر دوال login_gate/login_fail/login_ok",
  };
  const withPolicy = new Set(Object.values(inv.policies).map((p) => p.table));
  const noPolicy = Object.keys(inv.tables).filter((t) => !withPolicy.has(t) && !NO_POLICY_TABLES[t]);
  check("كل جدول عليه سياسة واحدة على الأقل (أو استثناء موثَّق)", noPolicy.length === 0, noPolicy.join(" · "));
  // الاستثناء نفسه: موجود في المخطط؟ مذكور في الوثيقة؟ ومكتوب عليه revoke فعلًا؟
  const rlsDocText = fs.readFileSync(path.join(ROOT, "docs", "rls.md"), "utf8");
  const badExceptions = Object.keys(NO_POLICY_TABLES).filter((t) => inv.tables[t] && !rlsDocText.includes(t));
  check("الجداول المستثناة مذكورة بالاسم في docs/rls.md", badExceptions.length === 0, badExceptions.join(" · "));
  if (inv.tables["login_attempts"]) {
    const lr = fs.readFileSync(path.join(MIGRATIONS, files.find((f) => f.includes("login_throttle"))), "utf8");
    check("login_attempts عليه revoke كامل (لا وصول مباشر)", /revoke[\s\S]*?on\s+(?:table\s+)?(?:public\.)?login_attempts/i.test(lr));
    check("docs/rls.md يشرح سبب انعدام سياسات login_attempts", /login_attempts/.test(rlsDocText) && /revoke/i.test(rlsDocText));
  }

  // 2-ب) كل `create policy` مسبوق بـ`drop policy if exists` ⇒ الملف آمن الإعادة
  //      (اكتُشف باختبار تشغيل الملف المركّب مرتين: فشل بـ«policy … already exists»
  //       ويتعارض مع وعد «أعد التشغيل بلا خوف» الذي نعطيه للمستخدم)
  const notIdempotent = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const seen = new Set();
    for (const line of txt.split("\n")) {
      const d = /drop policy if exists\s+"?([^"\s]+)"?\s+on\s+([a-z_.]+)/i.exec(line);
      if (d) seen.add(d[1].toLowerCase() + " on " + d[2].toLowerCase());
      const c = /create policy\s+"?([^"\s]+)"?\s+on\s+([a-z_.]+)/i.exec(line);
      if (c && !seen.has(c[1].toLowerCase() + " on " + c[2].toLowerCase())) {
        notIdempotent.push(f + " → " + c[1] + " on " + c[2]);
      }
    }
  }
  check("كل سياسة تُحذف قبل إنشائها (ترحيلات آمنة الإعادة)", notIdempotent.length === 0, notIdempotent.slice(0, 3).join(" · "));

  // 2-ج) قائمة الإعدادات العامة (public_settings + settings_public_read) يجب أن
  //      تطابق **حرفيًا** مفاتيح `mergeSettings()` في الواجهة.
  //      ⚠️ سبب هذا الفحص: العطل الحقيقي الذي وقع فعلًا — كُتبت القائمة من الذاكرة
  //      باسم `store_phone` غير الموجود، وأُغفل `footer` و`coupon_code`، فكانت
  //      واجهة الزائر ستفقد التذييل والكوبون بعد الترحيل بلا أي رسالة خطأ.
  {
    const app = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const appKeys = new Set();
    const mergeBlock = /function mergeSettings[\s\S]*?\n    \}/.exec(app);
    if (mergeBlock) {
      const mapBlock = /const map = \{([\s\S]*?)\};/.exec(mergeBlock[0]);
      if (mapBlock) for (const m of mapBlock[1].matchAll(/([a-z_]+)\s*:/g)) appKeys.add(m[1]);
    }
    if (/rs\.key === 'role_perms'/.test(mergeBlock ? mergeBlock[0] : app)) appKeys.add("role_perms");

    const sqlFile = files.find((f) => f.includes("rls_anon_access"));
    const sql = fs.readFileSync(path.join(MIGRATIONS, sqlFile), "utf8");
    const lists = [...sql.matchAll(/key in \(([\s\S]*?)\)/g)].map((m) =>
      new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
    );
    const sqlKeys = lists[0] || new Set();
    const missingInSql = [...appKeys].filter((k) => !sqlKeys.has(k));
    const extraInSql = [...sqlKeys].filter((k) => !appKeys.has(k));
    check(
      "قائمة الإعدادات العامة تطابق مفاتيح الواجهة (" + appKeys.size + " مفتاحًا)",
      appKeys.size > 0 && missingInSql.length === 0 && extraInSql.length === 0,
      (missingInSql.length ? "ناقص في SQL: " + missingInSql.join(" · ") + " " : "") +
      (extraInSql.length ? "زائد في SQL: " + extraInSql.join(" · ") : "")
    );
    // الدالة والسياسة يجب أن تستخدما **نفس** القائمة (وإلا اختلفت رؤية الواجهة عن الدالة)
    check(
      "public_settings وsettings_public_read بنفس القائمة",
      lists.length >= 2 && lists.slice(1).every((l) => l.size === sqlKeys.size && [...l].every((k) => sqlKeys.has(k))),
      lists.length < 2 ? "قائمة واحدة فقط في الملف" : ""
    );
  }

  // 3) الجداول التي يقرأها التطبيق موجودة في المخطط
  const appTables = new Set();
  const appRpcs = new Set();
  const appBuckets = new Set();
  for (const rel of APPS) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const walk = (target) => {
      const st = fs.statSync(target);
      if (st.isDirectory()) { for (const f of fs.readdirSync(target)) walk(path.join(target, f)); return; }
      if (!/\.(ts|tsx|js|jsx|html|mjs)$/.test(target)) return;
      const txt = fs.readFileSync(target, "utf8");
      // استدعاءات التخزين تُشال أولًا — وإلا حُسب اسم الدلو جدولًا (وهو ما حدث مع sb.storage
      //   .from('products') المكتوبة على سطرين)
      for (const m of txt.matchAll(/storage\s*\.\s*from\(\s*['"]([a-z_-]+)['"]\s*\)/g)) appBuckets.add(m[1]);
      const noStorage = txt.replace(/storage\s*\.\s*from\([^)]*\)/g, " ");
      for (const m of noStorage.matchAll(/\bfrom\(\s*['"]([a-z_][\w]*)['"]\s*\)/g)) appTables.add(m[1]);
      for (const m of txt.matchAll(/\.rpc\(\s*['"]([a-z_][\w]*)['"]/g)) appRpcs.add(m[1]);
    };
    walk(p);
  }
  const missingTables = [...appTables].filter((t) => !inv.tables[t]);
  check("كل جدول يقرأه التطبيق موجود في المخطط", missingTables.length === 0, missingTables.join(" · "));
  const missingRpcs = [...appRpcs].filter((f) => !inv.functions[f]);
  check("كل دالة rpc يستدعيها التطبيق موجودة", missingRpcs.length === 0, missingRpcs.join(" · "));
  const missingBuckets = [...appBuckets].filter((b) => !inv.buckets.has(b));
  check("دلو الصور الذي يستخدمه التطبيق مُعرَّف في SQL", missingBuckets.length === 0, missingBuckets.join(" · "));

  // 4) Realtime مُغطّى للجداول الحيّة
  const LIVE_TABLES = ["items", "categories", "settings", "invoices"];
  const rt = inv.publications.has("*") ? LIVE_TABLES : [...inv.publications];
  const missingRt = LIVE_TABLES.filter((t) => !rt.includes(t));
  check("تفعيل Realtime مُسجَّل في المستودع للجداول الحيّة", missingRt.length === 0, missingRt.join(" · "));

  // 5) الفهارس التي تعتمد عليها الاستعلامات موجودة
  const wantedIdx = ["idx_items_category", "idx_items_display", "idx_items_updated"];
  const missingIdx = wantedIdx.filter((i) => !inv.indexes[i]);
  check("فهارس الاستعلامات الشائعة موجودة", missingIdx.length === 0, missingIdx.join(" · "));

  // 6) دالة الترقيم المركزي والدوال التي يستدعيها التطبيق/الترحيلات
  const wantedFns = ["next_invoice_no", "assign_invoice_no", "invoice_number_health", "decrement_stock", "increment_stock",
                     "my_role", "is_staff", "is_manager",
                     // N-2: قراءة الإعدادات العامة للزائر بلا كشف الجدول
                     "public_settings",
                     // F2: قفل محاولات الدخول على السيرفر
                     "login_gate", "login_fail", "login_ok"];
  const missingFn = wantedFns.filter((f) => !inv.functions[f]);
  check("دوال النظام الأساسية موجودة", missingFn.length === 0, missingFn.join(" · "));

  // 7) الوثائق تُطابق الواقع (عدد السياسات والجداول وrealtime)
  const rlsDoc = fs.readFileSync(path.join(ROOT, "docs", "rls.md"), "utf8");
  const syncDoc = fs.readFileSync(path.join(ROOT, "docs", "sync.md"), "utf8");
  //    الفحص القديم كان `rlsDoc.includes('8')` — يمرّ بأي «8» في الملف (وثيقة تقول 7 جداول
  //    مرّت لأن فيها «8 مشغّلات»). الآن نفحص **صف الجدول نفسه** فلا ينفع رقم من مكان آخر.
  const rlsRow = (label) => {
    const re = new RegExp("[|]\\s*" + label + "\\s*[|]\\s*\\**\\s*(\\d+)");
    const m = re.exec(rlsDoc);
    return m ? Number(m[1]) : null;
  };
  const policyCount = Object.keys(inv.policies).length;
  const tableCount = Object.keys(inv.tables).length;
  const docTableCount = rlsRow("جداول في `public`");
  check("docs/rls.md يذكر عدد الجداول الفعلي (" + tableCount + ") في صف الجداول", docTableCount === tableCount, "الوثيقة تقول: " + docTableCount);
  const docPolicyCount = rlsRow("سياسات RLS");
  check("docs/rls.md يذكر عدد السياسات الفعلي (" + policyCount + ") في صف السياسات", docPolicyCount === policyCount, "الوثيقة تقول: " + docPolicyCount);
  const docFnCount = rlsRow("دوال");
  const fnCount = Object.keys(inv.functions).length;
  check("docs/rls.md يذكر عدد الدوال الفعلي (" + fnCount + ") في صف الدوال", docFnCount === fnCount, "الوثيقة تقول: " + docFnCount);
  const docIdxCount = rlsRow("فهارس");
  const idxCount = Object.keys(inv.indexes).length;
  check("docs/rls.md يذكر عدد الفهارس الفعلي (" + idxCount + ") في صف الفهارس", docIdxCount === idxCount, "الوثيقة تقول: " + docIdxCount);
  check("docs/sync.md يذكر جداول Realtime الفعلية", LIVE_TABLES.every((t) => syncDoc.includes(t)));
  check("docs/sync.md يذكر فهارس الأداء أو آلية التزامن الحالية", /idx_|realtime/i.test(syncDoc));

  // 8) cloud-schema.sql (نسخة الأساس التي تُلصق يدويًا) يجب أن تطابق ترحيل الـbaseline
  //    وإلا صار في المستودع «مرجعان» يتباعدان بصمت، ومن ينسخ القديم يبني نظامًا ناقصًا.
  const cloudPath = path.join(ROOT, "cloud-schema.sql");
  if (fs.existsSync(cloudPath)) {
    const cloud = parseSql(fs.readFileSync(cloudPath, "utf8"));
    const base = parseSql(fs.readFileSync(path.join(MIGRATIONS, files.find((f) => f.includes("baseline"))), "utf8"));
    const same = (a, b) => Object.keys(a).sort().join(",") === Object.keys(b).sort().join(",");
    const diffs = [];
    if (!same(base.tables, cloud.tables)) diffs.push("الجداول");
    if (!same(base.policies, cloud.policies)) diffs.push("السياسات");
    if (!same(base.functions, cloud.functions)) diffs.push("الدوال");
    if (!same(base.indexes, cloud.indexes)) diffs.push("الفهارس");
    check("cloud-schema.sql مطابق لترحيل الأساس (لا مرجعان متباعدان)", diffs.length === 0, diffs.join(" · "));
    const cloudHead = fs.readFileSync(cloudPath, "utf8").slice(0, 2000);
    check("cloud-schema.sql يحذّر أن ترحيلات supabase/migrations هي المرجع",
      cloudHead.includes("supabase/migrations"));
  }

  // 9) لا سر مكتوب داخل ملفات SQL
  //    ملاحظة مهمة: الاسم `service_role` **دور في PostgreSQL** لا سر — وقد يظهر
  //    مشروعًا في `grant … to service_role` (وهو مطلوب). الخطر الحقيقي هو **قيمة**
  //    المفتاح (JWT) أو كتابة سرّ صراحةً، والفحص القديم كان يخلط بين الاثنين.
  const secretRules = [
    { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, why: "JWT (توكن/مفتاح)" },
    { re: /(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SERVICE_ACCOUNT_KEY)/, why: "اسم مفتاح سري" },
    { re: /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, why: "قيمة سرّية مكتوبة صراحةً" },
  ];
  const dirty = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const r of secretRules) if (r.re.test(txt)) dirty.push(f + " (" + r.why + ")");
    // وإن ظهر اسم الدور: ممنوع أن يقترن بأي شيء يشبه مفتاحًا
    txt.split("\n").forEach((line, i) => {
      if (!/\bservice_role\b/i.test(line)) return;
      if (/service_role\b[^\n]{0,60}(eyJ|sk-|\bkey\s*[:=]|\btoken\s*[:=])/i.test(line)) {
        dirty.push(f + ":" + (i + 1) + " (اسم الدور مقترن بقيمة تشبه المفتاح)");
      }
    });
  }
  check("لا مفاتيح/أسرار داخل ملفات الترحيل (واسم الدور بلا قيمة سرّية)", dirty.length === 0, [...new Set(dirty)].slice(0, 4).join(" · "));
  const roleMentions = files.reduce((n, f) => n + (fs.readFileSync(path.join(MIGRATIONS, f), "utf8").match(/\bservice_role\b/gi) || []).length, 0);
  check("ذكر service_role في الترحيلات هو اسم دور لا سر (" + roleMentions + " ذكرًا)", roleMentions >= 0);

  return { results, inv, files };
}

// ── الوضع 2: المقارنة مع القاعدة الحقيقية ──────────────────────────
function drift(repo, live, liveLabel) {
  const rows = [];
  const add = (kind, name, note) => rows.push({ kind, name, note });

  for (const t of Object.keys(live.tables)) if (!repo.tables[t]) add("جدول", t, "على القاعدة وليس في المستودع");
  for (const t of Object.keys(repo.tables)) if (!live.tables[t]) add("جدول", t, "في المستودع ولم يُنفَّذ على القاعدة");

  const rtOf = (inv) => (inv.publications.has("*") ? null : inv.publications);
  const rtLive = rtOf(live), rtRepo = rtOf(repo);
  if (rtLive && rtRepo) {
    for (const t of rtLive) if (!rtRepo.has(t)) add("realtime", t, "مُفعَّل على القاعدة وليس في المستودع");
    for (const t of rtRepo) if (!rtLive.has(t)) add("realtime", t, "في المستودع وليس مُفعَّلًا على القاعدة");
  }

  // ⚠️ نتحقق بـ`in` لا بصدق القيمة: قيمة المشغّل في الجرد نص فارغ ("") وهي كاذبة
  // في JS — وهذا ما جعل كل المشغّلات تظهر «في المستودع وليس على القاعدة» كذبًا.
  const both = (liveMap, repoMap, kind, note1, note2) => {
    for (const n of Object.keys(liveMap)) if (!(n in repoMap)) add(kind, n, note1);
    for (const n of Object.keys(repoMap)) if (!(n in liveMap)) add(kind, n, note2);
  };
  both(live.indexes, repo.indexes, "فهرس", "على القاعدة وليس في المستودع", "في المستودع وليس على القاعدة");
  both(live.policies, repo.policies, "سياسة", "على القاعدة وليس في المستودع", "في المستودع وليس على القاعدة");
  both(live.functions, repo.functions, "دالة", "على القاعدة وليس في المستودع", "في المستودع وليس على القاعدة");
  both(live.triggers, repo.triggers, "مشغّل", "على القاعدة وليس في المستودع", "في المستودع وليس على القاعدة");

  // الأعمدة: ما على القاعدة وناقص من المستودع (وهو الأخطر عند إعادة البناء)
  for (const [t, cols] of Object.entries(live.tables)) {
    if (!repo.tables[t] || !cols.length) continue;
    for (const c of cols) if (!repo.tables[t].includes(c)) add("عمود", t + "." + c, "على القاعدة وليس في المستودع");
  }

  printDrift(rows, liveLabel, repo, live);
  return rows;
}

function printDrift(rows, liveLabel, repo, live) {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  T3.7 — انحراف المخطط: المستودع ↔ القاعدة الحقيقية");
  console.log("  المصدر: " + liveLabel);
  console.log("═══════════════════════════════════════════════════════════════");
  const count = (o) => Object.keys(o).length;
  console.log(
    "  المستودع: " + count(repo.tables) + " جدول · " + count(repo.policies) + " سياسة · " +
    count(repo.indexes) + " فهرس · " + count(repo.functions) + " دالة · " + count(repo.triggers) + " مشغّل"
  );
  console.log(
    "  القاعدة : " + count(live.tables) + " جدول · " + count(live.policies) + " سياسة · " +
    count(live.indexes) + " فهرس · " + count(live.functions) + " دالة · " + count(live.triggers) + " مشغّل"
  );
  if (!rows.length) {
    console.log("\n  ✅ لا انحراف — المستودع يطابق القاعدة الحقيقية بالكامل");
  } else {
    console.log("\n  ⚠️  " + rows.length + " اختلافًا:\n");
    const order = { "جدول": 0, "عمود": 1, "سياسة": 2, "فهرس": 3, "دالة": 4, "مشغّل": 5, realtime: 6 };
    rows.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    for (const r of rows) console.log("   • [" + r.kind + "] " + r.name + " — " + r.note);
    console.log("\n  المفتاح: «على القاعدة وليس في المستودع» تعني أن من يعيد البناء من المستودع لن يحصل عليها.");
  }
  console.log("─".repeat(63));
}

/** مسوّدة ترحيل من الكائنات الموجودة على القاعدة فقط */
function emitMigration(repo, live, file, liveLabel) {
  const lines = [
    "-- ═══════════════════════════════════════════════════════════════",
    "--  مسوّدة ترحيل تلقائية — كائنات على القاعدة الحقيقية وغير موجودة في المستودع",
    "--  المصدر: " + liveLabel,
    "--  ⚠️ راجعها قبل الالتزام: التعريفات منقولة كما هي من القاعدة.",
    "--  ✅ آمنة الإعادة: تُنفَّذ على نفس القاعدة بلا خطأ «already exists».",
    "-- ═══════════════════════════════════════════════════════════════",
    "",
  ];
  let n = 0;
  const grab = (inv, kind, name) => inv.raw[kind + ":" + name];
  // ⚠️ درس من اختبار الدورة الكاملة: المسوّدة التي تُنفَّذ على **نفس** القاعدة التي
  // جاءت منها كانت تفشل بـ«policy … already exists». المسوّدة يجب أن تكون آمنة
  // الإعادة (idempotent) وإلا صارت خطرًا لا مساعدة. فنُعيد صياغتها:
  //   create table → create table if not exists · create index → if not exists
  //   create policy → drop policy if exists ثم create policy
  const idempotent = (raw, kind, extra, extra_table) => {
    // نُلحق « if not exists» على النص الأصلي كما هو — بلا إعادة كتابة الكلمة
    // (كنا نُعيد كتابتها بحروف صغيرة فانكسر فحص يبحث عن `CREATE INDEX` كبيرًا).
    if (kind === "table") return raw.replace(/create table(?! if not exists)/i, (m) => m + " if not exists");
    if (kind === "index") return raw.replace(/create (unique )?index(?! if not exists)/i, (m) => m + " if not exists");
    if (kind === "policy") {
      // ⚠️ أوامر psql لا تكفي: `drop policy if exists <name>;` **خطأ صياغة** —
      // PostgreSQL يشترط الجدول: `drop policy if exists <name> on <جدول>`.
      // (كشفه تنفيذ المسوّدة فعليًا: «syntax error at or near ;».)
      const on = /create policy\s+"?([^"\s]+)"?\s+on\s+([^\s(]+)/i.exec(raw);
      const target = on ? on[2] : "public." + (extra_table || "");
      return target ? "drop policy if exists " + (extra || "") + " on " + target + ";\n" + raw : raw;
    }
    return raw;
  };
  for (const [t, cols] of Object.entries(live.tables)) {
    if (repo.tables[t]) continue;
    const raw = grab(live, "table", t);
    if (raw) { lines.push(idempotent(raw, "table") + ";", ""); n++; }
    else if (cols.length) {
      lines.push("-- جدول " + t + " موجود على القاعدة بلا تعريف نصي محفوظ — أعد تصديره.");
    }
  }
  for (const k of Object.keys(live.policies)) {
    if (repo.policies[k]) continue;
    const raw = grab(live, "policy", k);
    if (raw) {
      const pname = (live.policies[k] && live.policies[k].name) || k.split(".").pop();
      lines.push(idempotent(raw, "policy", pname, live.policies[k].table) + ";", ""); n++;
    }
  }
  for (const i of Object.keys(live.indexes)) {
    if (repo.indexes[i]) continue;
    const raw = grab(live, "index", i);
    if (raw) { lines.push(idempotent(raw, "index") + ";", ""); n++; }
  }
  for (const t of live.publications) {
    if (t === "*" || repo.publications.has(t) || repo.publications.has("*")) continue;
    lines.push("alter publication supabase_realtime add table public." + t + ";", "");
    n++;
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  if (n === 0) {
    console.log("\n  ℹ️  لا تعريفات نصية في هذا الملف: الجرد (SQL Editor) يعطي الأسماء لا التعريفات.");
    console.log("      لإصدار مسوّدة ترحيل قابلة للتنفيذ، مرّر نسخة كاملة:");
    console.log("      supabase db dump --schema public -f dump.sql && node scripts/verify-schema-drift.js dump.sql --emit-migration <ملف>");
    return;
  }
  console.log("\n  📝 مسوّدة الترحيل كُتبت: " + file + "  (" + n + " كائنًا)");
}

// ── التشغيل ────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const emitIdx = argv.indexOf("--emit-migration");
  const emitFile = emitIdx >= 0 ? argv[emitIdx + 1] : null;
  // ⚠️ كان `i !== emitIdx + 1` يستبعد الوسيط الأول دائمًا حين لا يوجد --emit-migration
  // (لأن emitIdx=-1 ⇒ emitIdx+1=0) فيُشغّل الفحص الذاتي بدل المقارنة.
  const skip = emitIdx >= 0 ? emitIdx + 1 : -1;
  const positional = argv.filter((a, i) => !a.startsWith("--") && i !== skip);

  if (!positional.length) {
    const { results, inv } = selfCheck();
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  T3.7 — فحص المخطط ذاتيًا (المستودع ↔ ما يستدعيه التطبيق)");
    console.log("═══════════════════════════════════════════════════════════════");
    let ok = 0;
    for (const r of results) {
      console.log("  " + (r.ok ? "✅" : "❌") + " " + r.name + (r.detail ? "  → " + r.detail : ""));
      ok += r.ok ? 1 : 0;
    }
    const rt = inv.publications.has("*") ? "كل الجداول الحيّة" : [...inv.publications].join(" · ");
    console.log("─".repeat(63));
    console.log("  الحصيلة: " + Object.keys(inv.tables).length + " جدول · " + Object.keys(inv.policies).length +
      " سياسة · " + Object.keys(inv.indexes).length + " فهرس · " + Object.keys(inv.functions).length +
      " دالة · " + Object.keys(inv.triggers).length + " مشغّل · realtime: " + rt);
    console.log("  النتيجة:  " + (ok === results.length ? "✅ " + ok + " ناجح" : "❌ " + (results.length - ok) + " فاشل") + " من " + results.length);
    console.log("─".repeat(63));
    console.log("\n  لمقارنة المستودع بالقاعدة الحقيقية:");
    console.log("   1) نفّذ scripts/schema-inventory.sql في Supabase SQL Editor وانسخ الناتج");
    console.log("   2) node scripts/verify-schema-drift.js inventory.txt");
    process.exit(ok === results.length ? 0 : 1);
  }

  const file = path.resolve(positional[0]);
  if (!fs.existsSync(file)) {
    console.error("❌ الملف غير موجود: " + file);
    process.exit(2);
  }
  const text = fs.readFileSync(file, "utf8");
  const isInventory = /^\s*(table|column|index|policy|function|trigger|publication)\s*\|/im.test(text);
  const live = isInventory ? parseInventoryText(text).inv : parseSql(text);
  const { inv: repo } = repoInventory();
  const rows = drift(repo, live, path.relative(ROOT, file) + (isInventory ? " (جرد من SQL Editor)" : " (نسخة pg_dump)"));
  if (emitFile && rows.length) emitMigration(repo, live, path.resolve(emitFile), path.basename(file));
  process.exit(rows.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { parseSql, parseInventoryText, repoInventory, selfCheck, drift, emitMigration };

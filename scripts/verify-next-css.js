#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  T2.4 — فاحص الكلاسات: أي className في تطبيق Next بلا تعريف في CSS؟
//  كان العطل: 60 كلاسًا مستخدمًا بلا أي تعريف → واجهة بلا تنسيق إطلاقًا.
//  التشغيل:  node scripts/verify-next-css.js
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CSS_FILE = path.join(ROOT, "app", "globals.css");

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const files = [
  ...listFiles(path.join(ROOT, "app")),
  ...listFiles(path.join(ROOT, "components")),
];

const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] || m[2] || m[3] || "";
    for (const tok of raw.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      const t = tok.trim();
      if (t && /^[a-zA-Z][\w-]*$/.test(t)) used.add(t);
    }
  }
}

const css = fs.readFileSync(CSS_FILE, "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

// كلاسات Tailwind تُولَّد عند البناء — لا تحتاج تعريفًا يدويًا
const TW = /^(flex|grid|block|hidden|relative|absolute|fixed|sticky|inline|w-|h-|p[xy]?-|m[xy]?-|gap|text-|bg-|border|rounded|shadow|font-|items-|justify-|overflow|truncate|space-|opacity-|z-|top-|left-|right-|bottom-|max-w|min-w|leading-|tracking-|cursor-|transition|duration-|hover:|focus:|sm:|md:|lg:|xl:|grid-cols|col-|aspect|object-|underline|animate|sr-only|whitespace|line-clamp|backdrop|translate|from-|via-|to-|placeholder|pointer-events|order-|basis-|grow|shrink|self-|place-|inset|first:|last:|group|dark:)/;

const missing = [...used].filter((c) => !defined.has(c) && !TW.test(c)).sort();

console.log("═══════════════════════════════════════════════════════════════");
console.log("  T2.4 — فحص كلاسات واجهة Next.js");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  ملفات TSX        : ${files.length}`);
console.log(`  كلاسات مستخدمة   : ${used.size}`);
console.log(`  مُعرَّفة في CSS   : ${[...used].filter((c) => defined.has(c)).length}`);
console.log("");

if (missing.length === 0) {
  console.log("  ✅ لا يوجد كلاس بلا تعريف — الواجهة منسّقة بالكامل");
  process.exit(0);
}

console.log(`  ❌ ${missing.length} كلاسًا بلا تعريف (ستظهر بلا تنسيق):`);
for (let i = 0; i < missing.length; i += 6) console.log("     " + missing.slice(i, i + 6).join(" · "));
console.log("");
console.log("  الإصلاح: أضف الأنماط في app/globals.css (أو انسخها من index.html)");
process.exit(1);

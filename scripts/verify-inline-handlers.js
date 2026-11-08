#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  T7.4 — سقف المعالجات المضمّنة (ratchet)
//
//  المشكلة: 374 معالجًا مضمّنًا في 11 ملفًا. تحويلها دفعة واحدة = مخاطرة
//  على شيفرة تبيع فعلًا. الحل: **سقف لا يزيد أبدًا**، وكل مرحلة تُخفّضه.
//
//  القاعدة: العدّ الفعلي يجب أن يكون **≤** الرقم في ملف السقف.
//  تحويل معالجات ← خفّض الرقم في scripts/inline-handlers-budget.json.
//  إضافة معالج جديد ← يفشل CI (لا نموّ للدَّين التقني).
//
//  التشغيل: node scripts/verify-inline-handlers.js [--update]
//    --update  يكتب العدّ الحالي كسقف جديد (يُستخدم بعد كل تحويل، بمراجعة)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUDGET = path.join(__dirname, 'inline-handlers-budget.json');
const TARGETS = [
  'index.html',
  ...fs.readdirSync(path.join(ROOT, 'web'))
    .filter(f => f.endsWith('.js'))
    .map(f => 'web/' + f),
];

// onclick / oninput / … في HTML أو داخل نصوص JS (سواء " أو \')
const RE = /\bon[a-z]{3,12}=\\?["']/g;

function stripComments(src) {
  // تعليقات الكتلة والتعليقات السطرية وتعليقات HTML — لا تُعَدّ معالجات
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function count(file) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return (src.match(RE) || []).length;
}

const actual = {};
for (const f of TARGETS) actual[f] = count(f);
const total = Object.values(actual).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  fs.writeFileSync(BUDGET, JSON.stringify({
    '_note': 'سقف المعالجات المضمّنة — لا يجوز أن يزيد. خفّضه بعد كل تحويل إلى data-act.',
    '_updated': new Date().toISOString().slice(0, 10),
    total,
    files: actual,
  }, null, 2) + '\n');
  console.log(`  📝 كُتب السقف: ${total} معالجًا`);
  process.exit(0);
}

const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8'));

let fail = 0;
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  T7.4 — سقف المعالجات المضمّنة (onclick/oninput/…)');
console.log('═══════════════════════════════════════════════════════════════\n');

const rows = Object.keys(actual).sort((a, b) => actual[b] - actual[a]);
for (const f of rows) {
  const cap = budget.files[f];
  const now = actual[f];
  if (now > (cap === undefined ? 0 : cap)) {
    console.log(`  ❌ ${f}  →  ${now} معالجًا (السقف ${cap === undefined ? 0 : cap})`);
    fail++;
  } else if (now > 0) {
    console.log(`  ✅ ${f}  →  ${now} (السقف ${cap})`);
  } else {
    console.log(`  🎉 ${f}  →  صفر معالج مضمّن`);
  }
}

if (total > budget.total) {
  console.log(`\n  ❌ الإجمالي زاد: ${total} > ${budget.total}`);
  fail++;
} else {
  const saved = budget.total - total;
  console.log(`\n  ✅ الإجمالي: ${total} · السقف ${budget.total}` + (saved > 0 ? `  (تحسّن ${saved} — خفّض السقف بـ--update)` : ''));
}

// شرط الحرية النهائي: صفر معالجات ⇒ CSP يجب ألّا تسمح بـ'unsafe-inline' في السكربت
if (total === 0) {
  const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const scriptSrc = (headers.match(/script-src([^;\n]*)/) || [])[1] || '';
  const strict = !/unsafe-inline/.test(scriptSrc);
  console.log(`  ${strict ? '✅' : '❌'} صفر معالجات ⇒ script-src بلا 'unsafe-inline'  → ${scriptSrc.trim()}`);
  if (!strict) fail++;
}

console.log('\n═══════════════════════════════════════════════════════════════');
const pct = budget.total ? Math.round((100 * (budget.total - total)) / budget.total) : 0;
console.log(fail === 0 ? `  ✅ لا انحدار · تقدُّم هذه المرحلة: ${budget.total} → ${total} (${pct}%)` : `  ❌ ${fail} انحدار`);
console.log('═══════════════════════════════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);

// ═══════════════════════════════════════════════════════════════════════════
//  T5.1 — كاشف «اعتماد ملف على ملف لاحق» في وقت التحميل
//
//  المشكلة التي يمنعها: في ملف واحد كان رفع الدوال (hoisting) يجعل ترتيب
//  التعريفات غير مهم. بعد التفكيك إلى سبعة سكربتات، أي *تنفيذ في المستوى
//  الأعلى* ينادي دالة معرّفة في ملف يأتي بعده = ReferenceError يوقف الملف كله
//  (وهو ما حدث فعلًا مع measureHeader).
//
//  الفحص: نحلل كل ملف بـacorn، نجمع المعرّفات المُعلنة في المستوى الأعلى في كل
//  ملف، ثم نتتبع مراجع المستوى الأعلى (خارج أي دالة) ونتأكد أن كل معرّف متاح
//  قبل موضعه: مُعلن في نفس الملف أو ملف سابق، أو أنه معلوم من المتصفح/المكتبات.
//
//  التشغيل:  node scripts/verify-boot-order.js
// ═══════════════════════════════════════════════════════════════════════════
"use strict";
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const ROOT = path.resolve(__dirname, "..");
const ORDER = ["core", "views", "ui", "ops", "admin", "cloud", "boot"];

/** أسماء متاحة دائمًا (بيئة المتصفح + مكتبات محلية + أسماء ES القياسية) */
const AMBIENT = new Set([
  "window", "document", "localStorage", "sessionStorage", "console", "navigator", "location",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "fetch", "btoa", "atob", "alert", "confirm", "prompt", "history",
  "screen", "performance", "crypto", "indexedDB", "structuredClone", "queueMicrotask",
  "JSON", "Math", "Date", "Object", "Array", "String", "Number", "Boolean", "Promise",
  "Map", "Set", "WeakMap", "WeakSet", "RegExp", "Error", "TypeError", "Symbol", "BigInt",
  "Intl", "URL", "URLSearchParams", "Blob", "File", "FileReader", "FormData", "TextEncoder",
  "TextDecoder", "Image", "Audio", "Event", "CustomEvent", "AbortController", "isNaN",
  "isFinite", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "escape",
  "unescape", "globalThis", "self", "caches", "supabase", "QRCode", "Chart", "jsQR",
  "ResizeObserver", "IntersectionObserver", "MutationObserver", "Notification", "Checksum",
  "ServiceWorkerRegistration", "CSS", "getComputedStyle", "matchMedia", "addEventListener",
  "eval", "undefined", "NaN", "Infinity", "arguments", "importScripts", "Uint8Array",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Proxy", "Reflect", "WeakRef", "FinalizationRegistry",
  "Element", "HTMLElement", "Node", "NodeList", "DOMParser", "XMLHttpRequest", "WebSocket",
  "requestIdleCallback", "cancelIdleCallback", "reportError", "visualViewport", "print",
]);

function topLevelDeclarations(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && node.id) names.add(node.id.name);
    else if (node.type === "ClassDeclaration" && node.id) names.add(node.id.name);
    else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        if (d.id.type === "Identifier") names.add(d.id.name);
        // أنماط التفكيك (destructuring)
        else if (d.id.type === "ObjectPattern")
          for (const p of d.id.properties) if (p.value && p.value.type === "Identifier") names.add(p.value.name);
        else if (d.id.type === "ArrayPattern")
          for (const el of d.id.elements) if (el && el.type === "Identifier") names.add(el.name);
      }
    }
  }
  return names;
}

/** المعرّفات المستخدمة في المستوى الأعلى فقط (خارج أجسام الدوال) */
function topLevelReferences(ast, out = []) {
  const walkStmt = (node, isNested) => {
    if (!node || typeof node.type !== "string") return;
    const type = node.type;
    // لا ندخل أجسام الدوال ولا الكلاسات: التنفيذ داخلها يحدث لاحقًا
    if (!isNested && (type === "FunctionDeclaration" || type === "FunctionExpression" ||
        type === "ArrowFunctionExpression" || type === "ClassDeclaration" || type === "ClassExpression")) {
      return;
    }
    if (type === "Identifier" || type === "PrivateIdentifier") {
      if (type === "Identifier") out.push(node);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach((c) => c && typeof c.type === "string" && walkStmt(c, isNested));
      else if (val && typeof val.type === "string") walkStmt(val, isNested);
    }
  };
  // كل شيء داخل المستوى الأعلى يُعدّ «نُفَّذ عند التحميل» إلا أجسام الدوال
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") continue;
    walkStmt(node, false);
  }
  return out;
}

/** مواضع تعريف كل معرّف كخاصية كائن في المستوى الأعلى (مثل: const CANONICAL_CLOUD = {...}) */
function violations() {
  const declared = new Map();   // name → رقم الملف (index) الذي عُرّف فيه
  const used = [];              // { name, file, line }
  const files = [];
  ORDER.forEach((name, idx) => {
    const code = fs.readFileSync(path.join(ROOT, "web", `${name}.js`), "utf8");
    const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true, allowReturnOutsideFunction: true });
    files.push({ name, code });
    for (const d of topLevelDeclarations(ast)) if (!declared.has(d)) declared.set(d, idx);
    for (const id of topLevelReferences(ast)) used.push({ name: id.name, file: idx, line: id.loc.start.line });
  });
  const bad = [];
  for (const u of used) {
    if (AMBIENT.has(u.name)) continue;
    if (!declared.has(u.name)) continue;                       // غير معرّف أصلًا (خطأ آخر/خاصية كائن)
    if (declared.get(u.name) > u.file) {
      bad.push({ ...u, file: ORDER[u.file], declaredIn: ORDER[declared.get(u.name)] });
    }
  }
  return { bad, files };
}

if (require.main === module) {
  const { bad, files } = violations();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  T5.1 — ترتيب التحميل: هل ينادي كودُ المستوى الأعلى ملفًا لاحقًا؟");
  console.log("═══════════════════════════════════════════════════════════");
  for (const f of files) console.log(`  • web/${f.name}.js  (${f.code.split("\n").length} سطرًا)`);
  if (!bad.length) {
    console.log("\n  ✅ لا اعتماد على ملفات لاحقة — كل نداء في المستوى الأعلى متاح قبل موضعه");
  } else {
    console.log(`\n  ❌ ${bad.length} موضعًا ينادي كودًا لم يُحمَّل بعد:`);
    for (const b of bad) console.log(`     web/${b.file}.js:${b.line}  →  ${b.name}() معرّفة في web/${b.declaredIn}.js`);
  }
  console.log("═══════════════════════════════════════════════════════════");
  process.exit(bad.length ? 1 : 0);
}

module.exports = { violations, ORDER };

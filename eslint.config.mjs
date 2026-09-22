// إعداد ESLint بصيغة flat (ESLint 9) — next lint صار مهملًا في Next 15
// نستخدم eslint-config-next عبر FlatCompat لأن الحزمة ما زالت بصيغة eslintrc.
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  // المخرجات والمكتبات المحلية المنسوخة لا تُفحص
  { ignores: ["out/**", "public/lib/**", "vendor/**", "public/**", ".next/**", "node_modules/**", "public/workbox-*.js", "public/sw.js", "next-env.d.ts",
    // 🧩 T5.1: كود التطبيق مفكوك في web/*.js — سكربتات كلاسيكية تعمل في النطاق العام
    // (لا import/export، تعتمد على ترتيب التحميل)، فلا تصلح لها قواعد الوحدات.
    // تُفحص نحويًا وتزامنيًا عبر tests/unit/web-split.test.ts + node --check.
    "web/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ملفات CommonJS حقًّا (سكربتات Node · next.config.js · service worker):
  // require() هو الصيغة الصحيحة فيها، فلا نُلزمها ESM.
  {
    files: ["scripts/**/*.js", "next.config.js", "sw.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // <img> مقصود: روابط المنتجات تأتي من المستخدم/التخزين وقد تكون data:/blob:
  // (next/image لا يتعامل معها)، وصفحة الخطوط تُحمَّل عبر layout في App Router
  // وليس pages/_document ⇒ القاعدتان لا تنطبقان على هذا المشروع.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: { "@next/next/no-img-element": "off", "@next/next/no-page-custom-font": "off" },
  },
];

export default config;

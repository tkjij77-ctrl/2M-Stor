// ═══════════════════════════════════════════════════════════════════
//  lib/security/csp.ts — سياسة أمن المحتوى للأسطح المبنية على Next.js
//
//  لماذا ملف منفصل: حتى تبقى السياسة **مصدرًا واحدًا** يقرأه كل من:
//    1) middleware.ts  — يضعها على كل استجابة (مع nonce لكل طلب)،
//    2) scripts/verify-static-headers.js — يقارنها بسياسة السطح الثابت
//       (`_headers` + <meta> في index.html) حتى لا ينحرف السطحان.
//
//  ⚠️ انحراف موثَّق ومُقاس: هذه السياسة **تحتوي** 'unsafe-inline' في
//  script-src، بخلاف السطح الثابت (`_headers` + <meta> في index.html) الذي
//  أُزيلت منه نهائيًا. السبب مُختبَر لا مُفترَض:
//
//    • Next.js يحقن 7 كتل <script> مضمّنة في كل صفحة (بيانات البث والترطيب).
//    • جرّبنا nonce لكل طلب (middleware + ترويسة x-nonce): التوليد صحيح
//      والسياسة تظهر في الترويسة، لكن Next لا يضع الـnonce على وسومه في
//      الصفحات **المُولَّدة مسبقًا** (○) — وهي كل صفحات المتجر — لأن HTML
//      يُبنى وقت البناء ولا nonce فيه. النتيجة المقيسة: 7 انتهاكات
//      script-src-elem وصفحة فارغة.
//    • الحل الكامل (nonce) يفرض `dynamic = 'force-dynamic'` على كل الصفحات،
//      أي إلغاء التوليد المسبق ونداء قاعدة البيانات في كل طلب — قرار أداء/
//      معمارية لا يُتخذ ضمن إصلاح أمني، وأُجِّل إلى T7.5.
//
//  ولذلك: السطح العام (المتجر الذي يراه الزوّار على Pages) صارم، وسطح Next
//  (لوحة/مخزن خلف تسجيل دخول) محصور الانحراف في script-src، وكل ما عداه
//  متطابق — وبوّابة verify-static-headers تفشل إن اتسع الانحراف أو تسرّب
//  'unsafe-inline' إلى السطح الثابت.
// ═══════════════════════════════════════════════════════════════════

/** الأساس الثابت للسياسة. (يبقى {NONCE} مدعومًا لو انتقل السطح إلى SSR.) */
export const CSP_BASE = [
  "default-src 'self'",
  // الانحراف الوحيد المسموح (مُوثَّق أعلاه) — ويُتحقَّق منه في CI
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ') + ';';

/** سياسة جاهزة لطلب واحد (nonce مُستخدَم إن قرّرت المرحلة القادمة SSR). */
export function buildCsp(nonce: string): string {
  return CSP_BASE.replace('{NONCE}', nonce);
}

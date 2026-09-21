// ملاحظة: @sentry/nextjs غير مثبّتة في package.json، وكان استيرادها
// يكسر `tsc --noEmit` و`next build`. إما:
//   1) npm i @sentry/nextjs  ثم أعد الاستيراد، أو
//   2) استخدم الحزمة الديناميكية التالية بلا كسر البناء.
export async function initSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import(/* webpackIgnore: true */ "@sentry/browser" as string);
    (Sentry as any).init({ dsn, tracesSampleRate: 0.2 });
  } catch {
    // الحزمة غير مثبّتة — نتجاهل بهدوء
  }
}

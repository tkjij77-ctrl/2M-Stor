import * as Sentry from "@sentry/nextjs";

export function initSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.2,
  });
}

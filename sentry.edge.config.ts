import * as Sentry from "@sentry/nextjs";

// Edge-runtime Sentry init. Loaded by src/instrumentation.ts when
// NEXT_RUNTIME is "edge" (middleware). Server routes use the Node config.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
});

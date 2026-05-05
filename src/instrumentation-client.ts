import * as Sentry from "@sentry/nextjs";

// Client-side Sentry init. Picked up automatically by Next.js when present
// at the project root (alongside instrumentation.ts). Errors thrown in
// React render, useEffect, etc. surface here.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Keep replay opt-in for now — even at 1% sampling it adds noticeable
  // bundle weight to the marketing pages.
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

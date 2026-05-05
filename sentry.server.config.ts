import * as Sentry from "@sentry/nextjs";

// Server-side Sentry init. Loaded by src/instrumentation.ts when NEXT_RUNTIME
// is "nodejs". Without a DSN this becomes a no-op so local dev doesn't
// require Sentry to be set up.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Trace ~10% of requests in prod; everything in dev so we can see the
  // shape of the data while wiring this up.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Send errors only when DSN is set; sentry-cli noise off.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",

  // Drop expected 401s from API routes that throw Response("unauthorized", 401)
  // — those are user-error noise, not bugs. Real exceptions still flow.
  ignoreErrors: ["unauthorized", "claim_lost"],
});

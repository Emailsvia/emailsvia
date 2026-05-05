// Next.js instrumentation hook: runs once per worker on server start so the
// Sentry SDK is initialised before any request handler. Imports are dynamic
// because runtime can be either Node.js (default for our routes) or Edge
// (the middleware), and each needs a different Sentry build.

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Also re-export onRequestError so server-side React render errors in
// route handlers and server components surface in Sentry. Following the
// docs at https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export { captureRequestError as onRequestError } from "@sentry/nextjs";

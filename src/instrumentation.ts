// Next.js instrumentation hook: runs once per worker on server start.
// Two responsibilities:
//   1. Initialise Sentry (server + edge).
//   2. Start a tiny in-process scheduler in dev that calls /api/tick every
//      60s and /api/check-replies every 5min — same cadence as Supabase
//      pg_cron does in production. Locally there's no scheduler hitting
//      the endpoints, so without this campaigns sit "running" forever.
//      No-op in production: Vercel/Supabase cron handles it.

export async function register() {
  // Sentry init — runtime-specific build chosen at module-load time.
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    } else if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.edge.config");
    }
  }

  // Local dev scheduler — only on the nodejs runtime, never in prod.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    startDevScheduler();
  }
}

// Re-export Sentry's onRequestError so server-side render errors surface
// in Sentry. https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export { captureRequestError as onRequestError } from "@sentry/nextjs";

// Use a globalThis flag so HMR / multiple register() calls don't spawn
// duplicate intervals.
type GlobalWithCron = typeof globalThis & { __emailsvia_dev_cron?: boolean };

function startDevScheduler() {
  const g = globalThis as GlobalWithCron;
  if (g.__emailsvia_dev_cron) return;
  g.__emailsvia_dev_cron = true;

  const baseUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const cron = process.env.CRON_SECRET;
  if (!cron) {
    // eslint-disable-next-line no-console
    console.log(
      "[dev-cron] CRON_SECRET not set in .env.local — local scheduler disabled. Set it and restart to enable."
    );
    return;
  }

  const auth = { Authorization: `Bearer ${cron}` };

  const tick = async () => {
    try {
      const r = await fetch(`${baseUrl}/api/tick`, { headers: auth, cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as {
        status?: string;
        to?: string;
        campaign?: string;
        sent_today?: number;
      };
      if (data.status === "sent") {
        // eslint-disable-next-line no-console
        console.log(
          `[dev-cron] tick → sent to ${data.to} (${data.campaign}, ${data.sent_today}/day)`
        );
      } else if (data.status && data.status !== "no_running_campaign" && data.status !== "all_throttled" && data.status !== "lock_held") {
        // eslint-disable-next-line no-console
        console.log(`[dev-cron] tick → ${data.status}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[dev-cron] tick error:", e instanceof Error ? e.message : e);
    }
  };

  const checkReplies = async () => {
    try {
      const r = await fetch(`${baseUrl}/api/check-replies`, { headers: auth, cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as { results?: unknown[] };
      const n = Array.isArray(data.results) ? data.results.length : 0;
      if (n > 0) {
        // eslint-disable-next-line no-console
        console.log(`[dev-cron] check-replies → polled ${n} sender(s)`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[dev-cron] check-replies error:", e instanceof Error ? e.message : e);
    }
  };

  // Wait 5s before first run so the dev server has finished booting.
  setTimeout(() => {
    void tick();
    void checkReplies();
    setInterval(tick, 60_000);          // 1/min — matches Supabase pg_cron
    setInterval(checkReplies, 5 * 60_000); // every 5 min — matches Supabase pg_cron
    // eslint-disable-next-line no-console
    console.log(
      "[dev-cron] scheduler started — /api/tick every 60s, /api/check-replies every 5min. (No-op in production.)"
    );
  }, 5_000);
}

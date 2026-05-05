import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

// withSentryConfig adds source-map upload + tunnels client errors through
// /monitoring to dodge ad-blockers. Both auth-token and project envs are
// optional — without them this is effectively a no-op wrap.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: "/monitoring",
  // Skip source-map upload entirely when no auth token is configured,
  // otherwise the Vercel build fails with a "missing token" warning.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  disableLogger: true,
});

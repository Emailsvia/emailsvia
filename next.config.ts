import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Self-contained server bundle (only the node_modules actually imported)
  // for the Railway Docker image — smaller image, lower idle memory.
  output: "standalone",
  // Type-checking (googleapis' types especially) needs >4GB of heap, which
  // OOMs container builders. The Dockerfile sets SKIP_TYPECHECK=1; run
  // `npx tsc --noEmit` before deploying instead.
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
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

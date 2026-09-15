import { defineRailway, preserve, project, service } from "railway/iac";

// Values live in Railway (set via `railway variables`), never in this file.
// A variable missing from this list gets DELETED on apply — add new ones here.
const VARS = [
  "ADMIN_USER_IDS",
  "ANTHROPIC_API_KEY",
  "AI_PROVIDER",
  "APP_URL",
  "CRON_SECRET",
  "EMAIL_VERIFIER_API_KEY",
  "EMAIL_VERIFIER_PROVIDER",
  "ENCRYPTION_SECRET",
  "GEMINI_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GROQ_API_KEY",
  "NEXT_PUBLIC_GA_ID",
  "NEXT_PUBLIC_SENTRY_DSN",
  "POSTMARK_FROM_EMAIL",
  "POSTMARK_FROM_NAME",
  "POSTMARK_MESSAGE_STREAM",
  "POSTMARK_SERVER_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_SCALE",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
];

// EmailsVia lives in its own Railway project, separate from Taskly's, so it
// never shares a container with them. Everything below keeps its footprint
// small. Build + start come from the repo's Dockerfile.
export const partial = "emailsvia";

export default defineRailway(() => {
  const emailsvia = service("emailsvia", {
    env: Object.fromEntries(VARS.map((k) => [k, preserve()])),
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    // Single replica. Region (Singapore, nearest to Supabase in AWS
    // ap-northeast-1) is set with `railway scale` — IaC doesn't diff it.
    replicas: 1,
    deploy: {
      // Stop when idle. supabase/cron.sql only calls the app when there's
      // a running campaign / opted-in reply poll, so idle = asleep.
      sleepApplication: true,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      // Hard ceiling. Node heap is capped at 384MB in the Dockerfile.
      limitOverride: { containers: { cpu: 1, memoryBytes: 536870912 } },
    },
  });
  return project("emailsvia", {
    resources: [emailsvia],
  });
});

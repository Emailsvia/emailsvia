# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (in-process scheduler hits /api/tick + /api/check-replies on real cron cadence)
npm run build    # next build (also runs the Sentry source-map upload if SENTRY_AUTH_TOKEN is set)
npm run lint     # next lint
npm start        # next start, requires a prior build
```

There is **no test runner** in this repo. Verification is manual via the dev server + the dev-only "Run tick" button in the campaign UI.

Both `dev` and `start` pass `NODE_OPTIONS=--max-http-header-size=32768` to handle large Supabase auth cookie chains — don't strip that.

Path alias `@/*` → `src/*` is set in `tsconfig.json`.

## Architecture

### What this app is

EmailsVia is a Gmail-native cold-email platform: it sends personalised mail-merge campaigns **through the user's own Gmail** (OAuth or app-password), not from shared infrastructure. Reputation stays with the user's domain. Everything — UI, API, cron-driven send loop, reply ingestion, AI triage — lives in this one Next.js 15 App Router project.

### Three-zone URL model (`src/middleware.ts`)

The product is split at the URL level. **An admin account never lands in `/app`** — the middleware actively bounces admins out so operator and tenant contexts can't mix.

- `/app/*` — authenticated, non-admin users. Product UI.
- `/admin/*` — authenticated users whose UUID is in the `ADMIN_USER_IDS` env (comma-separated). Operator surface. Admin check is in-process; no DB hit.
- `/(marketing)/*`, `/pricing`, `/privacy`, `/terms`, `/u/[token]`, `/auth/callback` — always public.
- `/api/*` — middleware passes through; each handler enforces its own auth.

Signed-in users hitting `/` or any auth surface get redirected to `homeFor(admin)` — `/admin` or `/app`. There's also an OAuth safety net at `/` that forwards `?code=` to `/auth/callback` if Supabase is misconfigured.

### Supabase clients — two distinct factories

- `supabaseUser()` in `src/lib/supabase-server.ts` — anon key + cookies. **RLS engages**. Use for every user-initiated API handler. Server-component-only (imports `next/headers`).
- `supabaseAdmin()` in `src/lib/supabase.ts` — service role. **Bypasses RLS**. Reserved for cron paths (`/api/tick`, `/api/check-replies`, `/api/cron/*`), the tracking pixel, unsubscribe handler, and OAuth callbacks where there's no end-user JWT.

Mixing these up is the most common security failure mode in this codebase. RLS is the multi-tenancy boundary — if you reach for `supabaseAdmin` in a user-facing route, you've just unscoped every query in that handler.

### The send loop (`/api/tick`)

`pg_cron` (Supabase) or Vercel Cron hits `GET /api/tick` every minute with a bearer (`CRON_SECRET`, verified via `cronBearerOk` in `src/lib/tokens.ts`).

Single-threaded by design:

1. Acquire a 75s distributed lock via the `try_tick_lock` RPC (`emailsvia:tick` key). If held, return `lock_held`.
2. Fetch all `status='running'` campaigns, sort by oldest last-successful-send for fairness across tenants.
3. For the first campaign passing every gate (schedule window, `start_at`, `gap_seconds`, plan daily cap via `assertCanSend`, `subscriptions.suspended_at`, warmup cap, campaign daily cap): pick a sender (single or rotation pool from `campaign_senders`), pick the next pending recipient, render the template, send.
4. One recipient per tick. Bounds blast radius — if a send hangs, the lock releases in 75s and the next tick retries.

Errors are classified into a coarse taxonomy by `src/lib/errors.ts` (`auth_revoked | smtp_timeout | rate_limit | bounce_permanent | bounce_temporary | other`); transient ones retry with exponential backoff (`next_retry_at`), permanent ones don't. `auth_revoked` flips the sender to `oauth_status='revoked'` via `sender-revoke.ts`, which fires a one-time Postmark alert and surfaces an in-app banner.

The effective per-tick send cap is `min(plan.daily_cap, campaign.daily_cap, warmup_cap_for_sender)` (`src/lib/warmup.ts`, 14-day ramp 10 → 400). Inbox rotation is **sticky per recipient** — once a recipient is sent by sender X, all follow-ups must come from X or `In-Reply-To` threading breaks.

### Cron jobs

| Path | Cadence | Purpose |
|---|---|---|
| `/api/tick` | 1 min | Main send loop |
| `/api/check-replies` | 5 min | IMAP/Gmail API poll → reply correlation → AI triage |
| `/api/cron/refresh-tokens` | hourly | Refresh sender OAuth access tokens |

Cron is wired **twice** in this repo: `vercel.json` (Vercel Cron, used in production) and `supabase/cron.sql` (pg_cron + pg_net, fallback for free-tier deployments where Vercel Hobby caps cron at 1/day). Both can run safely — the tick lock prevents duplicate sends. See `DEPLOY.md` step 2.4 for how to disable pg_cron once Vercel Cron is live.

`vercel.json` also sets `maxDuration` for the long-running routes (tick, check-replies, recipient import, sheet validation, `/api/v1/campaigns/from-sheet`). The dev server runs the same cadence in-process so campaigns auto-progress locally.

### Reply ingestion

`/api/check-replies` iterates all senders, polls inbox (Gmail API for OAuth senders, IMAP via `imapflow` for app-password senders), parses MIME with `mailparser`, correlates inbound mail back to recipients via `Message-ID` / `In-Reply-To` / `References` headers, flips the recipient to `replied`, and inserts a row in `replies`. If the user's plan has AI, `src/lib/triage.ts` classifies the body into one of 7 intents.

AI provider selection (`src/lib/ai-provider.ts`) auto-picks the cheapest configured: explicit `AI_PROVIDER` env first, else priority `GROQ_API_KEY` > `GEMINI_API_KEY` > `ANTHROPIC_API_KEY`. Without any key set, replies still arrive — they just don't get an `intent` label and `{{ai:...}}` merge tags resolve to empty strings.

### Database

Source of truth: `supabase/schema.sql` + 14 migrations in `supabase/migrations/`. Multi-tenancy enforced by `user_id` columns + Postgres RLS. Key tables: `senders`, `campaigns`, `recipients`, `follow_up_steps`, `send_log`, `tracking_events`, `replies`, `unsubscribes`, `subscriptions`, `plans`, `usage_daily`, `campaign_senders` (rotation pool), `tick_locks`, `api_keys` (SHA-256 hashed), `webhooks` + `webhook_deliveries`, `ai_personalizations`, `processed_stripe_events` (Stripe idempotency), `admin_audit`. Don't introduce a new table without an `auth.users` FK + an RLS policy gated on `auth.uid()`.

### Plan / billing gate

`src/lib/billing.ts` is the single source of truth for "can this user do X". Anywhere a feature is plan-gated — UI, API handler, cron — go through `getPlanForUser` + `hasFeature` + `assertCanSend`. Subscription statuses `active` / `trialing` / `past_due` count as entitled (past_due is the grace window); `unpaid` / `canceled` drop to free immediately; `suspended_at` (operator-set in `/admin`) blocks sending at the cron edge regardless of plan.

### Crypto + tokens

- `src/lib/crypto.ts` — AES-256-GCM with `ENCRYPTION_SECRET`. Encrypts sender app passwords + OAuth refresh tokens at rest. Rotating this secret leaves existing rows unreadable.
- `src/lib/tokens.ts` — HMAC-SHA256 with `ENCRYPTION_SECRET` (NOT `SESSION_SECRET` — the env example mentions both, but the code uses `ENCRYPTION_SECRET` for both encryption and HMAC). Signs unsubscribe tokens, tracking pixel/click URLs, OAuth state, and verifies the cron bearer (`cronBearerOk` uses `timingSafeEqual`).

### Public API + webhooks

Scale plan only. `POST /api/v1/campaigns/from-sheet` takes a Google Sheet URL + template and creates a draft/started campaign. API keys are SHA-256 hashed (`eav_live_…` prefix shown once). Outbound webhooks (`reply.received`, `reply.classified`, `recipient.unsubscribed`, `campaign.finished`) are HMAC-SHA256 signed; deliveries stored in `webhook_deliveries`.

### Sheets add-on

`apps-script/` is a Google Workspace add-on (Apps Script, deployed via `clasp`) that calls the public API. It's a separate ship target — when you publish, it gets moved to its own repo. Treat this folder as reference, not a build dependency.

## Conventions specific to this repo

- **Dark-only UI.** `src/app/layout.tsx` hard-asserts `data-theme="dark"` SSR + wipes stale `localStorage` theme keys on hydration. There is no theme toggle. Don't add light-mode tokens.
- **Body editor uses Tiptap + `tiptap-markdown` for Markdown ↔ HTML round-trip.** Pasting from Gmail/Docs preserves formatting. `BodyEditor.tsx` is the entry point.
- **All inbound mail HTML rendering uses `isomorphic-dompurify`** — replies are attacker-controlled.
- **Strict merge** (`campaigns.strict_merge = true`): missing required `{{tag}}` → recipient marked `skipped`, not sent with an empty interpolation. `missingMergeFields` in `src/lib/template.ts`.
- **`/auth/callback` rejects protocol-relative + non-slash `next` values** as open-redirect protection. Don't loosen this without thinking.
- `experimental.serverActions.bodySizeLimit` is bumped to 10mb in `next.config.ts` for recipient list uploads. Sentry is wrapped via `withSentryConfig` with `/monitoring` as the tunnel route (dodges ad-blockers).

## Reference docs in this repo

- `README.md` — setup / Supabase / first campaign walkthrough
- `DEPLOY.md` — production deploy checklist (migrations, Vercel env, Stripe live mode, Postmark domain verification, Google OAuth verification)
- `EMAILSVIA.md` — full product + architecture spec (35K+ words, includes mermaid diagrams of every flow)
- `ABOUT.md` — narrative product positioning
- `supabase/schema.sql` + `supabase/migrations/*` — DB source of truth
- `supabase/cron.sql` — pg_cron + pg_net setup (run once, edits via `update public.cron_config`)

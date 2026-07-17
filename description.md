# EmailsVia — Technical Description

A self-hosted cold-email platform that runs personalized outreach campaigns from the user's own Gmail accounts. Open-source analogue to Mailmeteor / Lemlist / Instantly, designed to fit entirely on free tiers (Vercel + Supabase + Gmail SMTP/OAuth).

This document is the consolidated technical picture: what we built, why each piece exists, and how the parts fit together. For setup, see [README.md](README.md); for the product story, [ABOUT.md](ABOUT.md); for the deep design notes, [EMAILSVIA.md](EMAILSVIA.md).

---

## 1. What the product does

A signed-in user can:

1. **Connect a sender** — link a Gmail inbox via OAuth (preferred) or app password.
2. **Create a campaign** — write a subject + Markdown body with `{{merge_tags}}`, upload recipients (CSV, XLSX, or Google Sheets URL).
3. **Configure autopilot** — pick send days/hours, daily cap, gap between sends, timezone.
4. **Add follow-ups** — multi-step sequences threaded as `Re:` replies, auto-stop when the recipient replies.
5. **Run the campaign** — the platform takes over: paces sends inside the window, applies warmup, retries SMTP failures, tracks opens/clicks (opt-in), detects replies (opt-in), classifies reply intent with AI (opt-in), and respects unsubscribes.
6. **Watch the inbox** — replies surface in `/app/replies` with AI intent labels (interested / question / not now / unsubscribe / auto-reply).
7. **Pay** — Stripe-backed tier (Free / Starter / Growth / Scale). The free tier covers the basics; paid tiers unlock higher caps, AI personalization, AI reply triage.

Everything multi-tenant: each row is owned by an `auth.users.id`, RLS keeps tenants isolated, the service-role client is reserved for cron + webhooks.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) | Server Components for auth-gated pages, Route Handlers for the API, Vercel-native. |
| Language | **TypeScript** (strict) | Catches the merge-tag, schedule, and token-decoding mistakes that bite at runtime. |
| Styling | **Tailwind CSS** + a small set of shared primitives in `src/components/app/` | No design system overhead. Dark theme forced via SSR `data-theme`. |
| Editor | **tiptap** + tiptap-markdown | WYSIWYG body editor that round-trips Markdown cleanly; paste from Gmail/Docs/Word preserves formatting. |
| DB | **Supabase Postgres** | Free tier, RLS, `pg_cron` + `pg_net` for scheduled work. |
| Storage | **Supabase Storage** (`attachments` bucket) | Up to 5 files per campaign. |
| Auth | **Supabase Auth** (email/password + Google OAuth) via `@supabase/ssr` | JWT cookies, no homegrown session crypto. |
| Mail send | **nodemailer** (SMTP) for app-password senders, **googleapis** (Gmail API) for OAuth senders | Single send path, two transport backends. |
| Reply ingestion | **imapflow** + **mailparser** for app-password senders, **Gmail API** for OAuth senders | Same code-path branches on `senders.auth_method`. |
| AI | **Anthropic** / **Gemini** / **Groq** (pluggable via `lib/ai-provider.ts`) | Reply triage and `{{ai:…}}` personalization. Cheapest-first priority: Groq → Gemini → Anthropic. |
| Billing | **Stripe** (Checkout + Billing Portal + webhooks) | Plans, dunning, Stripe Tax. |
| Observability | **Sentry** | Server + client error tracking, no-op when DSN absent. |
| Hosting | **Vercel** | App + Routing Middleware. |
| Cron | **Supabase `pg_cron` + `pg_net`** | Vercel free tier maxes out at daily cron; we need per-minute. |

Notably absent: no Redis, no separate worker, no queue. The "queue" is the `recipients.status = pending` rows and the per-minute tick that drains them.

---

## 3. Repository layout

```
EmailsVia/
├── src/
│   ├── app/
│   │   ├── (auth)/                Login & sign-up routes
│   │   ├── (marketing)/           Landing, pricing, legal pages
│   │   ├── api/
│   │   │   ├── tick/              Per-minute send loop
│   │   │   ├── check-replies/     5-min reply poller
│   │   │   ├── cron/refresh-tokens/  Hourly OAuth token refresh
│   │   │   ├── campaigns/         CRUD + recipient import + activity
│   │   │   ├── senders/           Sender mgmt + OAuth connect
│   │   │   ├── replies/           Reply list/detail
│   │   │   ├── webhooks/          User-facing webhooks (outbound)
│   │   │   ├── stripe/            Stripe webhook + checkout/portal links
│   │   │   ├── admin/             Admin dashboard endpoints
│   │   │   ├── app/               Per-user app endpoints (alerts, dashboard, settings)
│   │   │   ├── auth/              OAuth callback handler
│   │   │   ├── keys/              API key issuance
│   │   │   ├── sheets/            Google Sheets fetch
│   │   │   ├── v1/                External REST API (consumed by Apps Script add-on)
│   │   │   ├── t/o/, t/c/         Open pixel + click redirect
│   │   │   ├── u/[token]/         One-click unsubscribe
│   │   │   ├── dev/               Local-dev-only utilities
│   │   │   └── health/            Liveness + DB ping
│   │   ├── app/                   Authenticated UI (campaigns, replies, senders, billing, keys, webhooks, settings)
│   │   ├── admin/                 Admin console (gated by ADMIN_USER_IDS)
│   │   └── u/[token]/             Public unsubscribe page
│   ├── components/                React components (CampaignForm, BodyEditor, AppShell, …)
│   ├── lib/                       Shared backend modules (see §6)
│   ├── middleware.ts              Next.js middleware — rewrites OAuth ?code= to /auth/callback
│   ├── instrumentation.ts         Sentry server init
│   └── instrumentation-client.ts  Sentry client init
├── supabase/
│   ├── schema.sql                 Idempotent schema (run on fresh install)
│   ├── cron.sql                   pg_cron + pg_net setup
│   └── migrations/                Forward-only migrations 0002…0015
├── apps-script/                   Google Sheets add-on (sidebar + menu) talking to /api/v1
├── public/, sentry.*.config.ts, next.config.ts, tailwind.config.ts, vercel.json
├── README.md                      Setup + ops runbook
├── ABOUT.md                       Product narrative
├── EMAILSVIA.md                   In-depth architecture/design notes (the "why")
├── DEPLOY.md                      Deployment checklist
└── CLAUDE.md                      Repo conventions for AI-assisted edits
```

---

## 4. Data model

All tenant-scoped tables carry `user_id uuid references auth.users(id) on delete cascade` plus an RLS policy `user_id = auth.uid()`. The service-role key is used inside cron + tracking + webhooks where there is no signed-in user.

### Core tables

| Table | Role |
|---|---|
| `senders` | A user's connected Gmail accounts. Holds either `app_password` (AES-GCM encrypted) **or** OAuth tokens (`oauth_refresh_token`, `oauth_access_token`, `oauth_expires_at`, `oauth_status`). `warmup_enabled` + `warmup_started_at` drive the 14-day ramp. |
| `campaigns` | One campaign per send. Schedule (jsonb), `daily_cap`, `gap_seconds`, `window_start_hour`/`window_end_hour`, `timezone`, `status` (`draft`/`running`/`paused`/`done`), feature toggles (`tracking_enabled`, `unsubscribe_enabled`, `follow_ups_enabled`, `retry_enabled`), attachments. |
| `recipients` | One row per recipient per campaign. `status` machine: `pending → sent → replied | unsubscribed | bounced` (or `failed`/`skipped`). Carries `vars jsonb` for merge tags, `message_id` for threading follow-ups, `next_follow_up_at`, `next_retry_at`. |
| `follow_up_steps` | Per-campaign ordered steps with `delay_days` + `template` + optional `subject` override. |
| `send_log` | Append-only audit of every send (initial / follow_up / retry). Drives daily-cap and warmup-cap counters. |
| `tracking_events` | `open` and `click` events (only inserted when the campaign has `tracking_enabled=true`). 2-minute open-dedup window absorbs Gmail's image-proxy prefetch storm. |
| `unsubscribes` | Composite PK `(user_id, email)` — per-tenant suppression list. |
| `replies` | Captured inbound mail tied back to a `recipient_id`. Stores text + HTML + AI intent label. |

### Billing / ops

| Table | Role |
|---|---|
| `plans` | Plan catalog (Free / Starter / Growth / Scale) with feature flags (AI personalization, AI reply triage, sender count cap, daily send cap, watermark — now retired in 0014). |
| `subscriptions` | One row per user. Tracks Stripe customer/subscription id, status, `current_period_end`, `cancel_at_period_end`, `suspended_at` (operator hold). |
| `api_keys` | Hashed API tokens for the Sheets add-on and direct API access. |
| `user_webhooks` | Per-user outbound webhooks (campaign + reply events). |
| `webhook_deliveries` | Delivery log with retry state. |
| `user_settings` | **New in 0015** — per-user defaults (`tracking_enabled_default`, `poll_replies`), both default `false`. Gates the reply poller and seeds the campaign form. |

### Locks + counters

- `try_tick_lock(lock_key, ttl_seconds)` / `release_tick_lock(lock_key)` — PG advisory-lock + lease row so overlapping pg_cron + manual curl don't race. Used by `/api/tick` and `/api/check-replies`.
- Indexes on `(user_id)`, `(campaign_id, status)`, `(campaign_id, row_index)`, `(next_retry_at)`, `(next_follow_up_at)`, `(campaign_id, domain)` — every hot query in `tick` and `check-replies` hits an index.

### Migrations

Forward-only, idempotent. Roughly:

- `0002_multitenant` — added `user_id` everywhere, real RLS, per-tenant unsubscribe PK.
- `0003_sender_oauth` — OAuth refresh/access tokens on `senders`, `auth_method` discriminator.
- `0004_billing` — `plans`, `subscriptions`, Stripe linkage.
- `0005_observability` — error-class columns on `send_log`, structured failures.
- `0006_strict_merge` — `recipients.status='skipped'` for missing-merge-field rows.
- `0007_inbox_rotation` — multi-sender rotation per campaign.
- `0008_reply_intent` — AI intent label on `replies`.
- `0009_scale_infra` — partitioning / indexes for high-volume tenants.
- `0010_api_keys` — hashed keys + scope.
- `0011_prod_hardening` — null/check tightening.
- `0012_v2_features` — strict-merge default, follow-up condition refinements.
- `0013_admin_ops` — operator suspension + ban list.
- `0014_kill_watermark` — removed the free-tier "Sent with EmailsVia" footer.
- `0015_user_settings` — per-user tracking opt-ins; flips `campaigns.tracking_enabled` default to `false`.

---

## 5. Request + worker flows

### 5.1 The send loop — `/api/tick`

Hit every minute by `pg_cron` in Supabase (and once per minute by an in-process timer during `npm run dev` so local campaigns auto-progress).

```
pg_cron → POST https://APP_URL/api/tick (Bearer CRON_SECRET)
   │
   ├─ try_tick_lock("emailsvia:tick", 55s)   ← short lease, single in-flight
   │
   ├─ pick the next due (campaign, recipient) pair
   │     - campaign.status='running'
   │     - inside (timezone, days, window_start_hour..window_end_hour)
   │     - daily-cap not exceeded (warmup-aware cap if warmup_enabled)
   │     - gap_seconds elapsed since last send
   │     - recipient.status in ('pending') OR retry/follow-up due
   │
   ├─ render template (Markdown → HTML via `lib/template.ts`)
   │     - resolve {{merge_tag}} from recipient.vars
   │     - resolve {{ai:prompt}} via `lib/personalize.ts` (paid tiers)
   │     - inject open-pixel + click-rewrite ONLY if campaign.tracking_enabled
   │     - inject unsubscribe link + List-Unsubscribe header if campaign.unsubscribe_enabled
   │
   ├─ pick attachments (storage download, up to 5)
   │
   ├─ send via `lib/mail.ts`
   │     - OAuth sender → Gmail API send (auto-refresh token on 401)
   │     - app-password sender → SMTP via nodemailer
   │
   ├─ on success → recipients.status='sent', store Message-ID for threading,
   │   schedule next follow-up if configured, write send_log row
   ├─ on transient failure + retry_enabled → schedule next_retry_at
   └─ on permanent failure → status='failed' or 'bounced', mark sender revoked
       if auth_revoked, fire user webhook + email notice via Postmark
```

Key design choices:

- **One send per tick** keeps the function under Vercel's free-tier timeout and bounds blast radius if something goes wrong.
- **Lease lock** prevents two simultaneous deliveries from double-charging Anthropic and racing on `oauth_access_token`.
- **Daily-cap with warmup curve** in `lib/warmup.ts` — Day 1 = 10, Day 14 = 400 — applied on top of campaign's `daily_cap`.
- **Tracking is now opt-in** — `tracking_enabled=false` ⇒ no pixel, no link rewrites, the `/api/t/*` endpoints are never hit.

### 5.2 The reply poller — `/api/check-replies`

Hit every 5 minutes by `pg_cron`.

```
pg_cron → POST /api/check-replies (Bearer CRON_SECRET)
   │
   ├─ try_tick_lock("emailsvia:check-replies", 55s)
   │
   ├─ SELECT senders.*; bulk-load user_ids that have user_settings.poll_replies=true
   ├─ filter senders down to opted-in users (huge resource saver — 0015)
   │
   └─ for each opted-in sender:
        ├─ OAuth: gmail.listInboxSince(since=7d ago)
        │     - refresh access token if expired, persist new tokens
        │     - mark sender revoked on auth_revoked
        ├─ App password: imapflow.fetchIncomingMessages(...)
        │
        ├─ match each inbound message to a recipient:
        │     - first by In-Reply-To / References → recipients.message_id
        │     - else by from-address → recipients.email for this sender
        │
        ├─ skip auto-replies (`auto-submitted`, vacation, OOO)
        ├─ skip bounces (DSN, mailer-daemon)
        │
        ├─ insert into `replies` (dedup on recipient_id + received_at)
        ├─ flip recipient.status='replied', set replied_at
        ├─ optionally classify via `lib/triage.ts` (AI provider, paid tiers)
        └─ fire user webhook `reply.received`
```

The opt-in gate (introduced in `0015_user_settings`) is the biggest knob: users who never look at replies inside the app cost zero Gmail/AI quota.

### 5.3 OAuth token refresh — `/api/cron/refresh-tokens`

Hourly job that proactively refreshes any `senders.oauth_expires_at` within 30 minutes of expiry. Avoids the cold-tick latency hit of refreshing inline.

### 5.4 Open / click tracking

- `/api/t/o/[token].gif` returns a 1×1 transparent GIF. Decodes HMAC-signed token → recipient. Records a `tracking_events` row of kind `open`, but only if there hasn't been one in the last **2 minutes** (Gmail's image proxy prefetches the pixel 3-10× on arrival).
- `/api/t/c/[token]?u=…` decodes the token, logs a `click`, then 302s to `u`. Validates `u` is `http(s)://` to block protocol-relative redirects.
- Both endpoints **always return 200** even on bad tokens — never leak token validity to scrapers.

### 5.5 Unsubscribe

- `/u/[token]` is the public landing page (HMAC-signed token → recipient).
- One-click POST hits `/api/unsubscribe`, inserts `(user_id, email)` into `unsubscribes`, flips the recipient + all matching recipients for that user.
- `List-Unsubscribe: <mailto>, <https>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers are injected at send time so Gmail's native one-click works.

### 5.6 Stripe billing

- `/api/stripe/checkout` returns a Stripe Checkout session URL.
- `/api/stripe/portal` returns a Billing Portal session URL.
- `/api/stripe/webhook` handles `customer.subscription.{created,updated,deleted}` + `invoice.payment_failed`. Signature verified with `STRIPE_WEBHOOK_SECRET` (constant-time).
- Plan capabilities (`plans.ai_personalization`, `plans.ai_reply_triage`, `plans.daily_send_cap`, `plans.sender_cap`) gate features at the relevant call sites.

### 5.7 External API + Sheets add-on

- `apps-script/` is a Google Apps Script add-on that talks to `/api/v1/*` using an API key (issued at `/app/keys`).
- The add-on lets users start a campaign from inside Google Sheets without leaving the spreadsheet.

---

## 6. Backend modules (`src/lib`)

| Module | Responsibility |
|---|---|
| `supabase.ts` | `supabaseAdmin()` — service-role client. Bypasses RLS. Used by cron + tracking + webhooks. |
| `supabase-server.ts` | `supabaseUser()` — cookie-bound client. RLS engages. Used by every authenticated route handler. |
| `auth-server.ts` | `getUser()` / `requireUser()` helpers wrapping the user client. |
| `mail.ts` | SMTP send via nodemailer (app-password senders). |
| `gmail.ts` | OAuth send + inbox listing via Gmail API. Auto-refreshes expired tokens. |
| `replies.ts` | IMAP polling for app-password senders. Parses RFC 822 with mailparser. |
| `template.ts` | `render(template, vars)` resolves `{{merge_tags}}` and `{{ai:…}}`; `toHtml` does Markdown → HTML with sanitization + pixel/link-wrap injection. |
| `personalize.ts` | Resolves `{{ai:prompt}}` tags via the active AI provider. |
| `triage.ts` | Reply intent classification (interested / question / not now / unsubscribe / auto-reply / bounce). |
| `ai-provider.ts` | Pluggable selector — picks Groq > Gemini > Anthropic by available key, honoring `AI_PROVIDER` pin. |
| `crypto.ts` | AES-GCM `encryptSecret` / `decryptSecret` for sender creds. Key: `ENCRYPTION_SECRET`. |
| `tokens.ts` | `signToken(kind, id)` / `verifyToken(kind, raw)` HMAC over recipient ids. Kinds: `o` (open), `c` (click), `u` (unsub). Also `cronBearerOk` for cron auth. |
| `warmup.ts` | 14-day ramp curve mapping `warmup_started_at` → effective daily cap. |
| `spam.ts` | Pre-send spam-word check, used at draft-time. |
| `email-validator.ts` | Syntax + MX-aware validation + bounded-concurrency `mapWithLimit`. |
| `sheets.ts` | Google Sheets URL → rows fetch. |
| `xlsx.ts` | XLSX/CSV → rows parse. |
| `attachment.ts` | Storage download + filename safety. |
| `billing.ts` | Resolves a user's plan + entitlements. |
| `stripe.ts` | Stripe SDK + price-id constants. |
| `transactional.ts` | Postmark adapter for system mail (sender-revoked, payment failed). |
| `sender-revoke.ts` | Marks a sender revoked + emits user alert + webhook. |
| `errors.ts` | `classifyError(e)` → `auth_revoked` / `rate_limited` / `transient` / `permanent`. |
| `follow-up-condition.ts` | "Skip follow-up if recipient already replied" gating. |
| `oauth-state.ts` | Signed state for Gmail-connect OAuth flow. |
| `webhooks.ts` | Outbound webhook dispatcher with retries + signature. |
| `api-key.ts` | Hash + verify external API keys. |
| `admin.ts` | Operator role check (allow-listed via `ADMIN_USER_IDS`). |
| `user-settings.ts` | **New** — `loadUserSettings(userId)` for the form, `loadReplyPollUserIds(userIds)` for the reply poller. |
| `time.ts`, `variants.ts` | Misc helpers (timezone math, A/B subject variants). |

---

## 7. Configuration

### Environment variables

Required:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_SECRET` — 32+ char hex; AES-GCM key for sender creds + HMAC tokens. Rotating without re-encryption bricks every connected sender.
- `CRON_SECRET` — bearer token for `/api/tick`, `/api/check-replies`, `/api/cron/refresh-tokens`. Mirrored in `cron_config.cron_secret` inside Postgres.
- `APP_URL` — absolute origin used in pixel/click/unsubscribe URLs. **Production must not be `http://localhost:3000`** or every email ships broken tracking links.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — for sender-Gmail connect.

Optional (each goes silently no-op if unset):

- `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` (+ `AI_PROVIDER` pin) — AI features.
- `STRIPE_*` — billing.
- `POSTMARK_*` — transactional system mail.
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — error reporting + source-map upload.
- `ADMIN_USER_IDS` — comma-separated allow-list for `/app/admin`.

`.env.example` is the source of truth for variable names; `.env.local` (dev) and `.env.prod` (mirror of Vercel) are gitignored.

### Supabase

- Run [`supabase/schema.sql`](supabase/schema.sql) once on a fresh DB, then any [`supabase/migrations/*.sql`](supabase/migrations) in order.
- Enable extensions `pg_cron` and `pg_net`.
- Edit + run [`supabase/cron.sql`](supabase/cron.sql) — it creates `public.cron_config(key, value)` rows for `app_url` and `cron_secret`, then schedules two jobs that read from it. Rotating either is a one-line `update`.

### Vercel

- Function default timeout 300s; `/api/tick`, `/api/check-replies` declare `maxDuration = 60`.
- Routing Middleware ([src/middleware.ts](src/middleware.ts)) catches root-level OAuth `?code=` and rewrites it to `/auth/callback`.

---

## 8. Security model

- **Auth** — Supabase JWT cookies via `@supabase/ssr`. Server components read them through `supabaseUser()`. No custom session crypto.
- **RLS** — every tenant-scoped table has a `user_id = auth.uid()` policy. The user client (anon key + cookie) honors it. The service-role client bypasses it and is restricted to: cron handlers, tracking endpoints, Stripe webhook, admin endpoints, public unsubscribe page.
- **Encryption at rest** — sender app passwords and OAuth refresh tokens are AES-GCM encrypted using `ENCRYPTION_SECRET`. Plaintext is never logged.
- **Token signing** — open, click, unsubscribe, and OAuth-state tokens are HMAC-signed. `verifyToken` returns `null` (silent failure) rather than throwing.
- **Constant-time comparisons** — cron bearer, Stripe signature, webhook signature use `crypto.timingSafeEqual`.
- **Input sanitization** — reply HTML rendered through `isomorphic-dompurify` (inbound mail is attacker-controlled).
- **Open-redirect hardening** — `/auth/callback` and click redirect reject protocol-relative + non-http(s) `next`/`u` values.
- **Rate-limit hooks** — Stripe webhook + `/api/tick` are lease-locked so a manual curl can't double-deliver.
- **Tracking opt-in** — `0015_user_settings` flips opens/clicks/replies to opt-in. The default user inserts zero tracking_events rows and never has their inbox polled.

---

## 9. Operations runbook (condensed)

| Symptom | Where to look |
|---|---|
| Campaign stuck "running", no sends | `select * from cron.job where jobname like 'mail-automation%'` → both active? Then `select status_code, content::text from net._http_response order by created desc limit 10`. |
| 401 from cron | `CRON_SECRET` on Vercel ≠ `cron_config.cron_secret` row. Re-paste, redeploy. |
| 404 DEPLOYMENT_NOT_FOUND from cron | `cron_config.app_url` is stale (Vercel URL changed). `update public.cron_config set value='https://new' where key='app_url'`. |
| Broken pixels / unsub links in delivered mail | `APP_URL` is `http://localhost:3000` in prod env. |
| Sender shows "Reconnect" banner | OAuth refresh failed (revoked or password changed). `senders.oauth_status='revoked'`. User clicks reconnect → fresh OAuth round-trip. |
| AI reply triage missing labels | No AI key set, or plan doesn't include reply triage. Both are graceful no-ops. |
| Reply poller doing nothing | `select user_id from user_settings where poll_replies=true` — user has to opt in (introduced 0015). |

Sentry breadcrumbs cover the send loop, reply poller, Stripe webhook, and OAuth refresh paths.

---

## 10. Testing + local dev

- `npm run dev` runs Next.js with an in-process scheduler that hits `/api/tick` every minute and `/api/check-replies` every 5 minutes against `localhost`, matching the prod cadence so campaigns auto-progress without manual curls.
- `/api/dev/*` routes (gated to non-production) expose admin shortcuts: force-tick a campaign, fake a Stripe upgrade, reset a sender's OAuth state.
- A `Run tick` button on the campaign detail page (visible in dev) calls `/api/tick` once for that campaign.
- No formal test suite yet — type-check + manual QA via the dev scheduler.

---

## 11. What's new vs the README

The README covers setup and ops. This document additionally pins down:

- The **per-user `user_settings` table** (migration `0015`) that makes opens/clicks/replies opt-in. By default a new account creates zero `tracking_events` rows and the reply poller skips its senders.
- The **module map** in `src/lib` — what each helper owns.
- The **migration history** in order, with the rationale for each.
- The **lease-lock + advisory-lock pattern** used by `/api/tick` and `/api/check-replies` to make overlapping cron deliveries safe.
- The **graceful-degradation rule**: every optional integration (AI, Postmark, Stripe, Sentry) no-ops cleanly when its env var is missing, so dev never needs the full credential set.

For the long-form story behind these decisions, read [EMAILSVIA.md](EMAILSVIA.md).

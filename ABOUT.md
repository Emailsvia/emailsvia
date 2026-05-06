# EmailsVia — what it is, what's in it, how it works

A complete reference for the codebase as of the latest commit. Read this end-to-end once and you'll know where everything lives and why.

> Companion docs: [`README.md`](README.md) for a quick orientation, [`DEPLOY.md`](DEPLOY.md) for the production deployment runbook, and the migration files under [`supabase/migrations/`](supabase/migrations/) for the canonical schema.

---

## 1. The product, in one paragraph

EmailsVia is a multi-tenant cold-email SaaS. Users sign up, connect their own Gmail (OAuth or app password), upload a recipient list (CSV / Excel / Google Sheet / Apps Script add-on), and ship a campaign that sends from their own outbox. The platform handles per-sender warmup ramps, threaded follow-ups, hard-fail merge validation, inbox rotation across 10 connected Gmails, AI reply triage via Claude Haiku, open/click tracking with HMAC-signed pixels, an unsubscribe rail, multi-tier plans + Stripe billing, and a public API + Google Workspace Marketplace add-on. Positioned as **"Mailmeteor with cold-outreach DNA"** — warmup on every paid tier from $9, which Mailmeteor only ships at $24.99.

**Locked decisions** (anchor point for every design choice):
- Brand: **EmailsVia**, domain `emailsvia.com`, tracking subdomain `t.emailsvia.com`.
- ICP: mass-market funnel (free 50/day) → cold-outreach upsell.
- Pricing: $0 Free / $9 Starter / $19 Growth / $39 Scale.
- Sender model: OAuth + app-password fallback. Beta runs on app-password while Google verification is pending.
- Distribution wedge: Google Sheets add-on (Chrome extension deferred to v2).
- No trials. Always-free 50/day with watermark is the top of funnel.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router, React 19) | Server components for fast page loads, route handlers for API |
| Language | **TypeScript strict mode** | Caught half the bugs at compile time |
| Database | **Supabase Postgres** + **RLS** | Free tier, hosted auth + storage included, RLS = per-user isolation built into the DB |
| Auth | **Supabase Auth** (email+password + Google OAuth) | One provider for users + identity, no homegrown session crypto |
| Sender mail | **Gmail API** (OAuth) + **nodemailer SMTP** (app password) | Two paths, switched at send time on `senders.auth_method` |
| Reply polling | **Gmail API** (`users.messages.list`) for OAuth + **imapflow** for app password | Same downstream pipeline, switched at the source |
| Transactional mail | **Postmark** | Separate sending lane for system mail (sender-revoked / dunning) so it never sits behind a user's flaky Gmail |
| Billing | **Stripe Checkout** + **Stripe Tax** + **Customer Portal** | Stripe Tax kills VAT/GST/sales-tax research entirely (flat 0.5%) |
| AI reply triage | **claude-haiku-4-5** with prompt caching | ~$0.0001/reply at break-even cache; structured-outputs JSON schema |
| Background jobs | **Supabase pg_cron** (dev) + **Vercel Cron** (prod) — both call our `/api/tick` style routes | No queue infra, no Redis, no background worker — Postgres + HTTP + a lease lock |
| Observability | **Sentry** (server + edge + client) + custom `/app/admin` dashboard | DSN-optional so dev costs nothing |
| Hosting | **Vercel** | Functions for the API, edge for middleware, Cron schedules in `vercel.json` |
| Styling | **Tailwind CSS** + a tiny custom design token set in `globals.css` | No component library; every screen is hand-rolled |
| Editor | **Tiptap** (used in campaign body editor) | Rich text → markdown for the template field |

Notable libs: `@anthropic-ai/sdk` (haiku), `googleapis` (Gmail), `imapflow` + `mailparser` (IMAP path), `xlsx` (CSV/Excel parser), `marked` (markdown render), `cmdk` (command palette), `isomorphic-dompurify` (reply HTML sanitization), `zod` (every API body validates through it), `pg`-via-Supabase-client (no direct pg).

---

## 3. URL zones

```
public marketing      /            landing
                      /pricing     four-tier comparison
                      /privacy     privacy policy (Limited-Use disclosure for Google verification)
                      /terms       ToS

auth surface          /login
                      /signup
                      /forgot
                      /auth/callback   (Supabase OAuth + email-confirm callback)

product (gated)       /app                  campaigns list
                      /app/campaigns/new
                      /app/campaigns/[id]
                      /app/campaigns/[id]/edit
                      /app/senders
                      /app/replies
                      /app/billing
                      /app/keys             API keys for the public API + Sheets add-on
                      /app/admin            ADMIN_USER_IDS-gated metrics dashboard

public utility        /u/[token]            HMAC-signed unsubscribe landing
                      /api/t/o/[token].gif  HMAC-signed open pixel
                      /api/t/c/[token]      HMAC-signed click redirect
                      /api/unsubscribe      one-click unsubscribe POST (RFC 8058)

API (own auth)        /api/auth/*           login / signup / logout / forgot / google / google/connect|callback
                      /api/campaigns/*      session-auth product CRUD
                      /api/senders/*
                      /api/replies/*
                      /api/billing
                      /api/keys/*
                      /api/v1/campaigns/from-sheet   public Bearer-key API
                      /api/stripe/*         checkout / portal / webhook
                      /api/admin            ADMIN_USER_IDS-gated metrics
                      /api/health           liveness probe
                      /api/tick             cron — sends one recipient per call
                      /api/check-replies    cron — polls inbox per sender
                      /api/cron/refresh-tokens   cron — preemptive OAuth refresh
                      /api/dev/*            DEV-ONLY shortcuts (404 in prod)
```

The middleware at [`src/middleware.ts`](src/middleware.ts) does the routing logic:
- **API routes** are never gated (handlers do their own auth).
- **Always-public pages** (`/pricing`, `/privacy`, `/terms`, `/auth/callback`, `/u/*`) skip any session check.
- **Auth pages** (`/login`, `/signup`, `/forgot`) → if already signed in, redirect to `/app` (no "logged in but login page still loads" footgun).
- **Landing** (`/`) → same: signed-in users go to `/app`.
- **`/app/*`** → require Supabase session, refresh cookies on the response, redirect signed-out users to `/login?next=...`.

---

## 4. Data model

12 user-data tables + 3 ops tables. Every user-data table has `user_id uuid not null references auth.users(id) on delete cascade` and an `own_rows` RLS policy (`user_id = auth.uid()`).

### User-data tables

| Table | What it stores | Key columns / notes |
|---|---|---|
| `senders` | One row per connected Gmail | `auth_method` ∈ `app_password \| oauth`, `oauth_status` ∈ `ok \| revoked \| pending`, encrypted `app_password` / `oauth_refresh_token` / `oauth_access_token`, `warmup_enabled` + `warmup_started_at` |
| `campaigns` | One row per email campaign | `status` ∈ `draft \| running \| paused \| done`, `daily_cap`, `gap_seconds`, `schedule jsonb` (per-weekday windows), `follow_ups_enabled`, `tracking_enabled`, `unsubscribe_enabled`, `strict_merge`, `attachment_paths text[]`, `known_vars text[]` |
| `recipients` | One row per email × campaign | `status` ∈ `pending \| sent \| failed \| skipped \| replied \| unsubscribed \| bounced`, `vars jsonb` (merge tags), `message_id` (RFC 5322 — used for reply correlation), `domain` (generated column, lower-case mailbox domain), `next_follow_up_at`, `next_retry_at` |
| `follow_up_steps` | Sequence per campaign | `step_number`, `delay_days`, `subject`, `template` |
| `send_log` | Per-send audit trail | `kind` ∈ `initial \| follow_up \| retry`, `error_class` (set on failures, null on success — drives the campaigns/cap counter), `sender_id` (set under inbox rotation) |
| `tracking_events` | Open + click events | `kind` ∈ `open \| click`, `url`, `user_agent`, dedup'd against the Gmail image-proxy via a 2-min window |
| `replies` | Inbound mail correlated to a recipient | `intent` ∈ 7 enum values (set by Haiku triage), `intent_confidence`, `body_text`, `body_html` (sanitized at render via DOMPurify) |
| `unsubscribes` | Per-user opt-out list | PK is `(user_id, email)` — two users can independently track the same address |
| `campaign_senders` | N:M for inbox rotation | `weight` reserved for future weighted-random; today the picker just chooses least-loaded |
| `subscriptions` | One row per user (auto-created by trigger on signup) | `plan_id` ∈ `free \| starter \| growth \| scale`, Stripe `customer_id` + `sub_id`, `status` |
| `usage_daily` | Per-user per-day send count | Drives plan daily-cap enforcement |
| `api_keys` | Personal access tokens for the public API | SHA-256 `key_hash` (raw token shown once at creation), `prefix` for UI identification, `last_used_at` |

### Catalog / ops tables

| Table | Purpose |
|---|---|
| `plans` | Catalog of the four tiers (id, daily_cap, sender_limit, monthly_price_cents, features jsonb). Seeded by `supabase/migrations/0004_billing.sql` |
| `tick_locks` | Lease-based distributed lock for `/api/tick` and `/api/check-replies` (Postgres advisory locks would release per-statement under pgbouncer transaction mode) |
| `processed_stripe_events` | Webhook idempotency — Stripe retries on any non-2xx; we dedup on `event.id` |
| `cron_config` | Holds `app_url` + `cron_secret` for Supabase pg_cron jobs (revoked from anon/auth/service so only postgres reads it) |

### One-shot Postgres functions

| Function | What it does |
|---|---|
| `handle_new_user()` (trigger on `auth.users` insert) | Auto-creates a `subscriptions` row with `plan_id='free'` so the rest of the app can assume the row exists |
| `try_tick_lock(lock_key, ttl_seconds)` / `release_tick_lock(lock_key)` | Lease-based mutex used by both cron paths |
| `campaign_status_counts(p_user_id)` | Returns `(campaign_id, total, sent, failed)` per campaign — replaces the previous N+1 of three head-count queries × N campaigns |
| `set_updated_at()` (trigger) | Stamps `updated_at` on `campaigns` updates |

### Storage

- One bucket: `attachments`, scoped by RLS to objects whose first folder segment is `auth.uid()::text`. Upload path is `${user_id}/${campaign_id}/${random}-${filename}`.

---

## 5. The big user flows

### 5.1 Signup → first send (~5 minutes)

1. **Visitor on `/`** sees the landing page (hero + 6 feature cards + CTA). Clicks "Get started".
2. **`/signup`** — pick "Continue with Google" (Supabase OAuth) or email + password.
3. Supabase creates `auth.users` row → trigger creates `subscriptions` (plan_id=`free`).
4. Browser lands on `/app` (campaigns list, empty state).
5. **`/app/senders`** → "Connect Gmail" → `/api/auth/google/connect` → Google consent (`gmail.send` + `gmail.readonly`) → `/api/auth/google/callback` → `verifyGmailAccess` confirms it works → `senders` row inserted with encrypted refresh + access tokens.
6. **`/app/campaigns/new`** — fill in name + subject + template, upload a CSV / Excel / paste a Sheet URL, save.
7. Pre-flight banner on `/app/campaigns/[id]` shows missing merge fields if any.
8. Click **Start sending**.
9. Tick fires (Vercel Cron in prod, in-process scheduler in dev) → picks the next pending recipient → renders template → sends via Gmail API → inserts `send_log` row → bumps `usage_daily`.
10. UI auto-refreshes, "Sent N of M" climbs.

### 5.2 Reply detection (every 5 min)

1. `/api/check-replies` cron fires.
2. Acquires the `emailsvia:check-replies` lease lock.
3. Lists every `senders` row.
4. For each sender: branches on `auth_method` (Gmail API for OAuth, IMAP for app password). Pulls inbox messages from the last 7 days.
5. Filters out bounces (mailer-daemon / DSN). Auto-replies kept (the user wants to see OOO).
6. Two-pass match against the user's recipients:
   - **Authoritative**: `In-Reply-To` / `References` headers contain a stored outbound `recipients.message_id`.
   - **Fallback**: From-address matches a recipient.
7. Upserts a `replies` row keyed on `(recipient_id, received_at)` (dedup across ticks).
8. Marks the recipient `status='replied'`, clears `next_follow_up_at`.
9. **AI triage**: if the user is on Growth or Scale, queues unclassified replies. Calls Haiku with prompt caching, capped at 25 classifications per tick, concurrency 4. Writes back `intent` + `intent_confidence`.

### 5.3 Inbox rotation (Scale tier)

A campaign with `campaign_senders` rows enables rotation. Each tick:
1. Fetches today's send count per attached sender from `send_log`.
2. Filters eligible: OAuth status `ok`, `today_count < warmup_cap_for_sender`.
3. Picks the **least-loaded** eligible sender (ties broken by largest remaining headroom).
4. Sends through that one. `send_log.sender_id` records who actually ran.

A 10K-recipient campaign across 10 connected Gmails on Scale → each Gmail stays under its own warmup ceiling.

### 5.4 Billing upgrade

1. **`/app/billing`** — current plan card + 4-tier grid + today's usage bar.
2. Click "Upgrade to Growth" → POST `/api/stripe/checkout` → server creates a Checkout Session with `automatic_tax: true` and `customer_email` → returns the Stripe-hosted URL.
3. User pays with `4242 4242 4242 4242` (test) or a real card.
4. Stripe redirects to `/app/billing?status=success`.
5. Stripe fires `customer.subscription.created` → `/api/stripe/webhook` verifies signature, dedupes via `processed_stripe_events`, updates `subscriptions.plan_id`.
6. UI auto-detects the new plan on next poll, "Current plan" flips to Growth.
7. To cancel / change card: "Manage subscription" → POST `/api/stripe/portal` → Stripe Customer Portal.

If `invoice.payment_failed` fires, the row flips to `past_due` (still entitled for one grace period) and a Postmark dunning email goes out.

### 5.5 Sender revocation

1. User revokes EmailsVia's Gmail access from `https://myaccount.google.com/permissions`.
2. Next tick that picks this sender → `sendViaGmailApi` → Google returns `invalid_grant`.
3. `classifyError` → `auth_revoked`.
4. `markSenderRevoked(...)` runs a conditional `UPDATE ... WHERE oauth_status='ok'` — only the FIRST detection writes the row. Concurrent ticks see zero rows updated and skip.
5. The same first-detection caller fires `sendSenderRevokedNotice` via Postmark.
6. UI surfaces a "revoked — reconnect" pill on `/app/senders`.

---

## 6. Background jobs (cron)

| Job | Schedule | What it does | Source |
|---|---|---|---|
| `emailsvia-tick` | every minute | Sends one recipient (or one follow-up / one retry). Distributed lease lock so two ticks don't race. | [`src/app/api/tick/route.ts`](src/app/api/tick/route.ts) |
| `emailsvia-check-replies` | every 5 min | Polls inbox per sender, correlates replies, triages with Haiku. Same lease lock pattern. | [`src/app/api/check-replies/route.ts`](src/app/api/check-replies/route.ts) |
| `emailsvia-refresh-tokens` | minute 7 of every hour | Walks senders whose OAuth access token expires within 2h, refreshes preemptively. Catches `invalid_grant` in a low-stakes context. | [`src/app/api/cron/refresh-tokens/route.ts`](src/app/api/cron/refresh-tokens/route.ts) |

In **production** these are scheduled by Vercel Cron via [`vercel.json`](vercel.json). In **dev** an in-process `setInterval` inside [`src/instrumentation.ts`](src/instrumentation.ts) calls them at the same cadence (ticks fail loudly when `CRON_SECRET` isn't set). Both fire over HTTP at the same routes — the cron source is interchangeable. Both also work simultaneously without conflict; the lease lock dedups.

---

## 7. Plan tiers

Defined in [`supabase/migrations/0004_billing.sql`](supabase/migrations/0004_billing.sql), enforced by [`src/lib/billing.ts`](src/lib/billing.ts).

| Tier | Price | Daily cap | Senders | Watermark | Key feature gates |
|---|---|---|---|---|---|
| **Free** | $0 | 50/day | 1 | Yes | No follow-ups, no AI, 100-row imports |
| **Starter** | $9/mo | 500/day | 1 | No | Follow-ups, scheduling, tracking, **warmup ON** |
| **Growth** | $19/mo | 1,500/day | 3 | No | A/B testing, **AI reply triage**, AI personalization, conditional sequences |
| **Scale** | $39/mo | 5,000/day | 10 | No | **Inbox rotation**, email verification, **public API**, priority support |

`getPlanForUser()` returns the user's effective plan (drops to Free if subscription status isn't in `{active, trialing, past_due}`). `assertCanSend()` enforces the daily cap; `hasFeature()` gates individual features; `importRowLimit()` returns the row cap (or null = unlimited).

The watermark is added by [`src/lib/template.ts`](src/lib/template.ts) `toHtml()` / `toPlain()` when the user is on Free — same site as the unsubscribe footer + tracking pixel.

---

## 8. Public API + Sheets add-on

### Personal access tokens

`/app/keys` lets a user create / revoke `eav_live_…` tokens. Format: `eav_live_<32 chars Crockford base32>` (no 0/O/1/I/L). Stored as SHA-256 hash; raw token shown once at creation. The page also has a curl example pre-filled with `window.location.origin`.

### Public API endpoint

`POST /api/v1/campaigns/from-sheet` — Bearer-token auth, **Scale tier only** (`plan.features.public_api`). Accepts `{name, subject, template, rows[]}` plus optional flags (`from_name`, `sender_id`, `follow_ups_enabled`, `tracking_enabled`, `unsubscribe_enabled`, `strict_merge`, `daily_cap`). Each row needs at minimum `email`; `name` and `company` are recognized; everything else passes through as merge tags.

Behavior:
- Plan gate (402 with friendly message if not Scale).
- Row-count gate against `plan.import_row_limit`.
- Sender-id ownership check (clean 400 instead of an opaque RLS error).
- Dedupes by lowercase email.
- Chunks inserts at 1000/batch.
- CORS enabled (`Access-Control-Allow-Origin: *`) with explicit `OPTIONS` handler.
- Returns `{campaign_id, recipient_count, duplicates_skipped}`.

### Sheets add-on

The Apps Script project lives in [`apps-script/`](apps-script/). Self-contained; intended to move to its own repo (`emailsvia-sheets-addon/`) when the user is ready to publish to the Google Workspace Marketplace.

- [`appsscript.json`](apps-script/appsscript.json) — manifest with `spreadsheets.currentonly`, `script.external_request`, `userinfo.email` scopes, V8 runtime, `onHomepage` trigger.
- [`Code.gs`](apps-script/Code.gs) — entry points: `onHomepage`, `saveApiKey`, `clearApiKey`, `sendMerge`, `readActiveSheetRows` (treats row 1 as headers, requires an `email` column case-insensitively).
- [`Cards.gs`](apps-script/Cards.gs) — two-state card UI: "Connect" form when no key on file, "Send mail merge" form once connected.
- [`EmailsVia.gs`](apps-script/EmailsVia.gs) — `UrlFetchApp` wrapper around the public API. Honors an `EMAILSVIA_BASE_URL` script-property override for local dev tunnels.
- [`README.md`](apps-script/README.md) — clasp setup walkthrough + Marketplace publishing checklist.

The user pastes their `eav_live_…` key once; it's stored in `PropertiesService.getUserProperties()` (per-user, never leaves their Google account). On "Send mail merge", the add-on POSTs the active sheet's rows to `/api/v1/campaigns/from-sheet` and opens the new campaign in a new tab.

---

## 9. Security posture

- **Auth**: Supabase Auth handles password hashing + Google OAuth + session JWTs. No homegrown crypto for sessions.
- **RLS everywhere**: every user-data table has `own_rows` (`user_id = auth.uid()`). Service-role client (`supabaseAdmin`) bypasses RLS and is reserved for cron + tracking pixels + webhooks; user-facing route handlers use `supabaseUser` (anon key + cookie session) so RLS engages.
- **Sender credentials encrypted at rest**: app passwords + OAuth refresh tokens encrypted via AES-256-GCM with `ENCRYPTION_SECRET` (PREFIX `enc:v1:`). [`src/lib/crypto.ts`](src/lib/crypto.ts).
- **Tracking + unsubscribe URLs HMAC-signed**: tampering invalidates them. Single secret, constant-time comparison. [`src/lib/tokens.ts`](src/lib/tokens.ts).
- **OAuth state HMAC-signed**: 15-minute replay window. [`src/lib/oauth-state.ts`](src/lib/oauth-state.ts).
- **API keys**: SHA-256 hash stored, raw token shown once at creation. Awaited `last_used_at` write (Vercel kills the function on response, fire-and-forget would silently drop).
- **Stripe webhook**: signature-verified against the raw body (we cannot use `req.json()` first); idempotent via `processed_stripe_events` so retries can't clobber state.
- **Reply HTML sanitized via isomorphic-dompurify**: inbound HTML is attacker-controlled (anyone can mail your recipients). Allow-list HTML profile, denies `iframe`/`object`/`form`/`input`/`button`/`style`/inline event handlers.
- **Open redirect defense**: `/auth/callback` rejects protocol-relative + non-slash `next` values.
- **Public-API plan gate**: `eav_live_…` tokens only work for Scale-tier users.
- **CORS**: explicit `OPTIONS` + headers on `/api/v1/*` for browser SDK clients.
- **`appUrl()` throws in production** when `APP_URL` is unset — silent localhost defaults would have 404'd every tracking pixel and unsubscribe link.
- **Storage RLS**: attachments bucket scoped to `auth.uid()/...` prefix.
- **Cron routes bearer-secured**: `cronBearerOk` does constant-time `Bearer ${CRON_SECRET}` comparison.

---

## 10. Observability

| Surface | What you get |
|---|---|
| **Sentry** | Server + edge + client errors; tagged `route` / `error_class` / `kind` for the cron paths so the dashboard groups cleanly. DSN-optional — without `NEXT_PUBLIC_SENTRY_DSN` the SDK is a true no-op. Tunnel route at `/monitoring` so client errors pass ad-blockers. Source-map upload is opt-in via `SENTRY_AUTH_TOKEN`. |
| **`/app/admin`** | `ADMIN_USER_IDS`-gated. Renders MRR, paying users, plan distribution, sends + errors over 24h / 7d, error rate, top error classes, signups (7d / 30d), free→paid conversion (30d), 10 most recent signups. |
| **`/api/health`** | DB round-trip check (counts the `plans` table). 200 when healthy, 503 when DB is down. Exposed publicly so Vercel + uptime monitors can probe it. |
| **`error_class` on `send_log`** | Classified by [`src/lib/errors.ts`](src/lib/errors.ts) into 9 buckets: `auth_revoked / auth_failed / rate_limit / quota_exceeded / recipient_invalid / network / tls / attachment / unknown`. Failed sends are inserted into `send_log` with the class set; admin dashboard groups by it. |
| **Cron diagnostics** | Each cron route returns a JSON summary (`{status, results, triage}`) so you can see the result via direct curl or via Vercel function logs. |

---

## 11. Dev-mode shortcuts (404 in prod)

Some flows are painful to test without spinning up real Stripe products / pasting cookies forever. Three dev-only routes are gated by `NODE_ENV !== "production"`:

| Route | What it does |
|---|---|
| `POST /api/dev/set-plan` | Flips the caller's `subscriptions.plan_id` directly. Used by the `/app/billing` page when no `STRIPE_PRICE_*` env vars are configured (amber "Dev mode" banner shows). |
| `POST /api/dev/tick` | Calls `/api/tick` server-side with `CRON_SECRET` injected; supports `{burst: N}` to loop up to 30 times. Powers the "Run tick" button on the campaign detail page. |

All three return 404 on a production build — the route literally doesn't respond.

The dev-mode banner on `/app/billing` only appears when `dev_mode: true` AND `stripe_configured: false` (both reported by `/api/billing` GET). Once you set the three `STRIPE_PRICE_*` env vars, the upgrade buttons switch to real Stripe Checkout automatically.

---

## 12. File map (where to look for what)

```
src/
├── app/
│   ├── (auth)/              login, signup, forgot-password
│   ├── (marketing)/         landing, pricing, privacy, terms
│   ├── api/                 every route handler
│   │   ├── auth/            login, logout, signup, forgot, google, google/connect, google/callback
│   │   ├── campaigns/       list/create + per-campaign CRUD + activity / stats / merge-preflight / etc
│   │   ├── senders/         list/create + per-sender PATCH/DELETE
│   │   ├── replies/         list + per-reply DELETE
│   │   ├── billing/         GET — plan + subscription + today's usage + dev_mode + stripe_configured flags
│   │   ├── stripe/          checkout, portal, webhook
│   │   ├── keys/            personal access tokens for the public API
│   │   ├── v1/              public Bearer-key API
│   │   ├── tick/            cron
│   │   ├── check-replies/   cron
│   │   ├── cron/            refresh-tokens (the OAuth proactive refresh)
│   │   ├── dev/             DEV-ONLY shortcuts (set-plan, tick) — 404 in prod
│   │   ├── admin/           ops dashboard backend
│   │   ├── health/          liveness probe
│   │   ├── t/o + t/c        tracking pixels (HMAC-signed URLs)
│   │   ├── unsubscribe/     RFC 8058 one-click
│   │   ├── test-send/       campaign detail "Send test" button backend
│   │   ├── search/          /app command palette backend
│   │   └── sheets/          Google Sheet preview/sample (used by campaign create form)
│   ├── auth/callback/       Supabase OAuth + email-confirmation redirect target
│   ├── app/                 the entire signed-in product surface
│   │   ├── page.tsx         campaigns list
│   │   ├── campaigns/       new + [id] + [id]/edit
│   │   ├── senders/
│   │   ├── replies/
│   │   ├── billing/
│   │   ├── keys/
│   │   └── admin/
│   ├── u/[token]/           public unsubscribe landing
│   ├── global-error.tsx     last-resort React-render error boundary (Sentry capture)
│   ├── icon.svg
│   ├── layout.tsx           root layout
│   └── globals.css          Tailwind layer + design tokens
├── components/              CampaignForm, AppShell, ReplyDrawer, ActivityDrawer, CommandPalette, RotationPanel, etc
├── lib/                     pure(-ish) modules
│   ├── auth-server.ts       getUser() / requireUser()
│   ├── supabase.ts          supabaseAdmin() — service role
│   ├── supabase-server.ts   supabaseUser() — anon key + cookie session
│   ├── billing.ts           plan resolution, daily-cap enforcement, feature gates
│   ├── stripe.ts            Stripe client + price-id lookup
│   ├── transactional.ts     Postmark wrapper + sendSenderRevokedNotice / sendPaymentFailedNotice
│   ├── sender-revoke.ts     conditional UPDATE + at-most-once notification
│   ├── mail.ts              sendMail discriminated-union dispatcher (oauth vs app_password)
│   ├── gmail.ts             Gmail API wrapper (sendViaGmailApi, refreshAccessToken, listInboxSince, verifyGmailAccess)
│   ├── replies.ts           IMAP path (imapflow + mailparser) + auto-reply / bounce filters
│   ├── triage.ts            Haiku reply classifier with prompt caching
│   ├── template.ts          merge-tag render, toHtml, toPlain, missingMergeFields
│   ├── tokens.ts            HMAC-signed open/click/unsubscribe tokens, appUrl(), cronBearerOk()
│   ├── oauth-state.ts       HMAC-signed sender-OAuth state
│   ├── api-key.ts           generate/hash/verify eav_live_… personal access tokens
│   ├── crypto.ts            AES-GCM encrypt/decrypt for sender creds at rest
│   ├── time.ts              tz-aware day key + window-of-day check
│   ├── warmup.ts            14-day warmup ramp [10, 20, 40, 60, 100, 150, 200, 250, 300, 350, 400, 400, 400, 400]
│   ├── attachment.ts        download from Supabase storage
│   ├── email-validator.ts   MX-lookup + concurrency limiter
│   ├── errors.ts            classifyError() → 9-bucket enum
│   ├── admin.ts             ADMIN_USER_IDS gate
│   ├── sheets.ts            Google Sheets parser
│   ├── xlsx.ts              CSV/Excel parser
│   └── spam.ts              spam-trigger word checks
├── instrumentation.ts       Next.js hook — Sentry init + dev-only in-process scheduler
├── instrumentation-client.ts client Sentry init
└── middleware.ts            zone-based auth gating

supabase/
├── schema.sql               canonical first migration (single-tenant)
├── migrations/              0002 multitenant, 0003 sender_oauth, 0004 billing, 0005 observability,
│                            0006 strict_merge, 0007 inbox_rotation, 0008 reply_intent, 0009 scale_infra,
│                            0010 api_keys, 0011 prod_hardening
├── cron.sql                 Supabase pg_cron jobs (alternative to Vercel Cron)
└── _setup_all.sql           bundled paste-once-and-run version

apps-script/                 Sheets add-on starter (clasp project)

vercel.json                  cron schedules + per-route maxDuration
sentry.server.config.ts      server SDK init
sentry.edge.config.ts        edge SDK init
next.config.ts               wraps with withSentryConfig
DEPLOY.md                    production launch runbook
ABOUT.md                     this file
README.md                    quick orientation
```

---

## 12.5 v2 features (post-Phase-4 hardening, pre-public-launch)

Five orthogonal additions on top of the Phase 1-4 core, all in [migration `0012_v2_features.sql`](supabase/migrations/0012_v2_features.sql):

- **Sticky sender per recipient** — `recipients.sender_id` records which connected Gmail sent the initial. Follow-ups auto-prefer that sender so the recipient sees a coherent from-line across the thread. Falls back to the rotation pool if the sticky sender is no longer eligible.
- **A/B test variants** — `campaigns.variants jsonb` (array of `{id, weight, subject, template}`). Tick weighted-randoms a variant on first send and pins it via `recipients.variant_id`. Per-variant breakdown on the campaign detail page (`stats.variants`); auto-suggested winner once `ab_winner_threshold` sends; manual "Pin as winner" / "Resume random pick" via [`/api/campaigns/[id]/promote-winner`](src/app/api/campaigns/[id]/promote-winner/route.ts).
- **AI personalization** — `{{ai:Write a one-sentence opener referencing their role}}` syntax in any template. [`personalizeTemplate()`](src/lib/personalize.ts) scans at render time, calls `claude-haiku-4-5` per recipient (with prompt caching), caches in `ai_personalizations` so retries don't re-pay. Plan-gated to Growth/Scale; daily cap (`AI_PERSONALIZATION_DAILY_CAP`, default 1000) prevents runaway. Free / Starter campaigns silently expand AI tags to empty so they still send.
- **Conditional follow-up steps** — `follow_up_steps.condition jsonb` with four shapes: `always`, `no_reply`, `intent_in[]`, `intent_not_in[]`. Tick walks the sequence and picks the first eligible step based on the recipient's most recent reply intent. UI is a per-step dropdown in the campaign editor.
- **Outbound webhooks** — `webhooks` + `webhook_deliveries` tables. Users add URLs at [`/app/webhooks`](src/app/app/webhooks/page.tsx) and subscribe to `reply.received`, `reply.classified`, `recipient.unsubscribed`, `campaign.finished`. Every POST signs the body with HMAC-SHA256 (`EmailsVia-Signature: sha256=…`). Idempotent via `UNIQUE(webhook_id, event_id)` so retries can't double-deliver. Synchronous fire-with-one-attempt in v1.

New `plans.features` flags: `ai_personalization`, `conditional_sequences`, `webhooks`, `sticky_sender`, `a_b_testing`. Growth + Scale enabled by default.

---

## 13. Roadmap status

From the original plan ([`bro-now-we-wanna-eager-eagle.md`](https://example.com)):

- **Phase 1 — Sellable MVP**: ✅ rebrand, ✅ multi-tenant + RLS, ✅ Gmail OAuth, ✅ Stripe billing, ✅ marketing/legal pages, ✅ Sentry + admin dashboard.
- **Phase 2 — Sheets add-on**: ✅ public API + key management + Apps Script starter. Marketplace listing pending Google verification.
- **Phase 3 — Differentiators**: ✅ hard-fail merge validation, ✅ inbox rotation across N senders, ✅ AI reply triage via Haiku.
- **Phase 4 — Scale infra**: ✅ distributed tick lock (lease-based), ✅ Postmark transactional, ✅ proactive OAuth refresh, ✅ stripe webhook idempotency. ❌ pg-boss queue (deferred — sequential is fine until ~50 senders), ❌ per-sender reply-poll fan-out (same).

**Hardening pass** (post-Phase-4):
- ✅ Open-redirect, public-API plan gate, campaigns list N+1, recipients fetch caps, polling cadence split, message_id index, DOMPurify, console→Sentry, CORS, /api/health, vercel.json.

Remaining operational work:
- Run `supabase/migrations/0011_prod_hardening.sql` against the prod project.
- Stripe live-mode setup (price IDs + webhook + Stripe Tax).
- Postmark domain verification.
- Google OAuth verification submission (4-8 week wait — start now).
- Vercel deploy + env-var paste.
- Apps Script `clasp create` + Marketplace listing.

---

## 14. Things deliberately NOT done (and why)

- **No background queue (pg-boss / Inngest)**: sequential tick is fine until ~50 senders. The cron + lock pattern handles current load. Add pg-boss when you start hitting the 60s Vercel timeout.
- **No client-side `Stripe.js`**: Checkout is a full-page redirect from the server. Means you don't need `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for the existing flow (it's in `.env.local` for forward compat with Embedded Checkout if you ever add it).
- **No `gap_seconds=0`**: Even at scale, each campaign is rate-limited per-sender to look human-paced. Lower it in the campaign editor for testing.
- **No automated A/B testing**: Schema supports multiple `templates` via the follow-up steps but the picker isn't built. Roadmap item.
- **No Chrome extension**: Sheets add-on is the v1 distribution wedge. Chrome ext deferred to v2 after first $5K MRR.
- **No SMS / WhatsApp**: Email-only by design. Out of scope.
- **No per-recipient sticky sender under rotation**: a follow-up to a recipient might come from a different connected Gmail than the initial. Threading still works (Message-ID-based) but the from-line differs. Future improvement: `recipients.sender_id`.

---

## 15. How to extend this app safely

A four-step recipe for adding any new feature:

1. **Schema**: write a new `supabase/migrations/00XX_feature.sql`. Always idempotent (`if not exists` + `do $$ ... $$`). Add `user_id` if it's tenant-scoped, RLS `own_rows`, indices on lookup columns.
2. **Library code**: pure TypeScript in `src/lib/` if it touches more than one route handler; private to the route otherwise. Server-only modules (`import "server-only"`) if they pull in `next/headers` or service-role keys.
3. **API**: route handler under `src/app/api/`. Always Zod-validate the body. Always use `getUser()` + `supabaseUser()` (RLS engages) for user-facing handlers; reserve `supabaseAdmin()` for cron + webhooks + admin.
4. **UI**: component in `src/components/`, page under `src/app/app/`. Pages call the API with `fetch("/api/...")` — never import server modules into client components.

Conventions worth keeping:
- Every API response is JSON.
- Errors return `{error: "snake_case_code", message?: "user-readable"}` plus the right HTTP status (4xx for user error, 5xx for our bug).
- Every cron route is bearer-auth'd and idempotent.
- Every `await` that could fail in user-facing code is in a `try/catch` that surfaces a sensible 4xx/5xx — never let an unhandled rejection bubble.
- Every dev-only shortcut returns 404 in production. Production is not a debug surface.

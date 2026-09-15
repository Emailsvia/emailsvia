# Done

> Completed tasks, newest at top. Each entry: what + when + how verified.

---

## WORKSPACE ALIAS — A1–A3 code  ✅ (2026-09-11)
- [x] Migration `0018_sender_send_as.sql` (`senders.send_as_email`), not yet applied.
- [x] Send path: From + Reply-To = alias when set, auth unchanged (`gmail.ts`, `mail.ts`).
- [x] Loaders: via `SENDER_SERVER_COLUMNS` + `sendAs` in tick / test-send.
- [x] API: `src/lib/sender-schema.ts` shared validator; senders POST/PATCH/GET.
- [x] UI: `SendAsField` in add + edit forms, "sends as" line in the list.
- Caught before build: exporting a zod schema from a route file breaks `next build` → moved to lib.
- Verified: tsc exit 0. NOT verified: build, browser, real send.

## CUSTOM SMTP — PART 5 — DNS recon  ✅ (2026-09-11), user actions pending
- [x] whois: registrar Spaceship, NS = Cloudflare (lars/zelda), created 2026-07-11.
- [x] Authoritative (lars.ns.cloudflare.com): MX = Cloudflare Email Routing, SPF = Cloudflare
  include only, no DKIM, no DMARC.
- [x] Spacemail preset confirmed: `mail.spacemail.com` resolves (198.177.121.32); 465/587/993 open.
- [x] Required records identified from Spaceship's Cloudflare guide → toBeDone 5.0–5.9.
- NOT done: records not added (user's Cloudflare/Spaceship accounts). DNS verification must
  happen from an external checker — local resolver flaky.

## CUSTOM SMTP — PART 4 — API + UI  ✅ DONE (2026-09-11)
- [x] `src/app/api/senders/route.ts`: Gmail vs SMTP schemas, host/port validation,
  SMTP + IMAP verify before save, provider + host columns stored, returned in GET/POST.
- [x] `src/app/app/senders/page.tsx`: "Custom domain" entry points, provider presets
  (Spaceship default, Zoho, Outlook/M365, Other), `ServerFields` for SMTP/IMAP, masked
  password, `smtp · host` badge. Gmail app-password form unchanged.
- [x] Fixed Part 3 bug: whitespace stripped only from Gmail app passwords now.
- Verified: `npx tsc --noEmit` exit 0. NOT verified: build, lint, or the form in a browser
  (dev server live on :3000; runtime test is Part 6).

## CUSTOM SMTP — PART 3 — Backend  ✅ DONE (2026-09-11)
- [x] `src/lib/mail.ts`: `HostConfig`, `GMAIL_SMTP`/`GMAIL_IMAP`, `SENDER_SERVER_COLUMNS`,
  `serversFromRow()`; transporter uses per-sender host, `requireTLS` on non-TLS ports,
  cache keyed `host:port:email`; `verifyCredentials` checks SMTP + IMAP for custom senders.
- [x] `src/lib/replies.ts`: `makeImapClient` + `verifyImap`; `fetchIncomingMessages` takes optional `imap`.
- [x] Routes pass the new columns: `api/tick` (rotation + single selects, `toSenderCreds`),
  `api/check-replies`, `api/test-send`.
- [x] Gmail senders unchanged: no `smtp`/`imap` on the creds → same Gmail hosts as before.
- Verified: `npx tsc --noEmit` exit 0. NOT verified: `next build` (dev server live on :3000),
  lint (no ESLint config — see error.md). No runtime test yet (Part 6).

## CUSTOM SMTP — PART 2 — DB migration  ✅ DONE (2026-09-11)
- [x] `supabase/migrations/0017_custom_smtp.sql`: `provider` ('gmail'|'smtp', default gmail)
  + smtp/imap host/port/secure columns + `senders_smtp_config_chk` constraint.
- [x] Idempotent (`add column if not exists`, drop-then-add constraint). Existing rows →
  provider='gmail', constraint passes trivially. RLS `own_rows for all` covers new cols.
- [x] Applied to Supabase by the user.

## CUSTOM SMTP — PART 1 — Plan  ✅ (2026-09-11)
- [x] Recon: Gmail hosts hard-coded in `mail.ts:34` + `replies.ts:113`. Backlog Parts 1–7 written.

---

## PART 3 — Testing & verification  ✅ DONE, automated (2026-07-17)
- [x] 3.1 `npm run lint` exit 0 · `npm run build` exit 0 (full route table generated).
- [x] 3.2 GA present in served HTML: `<link rel=preload href=…gtag/js?id=G-9W1JYN6VV7 as=script>`
  on `/`, `/login`, `/pricing`. (Actual gtag.js `<script>` + dataLayer init are injected
  client-side by next/script `afterInteractive` — expected for @next/third-parties.)
- [x] 3.3 Smoke: `/`, `/login`, `/pricing` → HTTP 200 on a clean dev server (:3001).
- [x] 3.4 No regressions — `data-theme="dark"` intact; the single "hydration" grep hit was
  the benign `suppressHydrationWarning` attr in the RSC payload, not an error; no CSP.
- [x] 3.5 Negative test — dev server with `NEXT_PUBLIC_GA_ID=""` (:3002) → `/` = 200 with
  ZERO GA markers. Env-gating confirmed: no GA loads when the var is unset/empty.
- [x] Cleanup: killed throwaway dev servers :3001/:3002; left user's :3000 intact.
- Hit + resolved a stale-`.next` homepage-500 (error.md) rooted in a bad `rm -rf .next` (bad.md).
- 🔵 LEFT FOR USER (needs a real browser): confirm the pageview in GA Realtime and that a
  route change fires a 2nd `page_view`. Also set `NEXT_PUBLIC_GA_ID` in Vercel prod env.

---

## PART 2 — Google Analytics integration  ✅ DONE & BUILD-VERIFIED (2026-07-17)
- [x] Final verification: clean `rm -rf .next && npm run build` → `REAL_BUILD_EXIT=0`,
  full route table generated, GA-wired layout compiles, no missing-module/hydration errors.
  (First build had a stale-cache failure — logged + resolved in error.md.)
- [x] 2.1 Chose `@next/third-parties/google` — official, auto-fires `page_view` on App Router route changes.
- [x] 2.2 Env var `NEXT_PUBLIC_GA_ID`:
  - `.env.local` → `G-9W1JYN6VV7` (real).
  - `.env.example` → blank + explanatory comment (new "Google Analytics (GA4)" section).
- [x] 2.3 Installed `@next/third-parties@15.5.15` (version-matched to Next 15.5.15). `npm i` exit 0.
- [x] 2.4 Wired into `src/app/layout.tsx`: imported `GoogleAnalytics`, render `{gaId ? <GoogleAnalytics gaId={gaId}/> : null}`
  as a sibling after `<body>`. Env-gated → no gtag.js loads when unset (privacy-safe).
- [x] 2.5 Verified no CSP headers exist anywhere (grep clean) so nothing blocks gtag.js. `npm run lint` exit 0.
- [x] 2.6 SPA route-change pageviews handled by the component (no manual wiring needed).
- [x] 2.8 Added "Google Analytics" line to the Sub-processors list in the /privacy page.
- Deferred: 2.7 custom funnel events (optional); 2.2 Vercel prod env var (deploy-time action).

---

## PART 1 — Status tracking scaffold  ✅ (2026-07-17)
- [x] 1.1 Created `status/` folder with all 5 tracking files
  - toBeDone.md, done.md, progress.md, bad.md, error.md — verified present on disk.
- [x] 1.2 Populated toBeDone.md with the full initiative breakdown (Parts 1–3 + subtasks).
- [x] 1.3 Established the update ritual (progress.md reflects current work; this file logs completions).
- Recon captured for Part 2: Next 15.4 App Router, React 19; root layout has a `<head>`;
  no GA code/env exists yet; `@next/third-parties` not installed. Measurement ID `G-9W1JYN6VV7`.

# In Progress

> What we are actively working on RIGHT NOW. Should usually hold 1–3 items.
> When an item finishes, move it to done.md and pull the next from toBeDone.md.

---

## ▶ ACTIVE initiative: Deploy EmailsVia on Railway (2026-09-14)
Custom domain dropped for now. Sender = `tasklyanything.ai@gmail.com` (connect in UI, no code).
Goal: same Railway account as Taskly, zero resource sharing.
- [x] Separate Railway project `emailsvia` (own container; Taskly = keen-growth / worthy-recreation)
- [x] `output: "standalone"` + Dockerfile (node:22-slim, heap 384MB) + `.dockerignore`
- [x] `.railway/railway.ts` (IaC; railway.json was ignored + deprecated): 1 vCPU / 512MB cap,
      sleepApplication, healthcheck `/api/health`, all vars `preserve()`d (a var missing from
      VARS is DELETED on `railway config apply`). Region via `railway scale southeast-asia=1`
      (IaC doesn't diff region). Supabase = AWS ap-northeast-1 → health DB latency 904→145ms.
- [x] Docker type-check OOMs → `SKIP_TYPECHECK=1` in image; `npx tsc --noEmit` exit 0 locally
- [x] Local image test under 512MB: health/`/`/login/pricing 200, tick 401 w/o bearer, idle 266MB
- [x] `supabase/cron.sql`: each job gated with `where exists` → no requests when idle (lets it sleep)
- [x] Env vars copied from .env.prod (+ GA id). ⚠️ .env.prod has blank Stripe/Postmark/AI keys
- [x] Live: https://emailsvia-production.up.railway.app — /api/health, /, /login, /pricing 200
- [x] Google login bug: /auth/callback redirected to https://0.0.0.0:8080/app (req.nextUrl = container
      bind addr behind Railway proxy). Callback + unsubscribe now use requestOrigin(). Verified live.
      Middleware redirects were already fine. Sender-Gmail OAuth uses APP_URL → unaffected.
- [x] Middleware: apex emailsvia.com → www for pages (not /api — old unsubscribe/tracking links)
- [x] Railway vars: APP_URL=https://emailsvia.com, live Stripe keys + prices (from .env.local).
      Postmark/AI keys are not set anywhere locally → alerts/triage off until added.
- [x] Custom domains added on Railway (emailsvia.com, www). DNS is at NAMECHEAP (not Vercel).
- [x] Namecheap DNS switched (2026-09-14): emailsvia.com + www serve from Railway (server: railway-hikari), HTTPS ok, apex pages 308 → www
- [x] Supabase redirect URLs cover apex + www (railway.app entry optional)
- [x] Gated cron jobs rescheduled, app_url=https://emailsvia.com, pg_net responses 200
      ⚠️ Some ticks returned no_running_campaign while campaign ee93326b is running — likely
      Vercel answering during DNS propagation; recheck. ⚠️ Supabase shows "Grace period is over" (free quota)
- [ ] USER: after DNS moves, remove emailsvia.com from the Vercel project + disconnect its Git
      (emailsvia.com's Vercel project isn't on the nishantrajiitkgp Vercel account)

### Full check 2026-09-14 ✅
- DNS/HTTPS apex+www → Railway sin1; http→https, apex→www; pages 200; health db ok 100ms
- Google login: redirect_to=www…/auth/callback, client …f5t7, lands on Google sign-in (no mismatch)
- Gmail connect URL (emailsvia.com/api/auth/google/callback + gmail scopes) → Google sign-in, no mismatch
- Cron reaches Railway: tick lock acquired 21:26:02 UTC; tick w/o bearer 401; Stripe webhook 400 w/o sig
- Open: campaign "Batch 1" (ee93326b) running with NO sender (sender_id null, no rotation) → from
  08:00 IST will return no_sender_configured every minute + keeps Railway awake. Owner decision.
- Open: emailsvia.vercel.app still serves (old Vercel project not deleted); Postmark + AI keys unset;
  sender emailsvia.com@gmail.com revoked; tasklyanything.ai@gmail.com not connected yet

## ⏸ Workspace send-as alias (care@taskly.ca → alias addresses)
**Status:** Code A1–A3 ✅ done (tsc exit 0). Migrations 0017 + 0018 confirmed applied on prod
(columns readable via REST, 2026-09-14). Waiting on user:
2. Google Workspace alias setup (A4), then A5 testing.
Plan in toBeDone.md → "WORKSPACE ALIAS" section. Spacemail initiative below is PAUSED
(kept open per user), blocked on mailbox + Cloudflare DNS.

---

## ⏸ PAUSED initiative: Custom-domain sending (`@tasklyanything.net` via Spaceship)

**Status:** PART 5 (DNS) 🔵 recon done — waiting on user actions in Spaceship + Cloudflare
(steps 5.0–5.9 in toBeDone.md). User decision: all open problems get fixed at the end.

Key finding: DNS is on **Cloudflare**, MX is Cloudflare Email Routing (forward-only) →
no Spacemail mailbox exists yet. Need mailbox first, then swap MX/SPF, add DKIM/DMARC.

Update 2026-09-13: user picked the Spacemail route. Asked the authoritative NS and the
Cloudflare Email Routing MX + SPF are gone. MX/TXT are empty now (no mail DNS at all).
Still need 5.0 (mailbox) and 5.2–5.5 (records).

## Next up
- PART 6 — Testing. Blocked until the Spacemail mailbox exists + DNS records are in.

## Open problems (fix at the end, per user)
- 6.6 `auth_failed` not handled → bad password doesn't flag the sender.
- Lint can't run (no ESLint config).
- Plan gating for custom SMTP — currently all plans; confirm.
- Custom hosts resolving to private IPs aren't blocked.
- Spacemail host/ports in the preset are unconfirmed.

## Verification gaps (carry to Part 6)
- `next build` NOT run: user's dev server is live on :3000 (see bad.md, don't clobber `.next`).
- `npm run lint` can't run: no ESLint config/dep in repo → `next lint` opens an interactive
  setup prompt. Pre-existing. Decide: set up ESLint, or drop lint from the checklist.

## Needed from user (anytime before Part 6)
- A Spacemail mailbox on `tasklyanything.net` + its password
- Confirm SMTP/IMAP host + ports from the Spaceship panel
- Access to Spaceship DNS for SPF / DKIM / DMARC (Part 5)

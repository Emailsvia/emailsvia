# To Be Done

> Master backlog for the "Google Analytics + full app testing" initiative.
> Tasks move: **toBeDone → progress → done**. Update on every step.
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done (also mirrored to done.md)

Measurement ID: `G-9W1JYN6VV7`
Stack: Next.js 15.4 (App Router) · React 19 · Vercel · Supabase · dark-only UI.

---

## PART 1 — Status tracking scaffold  ✅ DONE
- [x] 1.1 Create `status/` folder with 5 tracking files
  - [x] toBeDone.md (this file)
  - [x] done.md
  - [x] progress.md
  - [x] bad.md
  - [x] error.md
- [x] 1.2 Populate toBeDone.md with the full breakdown of the initiative
- [x] 1.3 Establish the update ritual (keep these files current every step)

## PART 2 — Google Analytics integration  ✅ DONE (build verified, clean exit 0)
- [x] 2.1 Approach chosen → `@next/third-parties/google` (official, auto SPA pageviews)
- [x] 2.2 Add env var `NEXT_PUBLIC_GA_ID=G-9W1JYN6VV7`
  - [x] `.env.local` (dev) — real value set
  - [x] `.env.example` (documented, blank value + comment)
  - [ ] Vercel project env (production) — STILL TODO (user/deploy action) → note in DEPLOY.md
- [x] 2.3 Install dependency (`@next/third-parties@15.5.15`, matches Next 15.5.15)
- [x] 2.4 Wire `<GoogleAnalytics gaId={...}/>` into `src/app/layout.tsx`
  - [x] Gated on env var presence (`gaId ? <…/> : null`) — no-op when unset
  - [x] In root layout → loads on ALL zones (marketing, /app, /admin, /pricing, /u/[token])
- [x] 2.5 Verified: no CSP anywhere (nothing blocks gtag.js); lint clean; build check running
- [x] 2.6 SPA route-change pageviews — handled automatically by `<GoogleAnalytics>` component
- [ ] 2.7 (Optional, deferred) Custom events for key funnels (signup, campaign start, checkout)
- [x] 2.8 Privacy: added Google Analytics to sub-processors list in `/privacy`

## PART 3 — Testing & verification  ✅ DONE (automated), 🔵 2 live checks left for user
- [x] 3.1 Static checks: `npm run lint` (exit 0) + `npm run build` (exit 0, full route table)
- [x] 3.2 Verify GA in served HTML
  - [x] `gtag/js?id=G-9W1JYN6VV7` preload present on `/`, `/login`, `/pricing`
  - [x] Correct measurement ID rendered by `<GoogleAnalytics>`
  - [🔵] GA Realtime dashboard shows the pageview — NEEDS A REAL BROWSER (user action)
  - [🔵] Route change fires a second `page_view` — NEEDS A REAL BROWSER (user action)
- [x] 3.3 App smoke test: `/`, `/login`, `/pricing` → HTTP 200 on a clean dev server
- [x] 3.4 No regressions: `data-theme="dark"` intact; no real hydration errors
      (only benign `suppressHydrationWarning` in RSC payload); no CSP anywhere
- [x] 3.5 GA does NOT load when `NEXT_PUBLIC_GA_ID` is empty (negative test on :3002 → 0 markers)

Notes:
- No headless browser in this env, so the two live GA-Realtime checks are handed to the user.
- Hit + resolved a homepage 500 caused by an earlier `rm -rf .next` under a live dev server
  (see error.md + bad.md). Fix = user restarts their :3000 dev server.

---

## Open questions / decisions pending
- Which GA approach? (`@next/third-parties` vs manual `next/script`) — see bad.md if reversed.
- Do we need cookie consent before GA fires? (jurisdiction-dependent)
- Track `/admin` operator traffic, or exclude it from analytics?

## Out of scope (for now)
- Server-side / Measurement Protocol events
- GA4 → BigQuery export
- Consent Mode v2 banner UI

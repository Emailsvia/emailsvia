# Done

> Completed tasks, newest at top. Each entry: what + when + how verified.

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

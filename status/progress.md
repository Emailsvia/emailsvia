# In Progress

> What we are actively working on RIGHT NOW. Should usually hold 1–3 items.
> When an item finishes, move it to done.md and pull the next from toBeDone.md.

---

## Current part: PART 3 — Testing & verification  ✅ COMPLETE (automated portion)

- [x] 3.1 lint exit 0 + build exit 0
- [x] 3.2 gtag preload w/ correct ID on /, /login, /pricing (client-side firing needs browser)
- [x] 3.3 smoke: /, /login, /pricing → 200 on clean server
- [x] 3.4 dark theme intact, no real hydration errors, no CSP
- [x] 3.5 negative test — GA absent when var empty (0 markers)

**Status: All 3 parts done. Idle.**

## ⚠️ ACTION ITEMS FOR USER
1. **Restart the :3000 dev server** (Ctrl-C → `npm run dev`) — it's serving stale 500s on `/`
   because I ran `rm -rf .next` under it during Part 2 (logged in bad.md/error.md). The code
   is fine; a fresh server (:3001) served everything 200.
2. **Live GA check** (needs a browser, can't do headless here): open the site, then watch
   GA-4 → Reports → Realtime for the pageview, and click between pages to see a 2nd page_view.
3. **Vercel prod:** set `NEXT_PUBLIC_GA_ID=G-9W1JYN6VV7` in project env (code no-ops without it).

## Deferred / optional
- 2.7 custom funnel events (signup / campaign start / checkout).
- Add the Vercel-env step to DEPLOY.md.

## Reminders for later (carry into deploy)
- Set `NEXT_PUBLIC_GA_ID=G-9W1JYN6VV7` in Vercel prod env (deploy action; should add to DEPLOY.md).
- Deferred: 2.7 custom funnel events (signup / campaign start / checkout) — optional.

## Next up
- On "next" → PART 3 (testing): run dev server, confirm gtag.js + dataLayer load,
  GA Realtime pageview, route-change fires a 2nd page_view, no hydration/CSP regressions,
  and confirm GA does NOT load when the env var is absent.

## Notes
- Overall goal: wire GA `G-9W1JYN6VV7` into the app + full testing pass.
- Recommended GA approach pending confirmation: `@next/third-parties/google`.

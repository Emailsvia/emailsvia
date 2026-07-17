# Errors

> Every error we hit — build errors, runtime errors, lint failures, CSP blocks,
> GA not firing, hydration warnings, etc. Each entry: symptom → cause → fix → status.

---

## 2026-07-17 — `next build` fails: Cannot find module './6141.js'
- **Symptom:** `unhandledRejection [Error: Cannot find module './6141.js']` during
  `Collecting page data ...`, require stack rooted at `.next/server/webpack-runtime.js`
  → `.next/server/pages/_document.js`. Build halted before the route table / static generation.
- **Where:** `npm run build`, right after installing `@next/third-parties@15.5.15`.
- **Note:** The background task reported "exit code 0" — that was `tail`'s exit (the
  command was `npm run build 2>&1 | tail -40`), NOT next build's. The pipe masked the
  real failure. Lesson: capture `${PIPESTATUS[0]}` or avoid piping build through tail.
- **Cause (suspected):** stale `.next` webpack chunks referencing an old runtime chunk id
  after the dependency change. Classic transient Next.js cache artifact, not a GA problem.
- **Fix:** `rm -rf .next && npm run build` (clean rebuild).
- **Status:** ✅ RESOLVED. Clean rebuild returned `REAL_BUILD_EXIT=0`, full route table
  generated, GA-wired layout compiled with no missing-module error. Was purely a stale
  `.next` cache artifact from the dependency install — not a code/GA issue.

## 2026-07-17 — Homepage `/` returns HTTP 500 on the running dev server
- **Symptom:** `curl http://localhost:3000/` → `500 Internal Server Error` (bare 21-byte body).
  BUT `/login` on the same server → `200` and correctly includes GA (`gtag/js?id=G-9W1JYN6VV7`).
- **Where:** user's long-running dev server (pid 11368, next-server v15.5.15) on port 3000.
- **Not caused by GA:** `/login` shares the same root layout + GA and works. Also the
  production build (Part 2) succeeded exit 0, and `/` is a static (○) marketing page —
  if its code threw at render, the build's static generation would have failed. It didn't.
- **Cause:** stale dev-server runtime. In Part 2 I ran `rm -rf .next` while THIS dev server
  was live (see bad.md). Deleting compiled chunks under a running `next dev` corrupts its
  in-memory manifest; some routes recompile cleanly on request (/login did), others hit a
  dangling chunk ref and 500 (/ did). Confirmed by booting a fresh dev server on :3001.
- **Fix:** restart the dev server (the user's :3000 process).
- **Status:** ✅ RESOLVED (root cause confirmed). Fresh dev server on :3001 served
  `/`, `/login`, `/pricing` all = HTTP 200 with GA present. Proves the code is fine and
  the :3000 500 is purely stale runtime state. ACTION FOR USER: restart the :3000 dev
  server (Ctrl-C then `npm run dev`) to clear it.

<!-- earlier errors below (none) -->
_No other errors logged._

<!--
Template:
## <date> — <short symptom>
- **Symptom:** exact error message / observed behavior
- **Where:** file / command / browser
- **Cause:** root cause once known
- **Fix:** what resolved it
- **Status:** open | resolved
-->

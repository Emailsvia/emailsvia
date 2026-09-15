# Errors

> Every error we hit — build errors, runtime errors, lint failures, CSP blocks,
> GA not firing, hydration warnings, etc. Each entry: symptom → cause → fix → status.

---

## 2026-09-14 — Railway logs: "Failed to find Server Action" + ECONNRESET
- **Symptom:** bursts of `Failed to find Server Action "y"` / `"67de7412"` right after the container
  woke, plus one `[Error: aborted] { code: 'ECONNRESET' }`.
- **Cause:** the app has NO server actions. Requests with a `Next-Action` header are scanner probes
  ("y") or a browser tab from an older build. Next logs an error for each. ECONNRESET = client hung
  up mid-request (came with the probe burst) — not a server bug.
- **Fix:** middleware returns 404 for any request with `next-action` header before Next handles it.
  Verified live: both probe ids → 404, no log lines. Also added `src/app/robots.ts` (was 404).
- **Status:** ✅ resolved

## 2026-09-11 — Local DNS lookups return inconsistent results
- **Symptom:** same query flips between runs: `mx1.spacemail.com` → 162.255.118.30, later
  NXDOMAIN via 1.1.1.1; 8.8.8.8 returns no response at all; `+short` queries sometimes empty
  for names that exist (incl. tasklyanything.net NS, which the authoritative server answers).
- **Where:** `dig` from this machine, Part 5 recon.
- **Cause:** unknown — local network/resolver interference. Authoritative queries
  (`@lars.ns.cloudflare.com`) and TCP port probes were consistent.
- **Fix:** trust only authoritative answers + positive results; verify the final records from
  an external checker (MXToolbox / mail-tester.com).
- **Status:** open (workaround in place)

## 2026-09-11 — Port probe reported every port "closed"
- **Symptom:** `nc -z` loop printed `closed smtp.spacemail.com 465:` for all hosts.
- **Cause:** `set -- $hp` doesn't word-split in zsh, so `$1` held "host port" and `$2` was
  empty. Same root as the PIPESTATUS issue: bash idioms in a zsh shell.
- **Fix:** shell function with explicit args → 465/587/993 on mail.spacemail.com OPEN.
- **Status:** ✅ resolved

## 2026-09-11 — `npm run lint` opens an interactive ESLint setup prompt
- **Symptom:** `next lint` prints "How would you like to configure ESLint? ❯ Strict / Base / Cancel"
  and waits for input instead of linting.
- **Where:** `npm run lint`, during custom-SMTP Part 3 verification.
- **Cause:** repo has no ESLint config file and no `eslint` dependency in package.json.
  Pre-existing, not caused by Part 3. (`next lint` is also deprecated in Next 16.)
- **Fix:** none yet — needs a decision: add ESLint (`eslint` + `eslint-config-next` + config)
  or drop lint from the verification checklist.
- **Status:** open

## 2026-09-11 — Exit codes read as blank in the shell
- **Symptom:** `cmd | head; echo ${PIPESTATUS[0]}` printed an empty exit code.
- **Cause:** the shell is zsh; `PIPESTATUS` is bash-only (zsh uses `$pipestatus`).
  An empty exit code is NOT a pass.
- **Fix:** redirect output to a file and read `$?` directly — `tsc` then reported exit 0.
- **Status:** ✅ resolved (lesson: don't pipe verification commands in zsh)

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

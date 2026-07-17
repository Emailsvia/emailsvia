# Bad Decisions / Missteps

> Honest log of wrong turns, reversals, and things we'd do differently.
> Each entry: what we did → why it was bad → what we did instead.
> Keeping this honest prevents repeating mistakes.

---

## 2026-07-17 — Ran `rm -rf .next` while the user's dev server was live
- **Did:** During Part 2's clean rebuild I ran `rm -rf .next && npm run build` without
  checking that the user already had a `next dev` server running (pid 11368) against the
  same `.next` directory.
- **Why bad:** Deleting `.next` out from under a running dev server corrupts its in-memory
  webpack manifest → stale chunk references → intermittent HTTP 500s on routes it tries to
  recompile (the homepage `/` 500'd because of this, see error.md). Destabilized a process
  the user was actively using.
- **Corrected to:** Diagnosed via a fresh dev server on :3001. Going forward: before
  `rm -rf .next` / heavy builds, check for a running dev server (`lsof -ti tcp:3000`) and
  either use a separate build dir/port or warn first. The user just needs to restart :3000.

<!--
Template:
## <date> — <short title>
- **Did:** ...
- **Why bad:** ...
- **Corrected to:** ...
-->
_No other bad decisions logged._

<!--
Template:
## <date> — <short title>
- **Did:** ...
- **Why bad:** ...
- **Corrected to:** ...
-->

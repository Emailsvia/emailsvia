# To Be Done

---

# ▶ ACTIVE — WORKSPACE ALIAS initiative (started 2026-09-11)

Goal: keep authenticating as the Google Workspace mailbox **care@taskly.ca**, but send
campaigns *as* alias addresses (e.g. `hello@taskly.ca`, or `hello@tasklyanything.net` once
that domain is added to Workspace). Reputation of the alias domain builds on Google's infra.

Recon:
- Not built: From + Reply-To always = the authenticated mailbox (`gmail.ts:101-110`,
  `mail.ts` SMTP path). No `send_as` concept anywhere.
- OAuth scopes = gmail.send + gmail.readonly only → can't list the Gmail "Send mail as"
  aliases. Adding `gmail.settings.basic` would re-trigger Google OAuth verification →
  NOT doing it; user sets alias in Gmail, app trusts the configured value.
- If the alias isn't set up in Gmail, Gmail rewrites From back to care@ (safe failure).
- Replies to an alias land in care@'s inbox → reply polling needs no change.

## A1 — DB  (code)  ✅ written
- [x] `supabase/migrations/0018_sender_send_as.sql`: `senders.send_as_email` (nullable, format check)
- [ ] **Apply to Supabase (user)** — code selects this column; tick/test-send/senders will
      error until it exists

## A2 — Send path  (code)  ✅
- [x] `gmail.ts` (OAuth) + `mail.ts` (SMTP): From/Reply-To use `sendAs || email`; login still `email`
- [x] `send_as_email` added to `SENDER_SERVER_COLUMNS` → picked up by tick, test-send,
      check-replies selects; passed as `sendAs` in tick + test-send (both OAuth + app-pw)

## A3 — API + UI  (code)  ✅
- [x] `src/lib/sender-schema.ts` `SendAsEmail` (blank → null, lowercase, email format),
      used by senders POST + PATCH; GET/POST/PATCH return `send_as_email`
- [x] Senders page: "Send as (alias) · optional" field in add form + edit form (edit shows
      save errors); list shows "sends as <alias>"
- Existing OAuth-connected senders: set the alias via **Edit** (connect flow unchanged)
- Verified: `tsc --noEmit` exit 0; route files export only handlers/config. No build/browser test.

## A4 — Google Workspace setup  (user, admin.google.com + Gmail)
- [ ] User alias on the SAME domain (fastest): Admin console → Directory → Users → care@ →
      User information → **Alternate email addresses** → add e.g. `hello@taskly.ca`
- [ ] Alias on ANOTHER domain (tasklyanything.net): Admin → Account → Domains →
      Manage domains → **Add a domain** → "User alias domain" → verify with the TXT record
      Google gives (add it in **Cloudflare** DNS) → then MX → Google (`smtp.google.com`, prio 1)
      ⚠️ Conflicts with the paused Spacemail plan — the domain can't have MX for both.
- [ ] Gmail (care@) → Settings → Accounts → **Send mail as** → Add another address →
      the alias, tick "Treat as an alias"
- [ ] DNS for the alias domain: SPF `include:_spf.google.com`, DKIM from Admin → Apps →
      Gmail → Authenticate email, DMARC `p=none`
- [ ] Connect care@taskly.ca in the app (Connect Gmail / OAuth) → set Send as = alias

## A5 — Test
- [ ] tsc exit 0 · test-send from the alias → headers show From alias, SPF/DKIM pass
- [ ] Reply to alias → arrives via check-replies and correlates to the recipient
- [ ] Sender without alias → unchanged behaviour

---

# ⏸ PAUSED — Custom-domain sending via Spacemail (kept open per user)

> Master backlog for the **"Custom-domain sending (non-Gmail SMTP/IMAP)"** initiative.
> Tasks move: **toBeDone → progress → done**. Update on every step.
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done (also mirrored to done.md)

Goal: send campaigns from `@tasklyanything.net` (hosted on **Spaceship / Spacemail**,
no Google Workspace) alongside existing Gmail senders.

Why code changes are needed: SMTP host is hard-coded to `smtp.gmail.com`
(`src/lib/mail.ts:34`) and IMAP to `imap.gmail.com` (`src/lib/replies.ts:113`).

Spacemail defaults (⚠️ confirm in Spaceship panel → Email → mailbox → "Mail client setup"):
- SMTP `mail.spacemail.com` · 465 SSL (or 587 STARTTLS)
- IMAP `mail.spacemail.com` · 993 SSL
- Username = full email address, password = mailbox password

---

## PART 1 — Plan + status scaffold  ✅ DONE
- [x] 1.1 Recon: confirmed Gmail hosts hard-coded in mail.ts + replies.ts
- [x] 1.2 Write this backlog (Parts 1–7)

## PART 2 — Database migration  ✅ WRITTEN (apply pending user OK)
- [x] 2.1 `supabase/migrations/0017_custom_smtp.sql` adds to `senders`:
  - `provider text not null default 'gmail'` (check: `gmail` | `smtp`)
  - `smtp_host`, `smtp_port`, `smtp_secure`, `imap_host`, `imap_port`, `imap_secure`
  - Check constraint `senders_smtp_config_chk`: smtp senders need all 6 + app_password
- [x] 2.2 schema.sql NOT edited — repo convention: schema.sql is the base, later columns
      live only in migrations (0003 oauth cols aren't in schema.sql either)
- [x] 2.3 RLS: `own_rows` on senders is `for all` → covers new columns, no change needed
- [ ] 2.4 Apply to Supabase (ask user before running on prod)

## PART 3 — Backend: send + receive via custom hosts  ✅ DONE (tsc exit 0)
- [x] 3.1 `mail.ts`: `AppPasswordSender` gets optional `smtp`/`imap: HostConfig`; absent → Gmail.
      Added `GMAIL_SMTP`/`GMAIL_IMAP`, `SENDER_SERVER_COLUMNS`, `serversFromRow()`.
      STARTTLS ports (587) get `requireTLS` so the password never goes out in clear.
- [x] 3.2 Transporter cache keyed by `host:port:email`
- [x] 3.3 `replies.ts`: shared `makeImapClient`, `fetchIncomingMessages` takes optional `imap`;
      new `verifyImap()`
- [x] 3.4 Sender loaders pass the new fields: `/api/tick` (both selects), `/api/check-replies`,
      and also `/api/test-send` (found during recon, not in original plan)
- [x] 3.5 `verifyCredentials` checks SMTP, then IMAP when `imap` is set; errors prefixed `SMTP:`/`IMAP:`
- [x] 3.6 `errors.ts` already maps 535 / "invalid login" → `auth_failed` (not `auth_revoked` —
      that's OAuth-only). No change needed. ⚠️ Follow-up: `auth_failed` isn't handled anywhere
      outside errors.ts, so a bad password doesn't flag the sender (pre-existing, Gmail app
      passwords behave the same). Tracked as 6.6.
- [x] 3.7 No other Gmail assumptions: no Sent-folder append, no other hard-coded hosts.
      Senders POST `verifyCredentials({ email, appPassword })` still type-checks (Part 4 extends it).

## PART 4 — API + UI: connect a custom-domain inbox  ✅ DONE (tsc exit 0)
- [x] 4.1 `api/senders` POST: separate `GmailSchema` / `SmtpSchema` picked by `provider`.
      SMTP: hostname validation (no IP literals / localhost / internal names), ports limited to
      465/587/2525 (SMTP) and 993/143 (IMAP), password kept verbatim. Verifies SMTP + IMAP
      before insert; saves provider + host columns. GET returns `provider`, `smtp_host`.
- [x] 4.2 Senders page: "Custom domain" button (header + empty state) → form with provider
      presets **Spaceship (default)**, Zoho, Outlook/M365, Other; editable SMTP/IMAP host +
      port (SSL/TLS vs STARTTLS derived from port); password field masked.
- [x] 4.3 Badge `smtp · <host>` for custom senders in the list.
- [x] 4.4 Plan gating: none added — custom SMTP available on every plan, same as app-password
      Gmail senders. ⚠️ Confirm with user.
- [x] Bug fix to Part 3: passwords had ALL whitespace stripped (Gmail app-pw habit) — now only
      for Gmail; custom mailbox passwords used verbatim (`mail.ts`, `replies.ts`).
- ⚠️ Known limit: a hostname that resolves to a private IP isn't blocked (DNS not checked).
      Ports are restricted to mail ports, so exposure is small. Revisit at the end.

## PART 5 — DNS / deliverability for tasklyanything.net  🔵 RECON DONE — user actions pending
Findings (2026-09-11):
- Registrar = Spaceship, but **DNS is on Cloudflare** (NS lars/zelda.ns.cloudflare.com)
  → every record below goes in the **Cloudflare dashboard**, not Spaceship.
- Current MX = **Cloudflare Email Routing** (route1/2/3.mx.cloudflare.net) — forward-only,
  no mailbox, can't send, no IMAP. So there is NO Spacemail mailbox on this domain yet.
- Current SPF = `v=spf1 include:_spf.mx.cloudflare.net ~all`. No DKIM. No DMARC.
- Domain created 2026-07-11 (~2 months old), never sent mail → cold domain.
- Spacemail hosts confirmed: `mail.spacemail.com` 465 SSL (SMTP) / 993 SSL (IMAP) — matches
  the Part 4 preset. Ports 465/587/993 reachable.
- Records source: Spaceship KB "Set Up Spacemail DNS Records on Cloudflare" (via search;
  the KB pages 403 on direct fetch, so values are from the search summary).

User steps:
- [ ] 5.0 Buy/create a Spacemail mailbox for `tasklyanything.net` in Spaceship (e.g. `hello@`).
      Copy its DKIM TXT value from the Spaceship panel.
- [ ] 5.1 Cloudflare → Email → Email Routing → **disable** (it owns the MX records).
      ⚠️ Any forwarding rules it has stop working.
- [ ] 5.2 MX: delete the 3 `route*.mx.cloudflare.net` records; add
      `MX @ mx1.spacemail.com prio 0` and `MX @ mx2.spacemail.com prio 0`
- [ ] 5.3 SPF: edit the existing root TXT (keep only ONE SPF record) →
      `v=spf1 include:spf.spacemail.com ~all`
- [ ] 5.4 DKIM: `TXT spacemail._domainkey` = value from the Spaceship panel (`v=DKIM1; k=rsa; …`)
- [ ] 5.5 DMARC: `TXT _dmarc` = `v=DMARC1; p=none; rua=mailto:<mailbox>@tasklyanything.net`
      (start at p=none; tighten to quarantine after a few clean weeks)
- [ ] 5.6 Optional: `SRV _autodiscover._tcp` 0 0 443 `autoconfig.spacemail.com`
- [ ] 5.7 Verify from outside (this machine's DNS is unreliable — see error.md):
      MXToolbox SPF/DKIM/DMARC lookups, then mail-tester.com score 9+/10
- [ ] 5.8 Find Spacemail's daily sending limit (ask Spaceship support) → campaign `daily_cap` below it
- [ ] 5.9 Enable the 14-day warmup on the sender — cold domain

## PART 6 — Testing
- [ ] 6.1 `npm run lint` + `npm run build` exit 0
- [ ] 6.2 Connect `you@tasklyanything.net` → verify SMTP + IMAP green
- [ ] 6.3 Test campaign to 2–3 own addresses (Gmail, Outlook) → check inbox vs spam + headers (SPF/DKIM pass)
- [ ] 6.4 Reply from a test address → shows up via `/api/check-replies`, correlated to recipient
- [ ] 6.5 Regression: existing Gmail OAuth + app-password senders still send + receive
- [ ] 6.6 Bad password → clear error, sender flagged

## PART 7 — Docs + ship
- [ ] 7.1 Update CLAUDE.md / README (senders no longer Gmail-only)
- [ ] 7.2 DEPLOY.md: run migration before deploying
- [ ] 7.3 Commit + deploy

---

## Open questions
- Offer custom SMTP to all plans or paid only?
- Does the product still market itself as "Gmail-native"? (copy changes on marketing pages)

## Carried over from the GA initiative (see done.md)
- Set `NEXT_PUBLIC_GA_ID` in Vercel prod env
- Live GA Realtime check in a browser
- Optional 2.7 custom funnel events

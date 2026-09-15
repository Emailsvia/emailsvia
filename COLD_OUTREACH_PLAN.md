# EmailsVia: Cold Outreach and Follow-up Plan

> Written 2026-09-15. Based on a full code audit of this repo and market research on 11 competitors, mailbox-provider rules, benchmark data and law.
> Code references are `path:line` as of commit `09ca1e8` plus the uncommitted working tree.
> Competitor numbers mostly come from vendor reports, so treat them as directional. Google, Microsoft, RFC and FTC facts come from primary sources.

---

## 0. TL;DR

EmailsVia has a solid base: Gmail OAuth, SMTP and send-as senders, rotation, merge tags, `{{ai:}}` personalization, strict merge, a 7-intent AI triage, and reply correlation by Message-ID. **It is not yet safe to sell as a cold-outreach tool.** Three reasons:

1. **The follow-up engine has correctness bugs.** It can send the wrong step, conditions never fire, follow-ups go out after someone has replied (reply polling is off by default), out-of-office replies kill sequences, and bounces are never detected.
2. **Compliance and deliverability basics are broken or missing.** One-click unsubscribe points at a page with no POST handler. There is no bounce handling, no domain-level stop, and the warmup ramp goes to 400/day (practitioner consensus is 25–50/day per inbox).
3. **Throughput is capped at 1 email per minute across the whole platform.** A single global lock sends one recipient per tick, about 1,440 emails a day in total, while plans promise thousands per user.

**Positioning to aim for:** *"Gmail-native simplicity (GMass/Mailmeteor) with Instantly-grade sequences and reply intelligence, at a lower price."* Don't compete on lead databases or warmup networks. Win on correctness, deliverability hygiene, and the reply side (OOO resume, intent-driven actions, AI-drafted replies).

---

## 1. Current capability scorecard

| Area | Status | Notes |
|---|---|---|
| Gmail OAuth / app password / custom SMTP / send-as | ✅ | `lib/gmail.ts`, `lib/mail.ts`, migrations 0017/0018 |
| Inbox rotation | ✅ (partial) | `weight` is ignored; not plan-gated by `inbox_rotation` |
| Warmup | ⚠️ ramp cap only | 14-day ramp 10→400 (`lib/warmup.ts`). No warmup network. Counted per campaign, not per sender (`tick/route.ts:168-177`) |
| Schedule windows | ✅ | Per-weekday windows. **One campaign timezone, no UI to change it, no recipient timezone** |
| Gap between sends | ⚠️ | Fixed `gap_seconds`, no jitter |
| Throughput | ❌ | 1 send/tick platform-wide (`tick/route.ts:40-75`) |
| Merge tags | ⚠️ | No `{{x \| fallback}}`; unknown tags go out as literal `{{x}}` when strict merge is off |
| AI personalization `{{ai:}}` | ✅ | Silently becomes empty on failure; not shown in preview |
| Spintax | ❌ | |
| A/B testing | ⚠️ | API only, no UI; `Math.random` assignment; winner promoted by hand; first step only |
| Follow-up steps | ⚠️ buggy | See §2 |
| One-click unsubscribe (RFC 8058) | ❌ broken | Header URL is `/u/<token>`, a page with no POST handler (`tick/route.ts:586,615`) |
| Unsubscribe default | ⚠️ inconsistent | Form off, DB on, API on |
| Open/click tracking | ✅ off by default (good) | Click redirect target not signed (open redirect); no custom tracking domain |
| Bounce handling | ❌ | DSNs skipped (`check-replies/route.ts:238`); OAuth sends never see bounces |
| List validation | ⚠️ | Syntax + MX only; no catch-all or SMTP probe |
| Suppression | ⚠️ | Per-user email only; no domain, bounce, or import list |
| SPF/DKIM/DMARC checker | ❌ | |
| Reply ingestion | ⚠️ opt-in | `poll_replies` off by default; misses rotation inboxes (`check-replies/route.ts:176-179`) |
| AI triage (7 intents) | ✅ | Growth/Scale. Intents trigger no actions |
| Unified inbox | ⚠️ read-only | Reply is a `mailto:` link; no reply in app, re-label, or read state |
| OOO detection | ⚠️ | Detected but treated as a real reply, so the sequence stops |
| Analytics | ⚠️ | Campaign-level only; no per-step or per-sender stats |
| Webhooks | ⚠️ | Single attempt, no retry; no sent/bounce/open events |
| Public API | ⚠️ | Only `POST /api/v1/campaigns/from-sheet` |
| Plan gating | ❌ leaky | `follow_ups`, `conditional_sequences`, `inbox_rotation`, webhooks not enforced |
| Physical address in footer (CAN-SPAM) | ❌ | |

---

## 2. Follow-up engine: bugs found

Ordered by severity. Every item was traced in code; the top three were re-checked by hand.

| # | Bug | Where | Impact |
|---|---|---|---|
| F1 | **Replied people still get follow-ups.** `poll_replies` defaults to off; even when on, the poll runs every 5 min and tick never re-checks before sending | `0015_user_settings.sql:19`, `tick/route.ts:340-395` | Worst possible cold-email failure: reputation and spam complaints |
| F2 | **Wrong step sent.** `scheduleNextFollowUp` finds the next *eligible* step but discards its number; tick always loads `follow_up_count + 1` | `tick/route.ts:358, 807-825` | Skipped steps still send, on the wrong timing |
| F3 | **Conditions are checked when scheduling, not when sending.** `intent_in` can never be true (a reply sets `replied` and clears the schedule; follow-ups select `status='sent'` only) | `tick/route.ts:754,759`, `check-replies/route.ts:316-320` | Conditional sequences are effectively dead |
| F4 | **Replies landing in rotation inboxes are missed** (the poll only matches `campaigns.sender_id`) | `check-replies/route.ts:176-179` | Follow-ups keep going to people who replied |
| F5 | **Replies can land on the wrong campaign** (email fallback takes the first match across campaigns) | `check-replies/route.ts:213-216` | Wrong sequence stopped, right one continues |
| F6 | **OOO counts as a reply** and ends the sequence | `check-replies/route.ts:227-231` | Lost leads; inflated reply rate and A/B results |
| F7 | **Bounces never stop sequences** | `check-replies/route.ts:238`; Gmail API bounces arrive later as DSNs | Repeated sends to dead addresses cause bounce-rate damage |
| F8 | **Threading breaks.** A step-level subject override gets "Re:" logic from the original subject; Gmail `threadId` is never stored; `References` holds only the first Message-ID; no threading at all if the Message-ID lookup fails | `tick/route.ts:486,533-536,621-627`, `gmail.ts:156-180` | Follow-ups show up as unrelated new emails |
| F9 | **The pinned sender is abandoned** when it's capped or revoked, so a different mailbox sends the follow-up | `tick/route.ts:432-441` | Breaks threading, looks spoofed |
| F10 | **One failure ends the sequence** (no retry for follow-ups; a missing merge field clears the schedule) | `tick/route.ts:550-554,681,700-707` | Silent sequence loss |
| F11 | **Editing steps doesn't reschedule anyone**; delete-and-reinsert isn't atomic, so a tick during a save clears schedules | `follow-ups/route.ts:54-63` | Silent sequence loss |
| F12 | **Turning follow-ups off leaves the campaign stuck** in "waiting"; turning them on doesn't backfill already-sent recipients | `tick/route.ts:399-404,753` | Campaign never finishes / feature appears broken |
| F13 | **Duplicating a campaign drops step conditions** | `campaigns/[id]/duplicate/route.ts:47-54` | |
| F14 | **Follow-ups always go first**, so they starve new sends, and they bunch up when the window opens | `tick/route.ts:340` | Unnatural bursts; new sends stall |
| F15 | **Delays are whole days only** (0.5–60), with no business days and no recipient timezone | `follow-ups/route.ts:18` | Weekend and 3am sends |
| F16 | **Free plan can use follow-ups and conditions** (`follow_ups:false` not enforced) | `billing.ts`, `follow-ups/route.ts` | Revenue leak |
| F17 | **No step preview or test-send**; the detail page doesn't show conditions | `CampaignForm.tsx`, `campaigns/[id]/page.tsx` | Users send broken follow-ups blind |

---

## 3. What the best tools do (market research summary)

### 3.1 Sequence and follow-up features in the category

| Feature | Leaders | EmailsVia |
|---|---|---|
| Stop on reply (per lead) | all | ⚠️ opt-in, racy |
| **Stop on reply at company/domain level** | Smartlead "Company-level auto-pause", others | ❌ |
| **OOO detection with auto-resume on return date** | Instantly "AI Smart Pause & Resume" | ❌ (stops the sequence) |
| Conditional branching / subsequences by reply intent | Woodpecker, Lemlist, Instantly, Smartlead | ❌ (buggy) |
| A/Z test per step, judged on reply rate | Instantly, Smartlead, Lemlist, Woodpecker | ⚠️ first step only, no UI |
| Recipient-timezone business-day windows | standard | ❌ |
| Spintax / AI variants | Smartlead (default), Instantly AI spintax, Lemlist | ❌ |
| Same-thread follow-ups, optional new-thread step | standard | ⚠️ buggy |
| Bounce-rate auto-pause | Woodpecker Bounce Shield | ❌ |
| Built-in verification incl. catch-all | Woodpecker (free), Smartlead | ⚠️ MX only |
| Unified inbox with AI labels and reply in app | Instantly Unibox, Smartlead Master Inbox | ⚠️ read-only |
| AI-drafted replies / meeting booking | Instantly AI Inbox Manager (~5 min reply) | ❌ |
| Inbox placement tests | Instantly, Smartlead SmartDelivery (add-on) | ❌ |
| Multichannel (LinkedIn/SMS) | Lemlist, Reply.io, QuickMail | ❌ (skip for now) |
| Lead database | Apollo, Instantly, Lemlist, Saleshandy | ❌ (skip; integrate) |

### 3.2 Pricing landscape (Sept 2026)

- **Instantly:** $47–$358 flat, unlimited inboxes and warmup; Unibox and AI reply agent from the $194 bundle.
- **Smartlead:** $39–$379 flat, unlimited mailboxes; placement tests are a paid add-on.
- **Lemlist:** $55–$87+ per seat, plus credits for signals and data.
- **GMass:** ~$30–60 per user; sequences Premium+, rotation Professional only.
- **Mailmeteor:** $6–36; 5 follow-ups on Premium, rotation on Pro.
- **YAMM:** ~$25–50/yr; weak follow-ups.

**Takeaway:** the Gmail add-on tools gate follow-ups and rotation behind upper tiers; the scale tools make them table stakes. **EmailsVia should include follow-ups and rotation from its first paid tier** and differentiate on reply intelligence.

### 3.3 What differentiates the winners

1. Deliverability treated as the product (rotation, warmup, placement, auto-pause).
2. Reply-side AI (classification → actions, OOO resume, drafted replies).
3. Flat, generous pricing.
4. Agency tooling (workspaces, API, webhooks).
5. Bundled data and signals (we integrate rather than build).

---

## 4. The rules we must follow (deliverability and law)

### 4.1 Mailbox providers

| Rule | Source | EmailsVia action |
|---|---|---|
| SPF **and** DKIM, DMARC ≥ `p=none`, From aligned: Gmail/Yahoo for >5K/day senders (permanent classification); Microsoft consumer since **May 5, 2025** (`550 5.7.515` rejects) | Google sender guidelines, MS TechCommunity | Build a **DNS auth checker** per sender domain; block or warn before campaign start |
| Spam rate < **0.1%** target, never ≥ **0.3%** (Gmail); Yahoo counts against inbox-delivered mail only | Google, Yahoo | Track complaints proxy (unsubscribes + "not interested" + bounces); auto-pause thresholds |
| **One-click unsubscribe (RFC 8058)**: HTTPS URI in `List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, unsubscribe on **POST**, no redirect or cookies, both headers DKIM-signed; honour within 48h | RFC 8058, Google | **Fix (P0, §7.2)**: point the header at a POST endpoint; confirm `h=` in DKIM covers the headers |
| Gmail enforcement since **Nov 2025**: non-compliant mail gets SMTP **rejection** (4.7.27 / 5.7.27 / 4.7.31 / 4.7.23), not just the spam folder | Suped, Red Sift | Map these codes in `lib/errors.ts` → `auth_config` class, surface to the user |
| Bounce rate < **2%** | Instantly 2026 benchmark | Auto-pause a sender/campaign at >3% rolling |
| Free Gmail **500/day**, Workspace **2,000/day** (mail merge ~1,500), trial 500 | Google | Hard caps per sender type |
| **Practical cold volume:** new inbox 10–30/day; warmed 25–50/day; aggressive 50–100 | MailReach, LeadHaste, Maildeck (practitioner consensus) | **Re-tune warmup: 14–28 day ramp to 50/day default, max 100** instead of 400 |
| Tracking pixels hurt placement (claimed 2–10pp); opens unreliable (Apple MPP, image proxy) | Instantly (vendor) | Keep tracking off by default; never on step 1; add custom tracking domain |
| `gmail.send` + `gmail.readonly` are **restricted scopes** → Google verification + annual **CASA Tier 2** (~$500–4.5K) | Google | Budget it; blocks public OAuth launch |

### 4.2 Law

| Regime | Key requirements | Product feature |
|---|---|---|
| **CAN-SPAM (US)** | No consent needed; honest headers; **physical postal address**; working opt-out honoured within 10 business days; up to $53,088 per email | Mandatory sender address in footer (per user profile); unsubscribe on by default for cold campaigns |
| **GDPR (EU)** | Legitimate interest with a documented LIA; Art. 14 notice (data source); easy objection. **Germany (UWG §7) effectively needs consent even for B2B**; France allows B2B to role-relevant addresses | "Data source" column/field; country warnings for `.de` domains; per-tenant global suppression |
| **UK PECR** | B2B to limited companies OK with opt-out; sole traders count as individuals; fines aligned to UK GDPR from ~Feb 2026 | Same as GDPR set |
| **CASL (Canada)** | Opt-in; implied consent via conspicuous publication and role relevance; sender identity + address; unsubscribe within 10 business days; up to C$10M | Warning for `.ca` lists; required sender info |
| **India DPDP Act + Rules 2025** | Full compliance due ~**May 13, 2027**; consent-centric; cold B2B uncertain; publicly available data exclusion may help | Get legal review; EmailsVia is a data fiduciary/processor for Indian users' lists; add DPA + retention controls |

---

## 5. Data-backed follow-up best practices (what defaults to ship)

| Finding | Data | Default in EmailsVia |
|---|---|---|
| Follow-ups generate **40–60%** of replies | Instantly: 42%; Belkins (7.5M emails): 58.6% | Follow-ups **on** by default for new campaigns |
| Step 3 produces ~36% of meetings; steps 3–5 produce 53% | Belkins 2026 | Default sequence has 4 emails |
| 4–7 touches optimal; 3–5 step campaigns ~8.3% reply | Instantly, Belkins, Woodpecker | Max 10 steps is fine; template = 4 |
| Spacing: first follow-up at 48–72h, then widening | Gong, Instantly (3–4 days) | **Default cadence: Day 0 → +3 → +4 → +7 business days** |
| Same thread for steps 2–3; optional new thread later for a new angle | Practitioner consensus | `thread_mode: same \| new` per step, default `same` |
| "Did you get my email?" / guilt breakups lift replies but **cut meetings 14%** | Gong | Templates add value per step; lint warning on guilt phrases |
| Length **50–100 words** (under 80 ideal); grade 3–5 reading level | Gong, Instantly, Lavender | Word count + reading-level meter in editor |
| Interest CTA beats meeting CTA (meeting asks get **44% fewer** replies) | Gong (304K emails) | CTA lint hint |
| 2+ personalizations: 5.6% vs 3.6% | Hunter 2026 | Personalization-count meter; `{{ai:}}` icebreaker template |
| Recipient local time, Tue–Thu, 8–11am; consistency adds 15–20% replies | Instantly, Smartlead | Recipient timezone + business-day windows; jittered even pacing |
| Subject 1–4 words, looks internal | Gong | Subject lint |
| Average reply 3.43%; top quartile 5.5%; elite 10.7%+ | Instantly 2026 | Show benchmark bands on campaign stats |
| Small lists win (<50 recipients: 5.8% vs 1K+: 2.1%) | Woodpecker | Nudge users to segment |

---

## 6. Target design: Follow-up Engine v2

### 6.1 Principles

1. **Decide at send time, not schedule time.** Scheduling only sets *when to look again*. Every rule (replied? bounced? unsubscribed? domain stopped? OOO paused? condition met?) is evaluated just before sending.
2. **The Gmail thread is the source of truth.** Store `gmail_thread_id` on first send; before each follow-up, check the thread directly. This removes the 5-minute race and the `poll_replies` dependency for OAuth senders.
3. **Sticky sender, always.** If the pinned sender can't send now, *wait*; never switch.
4. **Nothing ends silently.** Every sequence exit has a recorded `stop_reason`.

### 6.2 Schema changes (new migration `0019_followup_engine_v2.sql`)

```sql
-- recipients: explicit sequence state
alter table recipients
  add column gmail_thread_id text,
  add column message_ids text[] default '{}',         -- full chain for References
  add column next_step_number int,                    -- which step is due (fixes F2)
  add column sequence_status text default 'active'    -- active | paused_ooo | stopped | completed
    check (sequence_status in ('active','paused_ooo','stopped','completed')),
  add column stop_reason text,                        -- replied | bounced | unsubscribed | domain_replied | manual | failed | step_removed
  add column resume_at timestamptz,                   -- OOO return date
  add column follow_up_attempts int default 0,        -- retry count for current step
  add column timezone text;                           -- recipient tz (optional column from import)

-- follow_up_steps: finer timing + threading + variants
alter table follow_up_steps
  add column delay_unit text default 'business_days'  -- hours | days | business_days
    check (delay_unit in ('hours','days','business_days')),
  add column thread_mode text default 'same'          -- same | new
    check (thread_mode in ('same','new'));

create table follow_up_step_variants (          -- A/Z per step
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  step_id uuid not null references follow_up_steps(id) on delete cascade,
  subject text, template text not null, weight int default 1
);  -- + RLS on auth.uid() = user_id

-- campaigns
alter table campaigns
  add column stop_on_domain_reply boolean default true,
  add column bounce_pause_threshold numeric default 0.03;

-- per-tenant domain suppression + bounce list
create table suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email','domain')),
  value text not null,
  reason text not null,   -- unsubscribed | bounced | not_interested | manual | import
  created_at timestamptz default now(),
  primary key (user_id, kind, value)
);  -- + RLS; migrate existing `unsubscribes` rows in
```

### 6.3 Send-time pipeline (tick, per due follow-up)

```mermaid
flowchart TD
  A[Due: next_follow_up_at <= now, sequence_status=active] --> B{Unsubscribed / suppressed email or domain?}
  B -- yes --> X1[stop: unsubscribed/suppressed]
  B -- no --> C{Any reply in campaign from same domain & stop_on_domain_reply?}
  C -- yes --> X2[stop: domain_replied]
  C -- no --> D{OAuth sender? check Gmail thread<br/>threads.get(gmail_thread_id)}
  D -- non-self message found --> E[ingest reply now → triage]
  E --> E1{OOO?}
  E1 -- yes --> P[paused_ooo, resume_at = parsed return date or +7d]
  E1 -- no --> X3[stop: replied]
  D -- DSN / mailer-daemon in thread --> X4[stop: bounced + suppress email]
  D -- clean --> F{Pinned sender available now?<br/>window, cap, warmup, not revoked}
  F -- no --> W[reschedule to sender's next window slot; do NOT switch]
  F -- yes --> G{Step next_step_number exists & condition passes NOW?}
  G -- step missing --> X5[completed / step_removed]
  G -- condition false --> H[advance to next eligible step, recompute time]
  G -- ok --> I[render variant; strict-merge check]
  I -- missing field --> X6[stop: failed(merge) + surface in UI]
  I --> J[send with In-Reply-To = last msg id,<br/>References = full chain, threadId, Re: original subject<br/>unless thread_mode=new]
  J -- transient error --> R[retry w/ backoff, attempts++ up to 3]
  J -- permanent --> X7[stop: failed/bounced]
  J -- ok --> K[append message_id, next_step_number++,<br/>schedule by delay_unit in recipient tz + jitter]
```

A cron also resumes `paused_ooo` rows where `resume_at <= now`, setting `sequence_status='active'` and `next_follow_up_at = next window slot`.

### 6.4 Specific fixes mapped to design

| Bug | Fix |
|---|---|
| F1, F4, F5 | Pre-send Gmail thread check (OAuth); for SMTP/IMAP senders, run a targeted IMAP search `HEADER In-Reply-To <id>` for that recipient before sending. Turn `poll_replies` **on by default** for campaigns with follow-ups. Poll every sender in `campaign_senders`, not only `campaigns.sender_id`. Correlate by Message-ID / threadId before email; the email fallback must be scoped to the most recent `sent` recipient |
| F2, F3 | `next_step_number` column; conditions evaluated in the pipeline at step G |
| F6 | OOO → `paused_ooo` + `resume_at` (parse "back on …" with a regex first, LLM fallback); do **not** count in reply rate |
| F7 | Parse DSNs (`multipart/report; report-type=delivery-status`, mailer-daemon senders, `X-Failed-Recipients`), match on original Message-ID, suppress the email, feed bounce-rate auto-pause |
| F8 | Store `gmail_thread_id` + `message_ids[]`; pass `threadId` to `users.messages.send`; "Re: " + *original* subject unless `thread_mode='new'` |
| F9 | Step F: wait, never switch |
| F10 | Retry follow-ups (3 attempts, backoff); merge failures shown in a "needs attention" list rather than cleared silently |
| F11 | Upsert steps by `step_number` inside one RPC transaction; on delete, re-point affected recipients; show "N recipients affected" in UI |
| F12 | "Upcoming" counts respect `follow_ups_enabled`; enabling follow-ups backfills `sent` recipients (confirm dialog) |
| F13 | Duplicate copies `condition`, `delay_unit`, `thread_mode`, variants |
| F14 | Interleave: per sender, alternate follow-up / new send; spread due follow-ups across the window with jitter |
| F15 | `delay_unit` + recipient `timezone` (import column, else infer from domain TLD, else campaign tz) + campaign timezone picker in UI |
| F16 | Enforce `hasFeature('follow_ups')` / `conditional_sequences` in the API **and** tick |
| F17 | Step preview (renders with sample row incl. `{{ai:}}`), test-send per step, conditions shown on detail page |

### 6.5 Intent-driven actions (turning triage into automation)

| Intent | Default action (user-configurable) |
|---|---|
| Interested / Meeting request | Stop sequence; mark hot; notify (email/Slack/webhook); optional AI draft reply with calendar link |
| Not interested | Stop; **suppress domain** (optional); no further campaigns |
| Unsubscribe request (in body) | Stop + suppress email (treat as unsubscribe even without clicking) |
| Out of office | Pause → resume on return date |
| Referral ("talk to X") | Stop; create new recipient for referred contact (needs approval) |
| Wrong person / left company | Stop; suppress email |
| Question / objection | Stop; AI draft reply queued for human approval |

---

## 7. Other workstreams

### 7.1 Sending engine and scale
- **Per-sender concurrency:** replace the global one-send-per-tick loop with a per-sender lock (`tick_locks` keyed `sender:<id>`). Each tick sends up to one email per *eligible sender* in parallel (bounded, e.g. 20), respecting each sender's gap. This is needed for anything beyond hobby scale.
- **Jitter:** `gap_seconds ± 30%` randomized; no fixed-cadence footprint.
- **Warmup caps counted per sender** across all campaigns; ramp re-tuned (§4.1).
- **Hard caps by sender type:** free Gmail ≤ 100/day cold (limit 500), Workspace ≤ 150/day cold (limit 2,000), with a UI explanation.
- **Rotation `weight`** honoured; gate rotation on the plan flag.
- Atomic `usage_daily` increment (RPC with `on conflict do update set count = count + 1`); tick lock must **fail closed** if the RPC is missing.

### 7.2 Deliverability
- **Fix one-click unsubscribe (P0):** `List-Unsubscribe: <https://…/api/u/<token>>, <mailto:…>`. The POST endpoint returns 200 with no redirect; GET shows a confirm page.
- Unsubscribe **on by default** for campaigns; physical address required in the footer (CAN-SPAM).
- **Auth checker:** SPF/DKIM/DMARC/PTR lookup per sender domain, shown on the Senders page with a fix-it guide. Block campaign start on DMARC-missing for custom domains.
- **Bounce Shield:** auto-pause a campaign/sender when the rolling 100-send bounce rate exceeds 3% or "not interested" exceeds 5%.
- **Verification v2:** MX + catch-all detection + disposable/role-address flags; optionally integrate a paid verifier (ZeroBounce/NeverBounce/MillionVerifier) via BYO key.
- **Signed click target** (HMAC over URL) to close the open redirect; custom tracking domain (CNAME) for Scale.
- **Map Gmail 2025 rejection codes** (`4.7.27`, `5.7.27`, `4.7.31`, `4.7.23`, `5.7.515`) to a new `auth_config` error class → pause the sender and surface a fix.
- Spintax `{spin|variant}` in the renderer, plus AI "generate 3 variants".
- Pre-send content lint: word count, links count (≤1 on step 1), images, spam words (server-side too), reading level.

### 7.3 Reply side (our differentiator)
- **Unibox v2:** reply in app (send via Gmail API in the same thread), mark read, re-label intent, filter by campaign/sender, keyboard shortcuts.
- **AI draft replies** (human-in-the-loop by default; autopilot opt-in only). The market lesson from 11x and AI-SDR churn: autonomous sending underdelivers.
- Meeting link insertion (Calendly/Cal.com URL from settings); "meeting booked" status.
- Out-of-office replies excluded from reply-rate and A/B metrics.

### 7.4 Personalization and content
- `{{First Name | there}}` fallback syntax; strict merge stays.
- `{{ai:…}}` shown in preview; failure → skip recipient (strict) or visible warning, never silent empty.
- A/B UI for step 1 **and** per follow-up step; deterministic hash assignment; auto-promote the winner by **reply rate** (not opens) after N sends with a significance check.
- Sequence template library (4-step SaaS, agency, recruiting, founder outreach, job seeker) following §5 rules.

### 7.5 Analytics
- Per-step funnel (sent → replied → interested), per-sender health (bounce, reply, OOO, unsub), per-variant reply rate, benchmark bands (3.4% avg / 5.5% good / 10%+ elite).
- A deliverability dashboard combining auth status, bounce trend, spam-complaint proxy and warmup stage.

### 7.6 Integrations and API
- Webhook retries (exponential, using the existing `next_attempt_at`) + events `email.sent`, `email.bounced`, `sequence.stopped`, `recipient.ooo_paused`.
- API: list/create campaigns, add recipients, pause/resume, stats. Zapier/Make; HubSpot/Pipedrive push on "interested".
- Lead data: **integrate, don't build** (Apollo/Hunter CSV mapping presets, enrichment via BYO key).

### 7.7 Compliance and platform
- Per-tenant **global suppression** by email and domain, applied across all campaigns; import/export.
- "Data source" field per list (GDPR Art. 14); country warnings (Germany, Canada).
- Cross-campaign dedupe ("already contacted in last 90 days" warning).
- Google OAuth restricted-scope verification + CASA Tier 2: schedule and budget now.
- DPDP (India) legal review before 2027 deadline; DPA page.

---

## 8. Phased roadmap

Effort: S ≤ 1 day, M 2–4 days, L 1–2 weeks.

### Phase 0: Stop the bleeding (week 1) · *must ship before any marketing push*

**Status (2026-09-15):** code done, not yet verified end-to-end on the dev server; needs migration `0019_followup_safety.sql` applied first.
- ✅ Pre-send reply/bounce/OOO check against the sender's mailbox (`src/lib/followup-guard.ts`; Gmail API + IMAP), fails closed
- ✅ `next_step_number` + conditions evaluated at send time (`resolveDueStep`)
- ✅ OOO no longer stops sequences (tick guard + check-replies push the next follow-up ≥7 days out); `replies.is_auto_reply`
- ✅ Reply poll covers rotation inboxes; email fallback picks the newest campaign
- ✅ Sticky sender waits instead of switching; `gmail_thread_id` stored and reused
- ✅ Follow-up failures retry (3×, auth problems wait); rejected address → `bounced`; `stop_reason` recorded
- ✅ RFC 8058: `List-Unsubscribe` → `POST /api/unsubscribe?token=`; GET no longer unsubscribes; form default unsubscribe on
- ✅ Warmup counted per sender across campaigns
- ✅ Plan gates: `follow_ups` (tick + API), `conditional_sequences` (API)
- ✅ Signed click-redirect URLs
- ⏸ Warmup ramp reduction (touches marketing copy: decision pending)
- ⏸ Physical-address footer (needs profile field + UI)
- ⏸ Rotation plan gate (Growth has 3 senders but `inbox_rotation:false`: pricing decision)

| Item | Effort |
|---|---|
| Fix RFC 8058 one-click unsubscribe (POST endpoint), unsubscribe default on, physical address footer | S |
| Pre-send reply check via Gmail thread (store `gmail_thread_id`) + `poll_replies` default on when follow-ups on + poll all rotation senders | M |
| `next_step_number` + evaluate conditions at send time (F2/F3) | M |
| OOO → not a reply; pause instead (basic: +7 days resume) | S |
| Never switch sticky sender; retry failed follow-ups | S |
| Warmup counted per sender; ramp capped at 50/day default | S |
| Enforce plan flags (follow_ups, conditional, rotation, webhooks) | S |
| Signed click-redirect URLs | S |

### Phase 1: Follow-up Engine v2 (weeks 2–3)

**Status (2026-09-15):** mostly done; needs migration `0020_sequences_v2.sql` (after 0019). SQL verified on a scratch Supabase Postgres (clean apply of schema + 0002–0020, RPCs exercised under RLS incl. cross-user denial). `next build` passes.
- ✅ Business-day delays (`follow_up_steps.delay_unit`, `src/lib/sequence-schedule.ts`) + 0–90 min jitter; default cadence 3 → 4 → 7 business days
- ✅ Campaign timezone picker (defaults to the browser zone) + server-side IANA validation
- ✅ Company-level stop on reply (`campaigns.stop_on_domain_reply`, default on; free-mail domains never grouped), in the tick guard and the reply poller
- ✅ DSN bounce parsing in check-replies → recipient `bounced` + suppressed
- ✅ `suppressions` table (email/domain, RLS) checked before every send; hard bounces auto-added (5.7.x policy rejections excluded); do-not-contact list UI in Settings
- ✅ Atomic step replace (`replace_follow_up_steps` RPC) + backfill of already-sent recipients when follow-ups/steps are enabled (`backfill_follow_ups`)
- ✅ Duplicate copies conditions + delay units
- ✅ Follow-ups interleave with first sends
- ✅ Detail page shows step conditions/units, each recipient's next step or why the sequence stopped
- ⏸ Full `References` chain (only the first Message-ID is referenced; Gmail `threadId` covers the sender side)
- ⏸ Step preview + per-step test send
- ⏸ Per-recipient timezone column
| Item | Effort |
|---|---|
| Migration 0019 (state machine, `stop_reason`, suppressions, delay units, thread_mode) | M |
| Full send-time pipeline §6.3 + full `References` chain + `threadId` | L |
| DSN bounce parsing → suppress + stop | M |
| Domain-level stop-on-reply | S |
| Business-day delays, recipient timezone, campaign timezone picker | M |
| Atomic step editing + reschedule + backfill on enable; duplicate copies everything | M |
| Step preview + per-step test send + conditions on detail page | M |
| Interleave follow-ups/new sends + jitter | S |

### Phase 2: Scale and deliverability (weeks 4–5)

**Status (2026-09-15):** first half done; needs migration `0021_campaign_pause_reason.sql` (after 0020). `next build` passes.
- ✅ Phase 1 leftover: per-step preview + "Test whole sequence" (first email + every follow-up, threaded, to the tester)
- ✅ Parallel tick: one send per eligible campaign per tick (≤25 campaigns, 6 concurrent, 35s budget), never two sends from one mailbox in a tick; plan allowance and single-sender warmup reserved up front so parallel sends can't overshoot
- ✅ SPF/DKIM/DMARC/MX checker (`src/lib/dns-auth.ts`, `GET /api/senders/[id]/dns`, "Check DNS" on each sender); lookup timeouts reported as "try again", not as missing records
- ✅ `sender_auth` error class (Gmail 4.7.23/26/27/30/31, 5.7.26/27, Outlook 5.7.515) → campaign auto-paused with `paused_reason`, recipient untouched
- ✅ Bounce Shield: >5% bounced after 40 contacted → campaign auto-paused (`paused_reason='bounce_rate'`), banner on the campaign page
- ✅ Rotation campaigns: one send per attached inbox per tick (≤10), `gap_seconds` applied per inbox across campaigns; slots of one campaign run sequentially, campaigns in parallel
- ✅ Spintax `{Hi|Hey|Hello}` (deterministic per recipient + step) and merge fallbacks `{{First Name | there}}` (never "missing" under strict merge); both tolerate the editor's `\|` escaping; wired into tick, test send, previews
- ✅ Cold-email content lint: >2 links, >110/150 words, images
- ✅ Verification v2: disposable domains, role-address count, per-domain MX cache, whole list in pages within 45s; invalid → `skipped` (not `bounced`, so Bounce Shield isn't tripped by never-sent rows)
- ✅ "Use proven 3-step sequence" starter (3 → 4 → 7 business days); save blocked until the placeholder is replaced
- ⏸ Catch-all detection (needs an SMTP probe on port 25, blocked on Vercel; use a paid verifier API instead)
| Item | Effort |
|---|---|
| Per-sender concurrency in tick | L |
| SPF/DKIM/DMARC/PTR checker + rejection-code mapping | M |
| Bounce Shield auto-pause | S |
| Verification v2 (catch-all, disposable, role) | M |
| Spintax + content lint (word count, links, reading level) | M |
| Default 4-step sequence templates following §5 | S |

### Phase 3: Reply intelligence (weeks 6–8)

**Status (2026-09-16):** core done; needs migration `0022_reply_workflow.sql` (verified on a scratch Supabase Postgres: clean apply + re-apply, RLS on `reply_messages`). `next build` passes.
- ✅ Reply from inside EmailsVia (`POST /api/replies/[id]/send`): same mailbox, threaded under the prospect's Message-ID + Gmail threadId, no tracking/unsubscribe footer; saved in `reply_messages`, reply marked done
- ✅ AI-drafted replies (`POST /api/replies/[id]/draft`, Growth/Scale): uses the original email + their reply + label + meeting link; forbidden from inventing facts (bracketed notes instead); human edits before sending, send warns on leftover [brackets]
- ✅ Inbox / Done / Auto-replies / All views, unread dots, mark done, manual relabel
- ✅ Actions by label (`src/lib/reply-actions.ts`, idempotent, run after AI triage and manual relabels): unsubscribe → real unsubscribe + webhook; bounce → bounced + suppressed + Bounce Shield; ooo → undo the "replied" stop and resume in 7 days; interested → email the owner once (Postmark)
- ✅ Settings: meeting link, "email me when someone is interested"
- ✅ Fix: AI triage only ran when `ANTHROPIC_API_KEY` was set, even with Groq/Gemini configured
- ✅ Referral handling: addresses mentioned in a reply show as "+ add as lead"; creates a pending recipient in the same campaign (company/columns copied, `{{Referred By}}` set, unsubscribe/suppression checked, finished campaign reopened)
- ✅ Campaign analytics: reply rate vs benchmarks (3.4 / 5.5 / 10.7%, "early" under 50 sends), per-step sends/replies/share of replies, per-inbox reply and bounce rate
- ✅ A/B auto-winner: 1.5× lead + two-proportion z-test (p<0.05); tick pins it automatically every 20 first sends when `ab_winner_threshold` is set
- ⏸ UI to create A/B variants (still API-only)
| Item | Effort |
|---|---|
| OOO return-date parsing + auto-resume | M |
| Intent-driven actions (§6.5) | M |
| Unibox v2: reply in thread, read state, re-label | L |
| AI draft replies (human approval) + meeting link | M |
| Per-step A/B UI + auto-winner by reply rate | M |
| Per-step / per-sender analytics + benchmark bands | M |

### Review pass (2026-09-16)

An independent review of Phases 0–3 found 10 issues; all fixed. Needs migration `0023_step_remap_backfill_cap.sql` (verified on scratch Postgres). Tick `maxDuration` is now 120s in `vercel.json`.
- ✅ Duplicate-send risk on slow/killed ticks: claim marks the row in flight (pending pickers skip recent `last_sent_at`; claimed follow-ups pushed 2h out), no claims after 40s, lock TTL 180s > maxDuration 120s
- ✅ Delivery notices classified (`classifyDsn`): only hard bounces suppress; 5.7.x DMARC/SPF rejections pause the campaign as `sender_auth`; delays ignored (poller, guard, AI "bounce" label)
- ✅ Guard revokes the inbox that actually failed; guard failures back off and stop after 6 tries with `stop_reason='guard_failed'`
- ✅ IMAP guard searches All Mail + Junk (archived/filtered replies); Gmail guard fails closed on fetch errors; emailing your own address skips the guard
- ✅ AI "ooo" never restarts a sequence for someone who sent a human reply
- ✅ Editing steps remaps recipients by stable step ids (no skipped or silently ended sequences)
- ✅ Rotation slots stop when the campaign is paused mid-tick
- ✅ MX check: timeouts leave rows pending (not skipped), A-record fallback, null-MX handled
- ✅ Backfill only for recipients contacted in the last 30 days
- ✅ Also fixed: sender/variant pin on retry success; reply polling + guard check the original inbox after a campaign's sender changes

### Phase 4: Growth

**Status (2026-09-16):** built; needs migration `0024_integrations.sql` and the new pg_cron job `emailsvia-webhooks` (re-run `supabase/cron.sql`). `next build` passes.
- ✅ A/B variant editor in the campaign form (main subject/body = variant A, add B–D, auto-switch threshold); plan-gated `a_b_testing` in the API; edit page now also keeps `strict_merge` (was silently reset to on)
- ✅ Webhooks: delivery queue + retries (1m → 12h, then exhausted), `/api/cron/webhooks`, delivery log + Redeliver in the UI, SSRF guard (public IPs only, no redirects), plan-gated `webhooks`
- ✅ New events: `email.sent`, `email.bounced`, `sequence.stopped`, `campaign.paused` (send-loop events queued, never delivered inline)
- ✅ Public API v1 (Scale): `/me`, `/senders`, `/campaigns` (list/create with follow-ups), `/campaigns/:id` (get, start/pause), `/campaigns/:id/recipients` (list/add), `/replies`, `/suppressions`; docs in `docs/API.md` + endpoint table on the API keys page
- ✅ Integrations (Growth/Scale): HubSpot (contact upsert + note), Pipedrive (person upsert + note + lead on interested), Slack (channel message); per-label push, test button, encrypted tokens; Zapier/Make via webhooks
- ✅ Paid mailbox verification (Scale, operator env `EMAIL_VERIFIER_PROVIDER` = zerobounce | neverbounce | millionverifier): invalid/spam-trap → skipped, catch-all reported, each address verified once
- ✅ Review pass on Phase 4 (12 issues fixed): webhook delivery with hard 8s deadline + 2KB body cap and claim-before-send (a slow endpoint can't stall the queue or double-deliver); SSRF guard via `net.BlockList` (IPv4-mapped IPv6, NAT64, 6to4, fe80::/10…) with the checked address pinned for the connection (no DNS rebinding); `webhook_deliveries` read-only for users + owner check in delivery; send loop / poller only queue webhooks; paid verification results saved per address; per-integration sync tracking with retries + plan check; HubSpot 409 handling; API resume allowed with follow-ups left; A/B gate only on change + enforced in tick; unique `sequence.stopped`/`campaign.paused` event ids; AI triage can't override a manual label
- ⏸ Not code: Google OAuth restricted-scope verification + CASA assessment; agency workspaces; Outlook OAuth; placement testing; API rate limiting

### Phase 4 (original notes)
Webhook retries and new events, broader public API, Zapier/HubSpot/Pipedrive, custom tracking domain, global cross-campaign dedupe, placement testing (seed list), Outlook OAuth, agency workspaces, CASA assessment and OAuth verification completion.

**Skip / defer:** own warmup network, own lead database, LinkedIn automation (ban risk), fully autonomous AI SDR.

---

## 9. Success metrics

| Metric | Target |
|---|---|
| Follow-ups sent after a reply | **0** (alert on any) |
| Sequences ending without a `stop_reason` | 0 |
| Platform bounce rate (rolling 7d) | < 2% |
| Unsubscribe + not-interested rate | < 1% |
| Median campaign reply rate | ≥ 3.5% (category avg 3.43%) |
| Follow-up share of replies | 40–60% (confirms the engine works) |
| Senders with DMARC passing | > 90% of custom-domain senders |
| Throughput headroom | ≥ 20× current (per-sender concurrency) |

---

## 10. Sources

**Provider rules:** [Google sender guidelines](https://support.google.com/mail/answer/81126) · [Google FAQ](https://support.google.com/mail/answer/14229414) · [Gmail limits](https://support.google.com/mail/answer/22839) · [Workspace limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace) · [Gmail Nov 2025 enforcement (Suped)](https://www.suped.com/blog/new-gmail-bulk-sender-compliance-updates-november-2025) · [Red Sift](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know) · [Postmaster Tools v2](https://blueshift.com/blog/google-postmaster-tools-v2/) · [Microsoft high-volume sender rules](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%e2%80%99s-new-requirements-for-high%e2%80%90volume-senders/4399730) · [Yahoo (Sendmarc)](https://sendmarc.com/dmarc/yahoo-dmarc-requirements/) · [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html) · [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

**Volumes:** [MailReach](https://www.mailreach.co/blog/google-workspace-email-sending-limits) · [LeadHaste](https://leadhaste.com/blog/google-workspace-cold-email-limits-2026) · [Maildeck](https://maildeck.co/blog/cold-email-sending-limits/)

**Benchmarks:** [Instantly 2026 benchmark](https://instantly.ai/cold-email-benchmark-report-2026) · [Belkins follow-up stats](https://belkins.io/blog/sales-follow-up-statistics) · [Woodpecker stats](https://woodpecker.co/blog/cold-email-statistics/) · [Gong follow-up](https://www.gong.io/blog/7-tips-for-writing-the-perfect-follow-up-sales-email-according-to-science) · [Gong cold email data](https://www.gong.io/blog/does-cold-email-even-work-any-more-heres-what-the-data-says) · [Lavender](https://lavender.ai/blog/the-cold-email-benchmark-report) · [Tracking pixels (Instantly)](https://instantly.ai/blog/email-tracking-and-deliverability-why-tracking-pixels-can-hurt-your-inbox-placement/)

**Competitors:** [Instantly pricing](https://instantly.ai/pricing) · [Instantly OOO pause/resume](https://help.instantly.ai/en/articles/9713093-ai-smart-pause-resume-for-out-of-office-replies) · [Instantly AI Inbox Manager](https://help.instantly.ai/en/articles/8693846-ai-inbox-manager) · [Smartlead pricing](https://www.smartlead.ai/pricing) · [Smartlead company-level pause](https://helpcenter.smartlead.ai/en/articles/199-how-to-set-up-company-level-auto-pause) · [Lemlist pricing](https://www.lemlist.com/pricing) · [Woodpecker pricing](https://woodpecker.co/pricing/) · [GMass pricing](https://www.gmass.co/pricing) · [Mailmeteor pricing](https://mailmeteor.com/pricing) · [QuickMail pricing](https://quickmail.com/pricing) · [AI SDR comparison](https://salesmotion.io/blog/ai-sdr-tools-compared) · [11x (TechCrunch)](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have)

**Law:** [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) · [FTC 2025 penalties](https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-publishes-inflation-adjusted-civil-penalty-amounts-2025) · [CASL (Gowling WLG)](https://gowlingwlg.com/en/insights-resources/guides/2023/doing-business-in-canada-casl) · [Germany B2B (Overloop)](https://overloop.com/blog/b2b-cold-email-germany-gdpr-compliance) · [UK PECR (Bratby)](https://bratby.law/practice-areas/data-protection/pecr-eprivacy/) · [DPDP Rules 2025 (PIB)](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf) · [India Briefing](https://www.india-briefing.com/news/dpdp-rules-2025-india-data-protection-law-compliance-40769.html/)

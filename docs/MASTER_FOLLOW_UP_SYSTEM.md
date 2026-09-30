# Master Follow-Up System: discovery and proposal

> Written 2026-09-29 against `feat/cold-outreach-engine` @ `786c9f9`. Status: **Phases 1–4 built (see §9); system template pack waiting for your templates.** Decisions in §10 accepted as recommended on 2026-09-29.
> Core idea: **What did the recipient do → What does it mean → What should we do next?**
> Code references are `path:line` at that commit.

---

## 0. Summary

- **The send engine is a solid base.** Follow-up Engine v2 already provides a pre-send reply/bounce check against the mailbox, a sticky sender, threading, retries, a recorded stop reason for every ended sequence, company-level stop, suppressions and Bounce Shield (see `COLD_OUTREACH_PLAN.md`). None of this needs replacing. The master system should replace only the **"which email do we send next"** decision (`resolveDueStep`) and add a proper **activity layer** underneath it.
- **Today's follow-ups can't react to behaviour.** A campaign has one linear list of steps, and the only conditions are `always`, `no_reply`, `intent_in` and `intent_not_in`. Because follow-ups only go to `status='sent'` rows, `no_reply` behaves like `always`, and `intent_in` can really only match `ooo` (`tick/route.ts:564`). Nothing uses opens or clicks.
- **The activity data is too thin to decide on reliably.** Opens and clicks are stored per recipient, not per email (the tracking token is just the recipient id, `tick/route.ts:1071-1078`). Nothing filters bots, scanners or Apple Mail Privacy Protection (MPP). Clicks aren't de-duplicated. Follow-up Message-IDs aren't stored. Skip and defer decisions aren't recorded anywhere. And `recipient_events` doesn't exist: history is spread across `send_log`, `tracking_events`, `replies`, `unsubscribes` and `suppressions`.
- **Proposal: five layers.** (1) an append-only **Activity Ledger** per recipient; (2) a **signal rollup** plus a code-defined **Situation registry** that interprets the ledger; (3) a **Follow-up Engine** that applies fixed **safety rules** first, then the campaign's **user rules**; (4) the existing send pipeline and actions; (5) a **decision log and timeline** that explain every choice.
- **User-facing shape: "Smart follow-ups" in each campaign.** An ordered list of rules. Each rule has a multi-select of situations ("Didn't open", "Opened, didn't click", "Clicked a link", "Said *not now*", …), then one or more emails. Each email has a delay and a template the user writes, uploads, or picks from a library. The current step list becomes the built-in **"Everyone else who hasn't replied"** rule at the bottom, so existing campaigns behave exactly as today.

---

## 1. How it works today (as built)

```
first send (tick) ──► recipients.status = sent, message_id, gmail_thread_id, sender_id,
                      next_follow_up_at = +delay(step 1), next_step_number = 1
   │
   ├─ pixel  GET /api/t/o/<recipientId.sig>.gif  ──► tracking_events(kind=open)   (2-min dedup)
   ├─ click  GET /api/t/c/<recipientId.sig>?u=…  ──► tracking_events(kind=click, url)  (no dedup)
   ├─ unsubscribe POST /api/unsubscribe          ──► unsubscribes + recipients.status=unsubscribed
   ├─ reply poll /api/check-replies (5 min, opt-in, 7-day re-read)
   │     ├─ reply     ──► replies + status=replied, stop_reason=replied (+ company stop)
   │     ├─ auto-reply ──► replies(is_auto_reply) + push follow-up ≥7 days out
   │     ├─ DSN hard  ──► status=bounced + suppression + Bounce Shield
   │     └─ AI triage (Growth/Scale) ──► replies.intent ──► reply-actions (unsub / bounce / ooo / notify / CRM)
   │
   └─ follow-up due (tick) ──► pre-send guard reads mailbox (replied? bounced? OOO?)
                              ──► resolveDueStep(steps, next_step_number, {hasReplied, lastIntent})
                              ──► send step N in thread ──► schedule step N+1 or stop_reason=completed
```

### Gaps that matter for the master system

| # | Gap | Where | Why it matters |
|---|---|---|---|
| G1 | Opens and clicks aren't tied to a specific email. The token is the recipient id and the same pixel goes on every step | `tick/route.ts:1071-1078`, `t/o/[token]/route.ts:35` | You can't tell "opened follow-up 2" from "opened the first email" |
| G2 | No bot, scanner or MPP filtering. Clicks have no dedup. The user-agent is stored but never used | `t/c/[token]/route.ts:26-35`, `t/o/[token]/route.ts:47-68` | Security scanners "click" every link and Apple MPP "opens" everything, so behaviour rules would fire on machines |
| G3 | Follow-up Message-IDs aren't saved. `send_log` has no `message_id` | `tick/route.ts:1313-1318`, `supabase/schema.sql:129-137` | Replies to later steps can't be tied to a step. The `References` chain is incomplete |
| G4 | Skipped or deferred steps and "why" aren't recorded anywhere (they only appear in the tick's JSON response) | `tick/route.ts:591-605` | Users can't see why someone got, or didn't get, an email |
| G5 | `replied_at` is set to poll time, not message time | `check-replies/route.ts:390` | Timing rules ("replied within 1h") and stats are off by up to 5 min to 7 days |
| G6 | Every re-poll upserts `is_auto_reply` from headers, which undoes an AI or manual "ooo" relabel | `check-replies/route.ts:334` | The OOO state flips back |
| G7 | OOO return dates are never parsed; every OOO pauses a fixed 7 days | `followup-guard.ts:15` | A person back on Monday waits a week; a person on 3-month leave gets mailed after 7 days |
| G8 | Reply polling is **off by default** (`user_settings.poll_replies`), with no cursor (fixed 7-day re-read) | `0015_user_settings.sql`, `check-replies/route.ts:81` | Reply-based situations are invisible until the pre-send guard runs |
| G9 | Unsubscribe doesn't set `stop_reason` and emits no `sequence.stopped` | `unsubscribe/route.ts:28-32` | The history has a hole |
| G10 | The timeline API caps at 5,000 rows **campaign-wide**, newest first | `campaigns/[id]/activity/route.ts:22` | Large campaigns silently lose history in the drawer |
| G11 | No "delivered" record. The SMTP 250 response and the Gmail id are discarded | `lib/mail.ts:166-179` | "Accepted by server" isn't distinguishable from "sent" |
| G12 | Hard-bounce notices change status but aren't stored as an event or reply | `check-replies/route.ts:279-294` | No bounce detail in the history |
| G13 | New-campaign save is non-atomic: if the follow-ups PUT fails, re-saving creates a duplicate campaign | `CampaignForm.tsx:523-528` | Adding rules adds another save step, so this must be fixed first |

---

## 2. Q1: What we can track **today**

| Activity | Captured by | Stored in | Per email? | Reliability |
|---|---|---|---|---|
| Queued | import | `recipients.status=pending` | – | exact |
| Sent (accepted by Gmail or SMTP) | tick | `send_log` (kind, step, sender), `recipients.sent_at/last_sent_at/follow_up_count` | ✅ step | exact |
| Send failed or retried | tick | `send_log.error_class`, `recipients.error/retry_count` | ✅ | exact |
| Skipped (missing merge field, suppressed, invalid address, company stop) | tick, validate | `recipients.status=skipped`, `error`, `stop_reason` | ❌ | exact |
| Hard bounce, synchronous (SMTP 5.1.x) | tick | `status=bounced` + suppression | ❌ | exact |
| Hard bounce, async (DSN) | check-replies, guard | `status=bounced` + suppression | ❌ | good |
| Soft bounce or delay | check-replies | ignored | – | – |
| Sender auth rejection (DMARC/SPF) | tick, DSN | campaign `paused_reason=sender_auth` | – | good |
| Opened | pixel | `tracking_events(open, user_agent)` | ❌ recipient only | **weak** (MPP, image blocking, proxies) |
| Clicked (which URL) | redirect | `tracking_events(click, url, user_agent)` | ❌ recipient only | medium (scanners) |
| Replied | check-replies, guard | `replies` + `status=replied` | ❌ | good (if polling on) |
| Reply intent (7 labels + confidence, AI or manual) | triage, relabel | `replies.intent/intent_confidence/intent_source` | – | good (AI) |
| Auto-reply / OOO | headers, AI | `replies.is_auto_reply` | – | good |
| Unsubscribed (link, one-click, reply wording) | unsubscribe, reply-actions | `unsubscribes` + `status=unsubscribed` | ❌ | exact |
| Suppressed (email or domain) | bounces, manual | `suppressions` | – | exact |
| Colleague at the same company replied | sequence-stop | `stop_reason=domain_replied` | – | exact |
| You answered in-app | replies/[id]/send | `reply_messages` | – | exact |
| Referral added as a lead | replies/[id]/referral | new `recipients` row | – | exact |
| Sequence ended (+ why) | tick | `recipients.stop_reason` + webhook | – | exact (except G9) |

## 3. Q2: Additional activities we should track

| Activity | Why | How | Effort |
|---|---|---|---|
| **Per-email attribution** for opens, clicks, unsubscribes and replies | Every rule depends on it (fixes G1, G3) | Pre-generate the `send_log.id` before sending; put it in versioned tracking and unsubscribe tokens; save each email's Message-ID on `send_log`. Old tokens keep working as recipient-level | M |
| **Machine vs human** flag on opens and clicks | Without it, open/click rules fire on robots (G2) | Classify at ingest: Apple MPP (bare `Mozilla/5.0` UA and Apple proxy ranges), open within ~30s of send (prefetch), known scanner UAs (Safe Links, Mimecast, Proofpoint, Barracuda), HEAD requests, all links hit within seconds, plus a **hidden honeypot link** only bots follow. Store `is_machine` + reason; keep the event, exclude it from decisions | M |
| **Open state as three values**: opened / not opened / *can't tell* | MPP users would otherwise look like "didn't open" when we drop their machine opens, or like "opened" when we keep them | "Didn't open" = no open events at all; only machine opens = *unknown* (falls through to the default rule) | S |
| **Link identity** | "Clicked the pricing link" vs "clicked the LinkedIn link" | Link key auto-derived from the URL (host + path), optionally named in the editor; your meeting link (`user_settings.meeting_link`) recognised automatically | S |
| **Accepted / delivered** | Distinguish "accepted by server" from "sent"; infer delivered = accepted + no bounce after 72h | Keep the SMTP response and Gmail id from `sendMail` (G11) | S |
| **Soft bounce** events | Full mailbox or temporary failure: retry later, don't burn the address | `classifyDsn` → `soft` is already computed; record it instead of ignoring | S |
| **Bounce detail** (DSN status code, diagnostic) | History and Bounce Shield explanations (G12) | Record an event from check-replies and the guard | S |
| **OOO return date** | Resume exactly when they're back (G7) | Regex for common phrasings ("back on 6 Oct", "returning Monday"), with the AI provider as fallback; stored on the event and on `recipients.ooo_until` | M |
| **Auto-reply subtypes**: *left the company*, *mailbox not monitored*, *alternate contact given* | Stop plus suppress; offer the named alternate contact as a referral lead | Extend triage labels; the parsing model already sees the body | M |
| **More reply intents**: `referral`, `wrong_person`, `meeting_request` (split from `interested`), `objection` | Different next steps | Extend `ReplyIntent` + the check constraint in `0008` | M |
| **"Not now" follow-up date** ("circle back in Q3") | Automatic nurture at the right time | AI extraction to a date, stored on the reply | M |
| **Conversation stalled** | You replied in-app and they went quiet for N days | From `reply_messages` + `replies` timestamps; no new capture needed | S |
| **Manual actions** (mark interested, meeting booked, not a fit, pause or resume a person, remove from sequence) | Human judgement should steer automation | New endpoints; recorded as events | S |
| **Decisions** (which rule matched, what was skipped and why) | Explainability and trust (G4) | Engine writes a `followup_decided` event when a decision changes something | S |
| **Meeting booked** | The true success signal | Later: Calendly / Cal.com webhook matched by invitee email | L |

**Not realistically trackable** (be upfront in the UI):
- Inbox vs spam placement per recipient.
- Spam complaints per recipient for Gmail/Workspace senders. Google Postmaster Tools gives domain-level aggregates only.
- Real opens for Apple Mail (MPP) users, and for Outlook clients that block images.
- Read time, scrolling, forwards.

---

## 4. Q3: Recipient situations (what it means)

A **situation** is an interpretation of the ledger, defined in code. A recipient can be in several situations at once (for example "opened several times" and "clicked a link"). Each one has a category, a confidence, and what it needs to be detectable.

### 4.1 Engagement, no reply yet (can have a template)

| Key | What they did | What it probably means | Confidence | Needs |
|---|---|---|---|---|
| `no_reply` | Contacted, no human reply | Default bucket. Today's behaviour | exact | – |
| `not_opened` | No open event of any kind, on any email so far | Didn't see it: buried, filtered, images blocked, or wrong subject | medium | open tracking |
| `opened_no_click` | ≥1 human open, no human click | Saw it, wasn't compelled | medium | open tracking |
| `opened_repeatedly` | Human opens ≥ N (default 3) | Considering it, or forwarded internally | medium | open tracking |
| `clicked` | ≥1 human click, no reply | Actively curious | good | click tracking |
| `clicked_link` | Clicked one of the selected links | Specific interest (pricing, case study) | good | click tracking |
| `clicked_meeting_link` | Clicked your meeting link, no reply | Nearly booked, then dropped | good | click tracking |
| `went_quiet` | Opened or clicked earlier, nothing on the last K emails (default 2) | Interest faded | medium | tracking |
| `open_unknown` | Only machine opens (MPP or proxy) | Can't tell; treated like `no_reply` | – | – |

### 4.2 After a reply (can have a template; the user must opt in)

| Key | What happened | Meaning / default |
|---|---|---|
| `replied_not_now` | Reply labelled `not_now` | Timing objection. Stop now; optionally re-engage on the date they gave, or after X days |
| `back_from_ooo` | OOO pause ended (`ooo_until` passed) | Resume the sequence, optionally with a "welcome back" email |
| `thread_stalled` | You replied in-app; no answer in X days | Nudge inside the conversation (approval queue by default) |
| `referred` | They named someone else | Applies to the **new** contact: "X suggested I reach out" |
| `sequence_finished` | All emails sent, no reply, N days passed | Optional re-engagement with a new angle, or stop |

### 4.3 Stop-only (safety rules; never templated, can't be overridden)

| Key | Action |
|---|---|
| `replied_interested`, `replied_question`, `meeting_request` | Stop. Notify the owner, push to CRM/Slack, optionally draft an AI reply for a human to send |
| `replied_other`, `wrong_person` | Stop. Review in the inbox; `wrong_person` can create a referral |
| `unsubscribe_request` (in words), `unsubscribed` (link or one-click) | Stop in **all** campaigns + unsubscribe list |
| `bounced_hard` | Stop + suppress + Bounce Shield check |
| `bounced_soft` | Wait and retry (limited), then stop with a reason |
| `left_company` (auto-reply) | Stop + suppress; offer the alternate contact as a lead |
| `colleague_replied` | Stop (campaign's company-stop setting) |
| `suppressed` | Never send |
| `send_failed` / `sender_problem` | Wait for the mailbox, retry with backoff, then stop with a reason |

Order of precedence, highest first: compliance (unsubscribed, suppressed) › delivery (bounced) › human reply (by intent) › auto-reply (OOO, left company) › engagement (specific link › clicked › opened repeatedly › opened › not opened) › `no_reply`.

---

## 5. Q4: Follow-up actions

**Action types the engine can take:**
- send email (same thread or new thread)
- wait / reschedule
- stop sequence (with reason)
- pause until a date
- unsubscribe
- suppress an email or domain
- notify the owner (email or Slack)
- push to CRM or webhook
- create a lead (referral)
- queue an AI draft for approval
- pause the campaign (Bounce Shield, sender auth)
- later: move to another campaign, or tag the recipient

| Situation | Suggested default | User options |
|---|---|---|
| `not_opened` | Re-send as a **new thread with a new subject**, shorter body | template, delay, same/new thread, how many tries |
| `opened_no_click` | Different angle or value proposition, soft interest CTA | template, delay |
| `opened_repeatedly` | "Happy to loop in whoever's relevant" / direct question | template, threshold N |
| `clicked` / `clicked_link` | Follow up on what they looked at, **sooner** (e.g. 1 day after the click) | template per link group, delay anchored to the click |
| `clicked_meeting_link` | Offer two specific times, or resend the link | template |
| `went_quiet` | Short break-up email | template, K |
| `no_reply` | The existing step list | as today |
| `replied_not_now` | Stop; nurture on their stated date or +90 days | template, days, auto-send or approval |
| `back_from_ooo` | Continue the sequence (optionally a "welcome back" email first) | template or none |
| `thread_stalled` | Nudge in the thread after 3 business days | template, **approval by default** |
| `referred` | First email to the new contact | template |
| `sequence_finished` | Stop (default) or re-engage after 60–90 days | template |
| stop-only rows | Fixed, as in §4.3 | notification and CRM settings only |

**Guardrails that apply to every rule:**
- A maximum number of follow-ups per person (default 5, hard cap 10).
- A minimum gap between two emails to the same person (default 2 business days; a click-anchored email never earlier than 4 hours).
- Schedule window and timezone, plan and warmup caps, sticky sender, and the pre-send guard all stay as they are.

---

## 6. Q5: Information we need to keep

| What | Fields | Where (proposed) |
|---|---|---|
| Each email sent | id (pre-generated), recipient, rule + email or step, sender, Message-ID, Gmail thread id, accepted response, variant, spintax seed, `thread_mode`, sent_at | `send_log` (+ new columns) |
| Each activity | type, occurred_at, **which email** (`send_log_id`), `is_machine` + reason, data (url, link key, intent, confidence, DSN code, OOO date, user-agent family, unsubscribe method), dedupe key | `recipient_events` (new, append-only) |
| Rollup for fast decisions | open/click counts (human only) + first/last times, machine-open count, clicked link keys, last activity time, latest intent, human reply count, `ooo_until`, per-rule progress, current rule, current situations, `decided_at` | new columns on `recipients` |
| Decisions | situations seen, rule and email chosen, outcome (send / wait / stop / skip), reason, engine version | `recipient_events(type=followup_decided)` |
| Rules | ordered rules, situations (multi-select), parameters, emails (delay, unit, anchor, thread mode, subject, body), source template | `follow_up_rules`, `follow_up_rule_emails` |
| Templates | name, subject, body (Markdown), suggested situations, source (written / uploaded / system copy), original filename | `email_templates` (user); system pack in code |

**Privacy and retention:**
- Tracking stays opt-in per campaign.
- Never store full IPs; classify at request time and keep at most the reason.
- Keep raw open/click events for 13 months, then prune them and keep the rollups.
- Include events in the account data export.
- Unsubscribes and suppressions are kept forever.

---

## 7. Q6: How it fits into the app

### 7.1 Layers

```
 CAPTURE ─────────► INTERPRET ───────────► DECIDE ─────────────────► ACT ───────────► EXPLAIN
 tick, pixel,        rollup (DB trigger)     1. safety rules (fixed)    existing tick     decision events
 click, unsub,       + situations.ts         2. campaign rules          send pipeline,    timeline drawer,
 check-replies,      registry (pure fns,     3. fallback = today's      stop/suppress/    per-rule stats,
 guard, reply-       tri-state aware)           step list               notify/CRM/       situation counts
 actions, manual                                (followup-engine.ts)    webhooks
       │
       └──► recordEvent() ──► recipient_events ──► (later) webhooks/integrations fan out from here
```

### 7.2 Rules model (recommended)

- **Rule** = *when* (multi-select situations, OR'd; optional parameters) → *send* (1..N emails, each with its own delay and template) → *then* (end sequence, or fall through to the next matching rule).
- Rules are checked **top to bottom; the first rule that matches and still has an unsent email wins** (like mail filters). New rules are auto-placed by strength (clicked above opened above not opened); the user can drag to reorder.
- The **fallback rule** ("Everyone else who hasn't replied") is the campaign's existing `follow_up_steps` list. The engine loads it as a virtual last rule, so existing campaigns and the public API are unchanged. Legacy step `condition`s keep working inside it.
- **Switching:** if someone moves from "Didn't open" to "Opened, didn't click", they start that rule's next unsent email. Each rule's emails go at most once per person, so the global cap and minimum gap stop bursts.

Alternative considered: a **matrix** (fixed cadence of N touches, each touch with a variant per situation). It's simpler to predict, but every situation gets the same number of touches and it doesn't express "clickers get a follow-up 1 day after the click". Mentioned in §10.

### 7.3 Decision algorithm (replaces `resolveDueStep` inside `pickFollowUp`, `tick/route.ts:555-612`)

```
decide(recipient, rollup, rules, campaign, now):
  # safety: fixed, first
  unsubscribed | suppressed               → STOP(reason)
  bounced (hard)                          → STOP(bounced)
  colleague replied & company-stop on     → STOP(domain_replied)
  human reply → enabled post-reply rule for its intent? use it : STOP(replied)
  ooo_until > now                         → WAIT(ooo_until)
  follow-ups sent ≥ campaign max          → STOP(completed)
  # interpret
  S = situations(rollup, campaign)        # tracking off → open/click situations never match
  # rules, then fallback
  for rule in enabled rules (ordered), fallback last:
    if rule.situations ∩ S is empty: continue
    e = rule's next unsent email
    if no e: if rule.then == end → STOP(completed) else continue
    due = max(anchor(e) + e.delay, last_email_at + min_gap)   # anchor: last email | the activity | the reply | OOO end
    return due > now ? WAIT(due, rule, e) : SEND(rule, e, because = rule.situations ∩ S)
  → STOP(completed: no matching rule)
```

- **The pre-send mailbox guard still runs before every SEND.** It remains the last line of defence against the 5-minute polling gap.
- **Re-evaluation on activity:** the pixel and click endpoints only insert an event (a DB trigger updates the rollup, so the hot path stays cheap). Each tick re-decides recipients whose `last_activity_at > decided_at` and pulls `next_follow_up_at` earlier when a click-anchored rule now applies.
- **Post-reply rules** (`replied_not_now`, `thread_stalled`) keep `status='replied'`, so reply stats stay truthful. They use their own schedule, and their guard window starts at the last inbound message. They ship in phase 3, after the core is proven.

### 7.4 Schema sketch (one migration, `0025_followup_master.sql`)

```sql
create table recipient_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  send_log_id  uuid references send_log(id) on delete set null,   -- which email
  type         text not null,            -- sent | accepted | send_failed | skipped | bounced | opened | clicked |
                                         -- unsubscribed | replied | auto_replied | intent_labeled | suppressed |
                                         -- paused | resumed | stopped | followup_decided | manual_*
  occurred_at  timestamptz not null default now(),
  is_machine   boolean not null default false,
  machine_reason text,
  data         jsonb not null default '{}'::jsonb,
  dedupe_key   text,
  unique (recipient_id, dedupe_key)
);
-- RLS: users can SELECT their own rows; only the service role writes (like webhook_deliveries).
-- Trigger AFTER INSERT → updates the recipients rollup atomically (safe with concurrent pixel hits).

alter table send_log add column message_id text, add column rule_id uuid, add column rule_email_id uuid,
                     add column thread_mode text, add column accepted_response text;

alter table recipients add column open_count int not null default 0, add column machine_open_count int not null default 0,
  add column first_opened_at timestamptz, add column last_opened_at timestamptz,
  add column click_count int not null default 0, add column last_clicked_at timestamptz,
  add column clicked_link_keys text[] not null default '{}', add column last_activity_at timestamptz,
  add column ooo_until timestamptz, add column rule_progress jsonb not null default '{}',
  add column current_rule_id uuid, add column situations text[] not null default '{}',
  add column decided_at timestamptz;

create table follow_up_rules (id uuid pk, user_id fk, campaign_id fk, position int, name text, enabled bool,
  situations text[] not null, params jsonb default '{}', then_action text default 'end', ...);
create table follow_up_rule_emails (id uuid pk, user_id fk, rule_id fk, position int,
  delay_value numeric, delay_unit text /* hours|days|business_days */, anchor text /* last_email|activity|reply|ooo_end */,
  thread_mode text /* same|new */, subject text, template text not null, source_template_id uuid, ...);
create table email_templates (id uuid pk, user_id fk, name text, subject text, body text not null,
  situations text[] default '{}', source text, original_filename text, ...);
-- all with own_rows RLS on auth.uid(); rules saved through one RPC (atomic, remaps progress by stable ids like 0023)
```

**Backfill:** build `recipient_events` from `send_log`, `tracking_events` (`is_machine` computed from the stored user-agent), `replies`, `unsubscribes` and `suppressions`, then compute the rollups. `tracking_events` stays in place while stats move over.

### 7.5 Code map

| Area | Change |
|---|---|
| `src/lib/activity.ts` (new) | `recordEvent()` + dedupe keys. One entry point for all capture sites |
| `src/lib/bot-detect.ts` (new) | MPP, prefetch, scanner and honeypot classification |
| `src/lib/situations.ts` (new) | Registry: `{ key, label, category, stopOnly, templatable, requires[], params schema, evaluate() }`. Pure and deterministic, so the UI preview and the engine agree |
| `src/lib/followup-engine.ts` (new) | `decide()` above. `follow-up-condition.ts` becomes the fallback rule's step evaluator |
| `src/app/api/tick/route.ts` | `pickFollowUp` calls the engine; pre-generated `send_log` id; per-email tokens; events at every outcome (including skips and defers, G4); re-evaluation pass |
| `t/o`, `t/c`, `unsubscribe` | Versioned per-email tokens, bot flags, click dedup, `stop_reason` + event (G9) |
| `check-replies`, `followup-guard`, `reply-actions`, `replies/[id]` | Events for reply, auto-reply, DSN, intent and manual actions; message time for `replied_at` (G5); don't overwrite `is_auto_reply` (G6); OOO date parsing (G7) |
| `api/campaigns/[id]/follow-up-rules` (new) | GET/PUT (atomic RPC), plan gate `conditional_sequences`, situation validation |
| `api/campaigns/[id]/situations` (new) | Live counts per situation and per rule ("32 people match now") |
| `api/campaigns/[id]/recipients/[rid]/timeline` (new) | Paginated ledger per recipient (fixes G10) |
| `api/templates` (new) | Library CRUD + upload parsing |
| `CampaignForm.tsx` | New "Smart follow-ups" section (below); atomic save for new campaigns (G13) |
| `campaigns/[id]/page.tsx`, `ActivityDrawer.tsx` | Situation breakdown, per-rule funnel, timeline with reasons ("sent *Opened, no click · email 1* because: opened 2×, no clicks") |
| `/app/templates` (new page) | Template library |
| Webhooks, public API | Later: `email.opened`, `email.clicked`, `recipient.situation_changed`; rules in `POST /v1/campaigns` |

### 7.6 Campaign UI: the "Smart follow-ups" section

This replaces the current follow-ups card (`CampaignForm.tsx:940-1115`) and uses the same components: the `sheet` card, `IntentChip`-style multi-select chips, `field-boxed`, `BodyEditor`, `tab-group`, `file-dropzone`, and the amber warning callouts.

```
┌ Follow-ups ────────────────────────────────────────────────────────────── [●on] ┐
│ Always on   ✓ Stop when they reply   ✓ Stop on bounce   ✓ Stop on unsubscribe   │
│             ☑ Stop the whole company when one person replies                    │
│             ✓ Pause on out-of-office, resume when they're back                  │
│ Limits      max [5] follow-ups per person · at least [2] business days apart     │
│                                                                                  │
│ Rules · checked top to bottom, first match wins                                  │
│ ┌ ⠿ 1  Clicked a link ─────────────────────────────── 32 people now · [●on] ┐ │
│ │ When they   (● Clicked any link) (● Clicked: pricing ▾) (○ Clicked meeting link) [+ more]│
│ │ Email 1     wait [1] [days ▾] after [they clicked ▾] · (•) same thread ( ) new: [subject] │
│ │             [ Write | Upload .docx .html .md .txt | From templates ▾ ]      │ │
│ │             ┌ BodyEditor ─────────────────────────────────────────────┐    │ │
│ │             └─────────────────────────────────────────────────────────┘    │ │
│ │             Preview · Send test                                             │ │
│ │ + Add email to this rule                Then (•) end  ( ) try next rule     │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ ⠿ 2  Opened, didn't click ── 210 people ┐   ┌ ⠿ 3  Didn't open ── 430 people ┐ │
│ ┌ 🔒  Everyone else who hasn't replied   (your step list, as today)            ┐ │
│ [+ Add rule]   [Use recommended playbook]                                        │
│ ⚠ "Didn't open" and "Opened…" need open tracking (off for this campaign). [Turn on] │
│   Opens are unreliable for Apple Mail users; they're treated as "can't tell".    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**The situation picker** is a popover of grouped chips:
- **Engagement:** Didn't open · Opened, didn't click · Opened 3+ times · Clicked any link · Clicked a specific link · Clicked meeting link · Engaged, then went quiet · Hasn't replied
- **After a reply:** Said "not now" · Back from out-of-office · You replied, they went quiet · Finished sequence, no reply
- **Handled automatically:** Replied, Bounced, Unsubscribed. Shown greyed with a lock, explaining what happens, so users see the whole map.

**Chip availability:**
- A chip needing tracking or reply detection shows an inline "turn on" link.
- A chip above the user's plan shows an upgrade note. The server still enforces the gate.

**Templates:** writing, uploading, or picking from the library all fill the same `BodyEditor`.
- Uploads: `.txt` and `.md` load directly; `.html` goes through Tiptap's HTML→Markdown (already used for paste). `.docx` needs `mammoth` (a new dependency).
- Merge tags are checked against the campaign's columns by the existing merge preflight.
- A library template is **copied** into the rule, so editing the library never changes a running campaign silently.

---

## 8. Template slots you'll need to write

One per templatable situation. Each can have 1..N emails, and each email a subject if it's sent as a new thread.

| # | Situation | Goal of the email | Thread | Typical timing |
|---|---|---|---|---|
| 1 | Didn't open | Get it seen: new subject, 2–3 lines, same core ask | new | +3 business days |
| 2 | Opened, didn't click | New angle or proof point, soft interest CTA | same | +3 business days |
| 3 | Opened 3+ times | "Should I loop in someone else?" / direct question | same | +2 business days |
| 4 | Clicked any link | Build on the interest, offer a short call | same | 1 day after the click |
| 5 | Clicked a specific link (per link group, e.g. pricing, case study) | Speak to that exact interest | same | 1 day after the click |
| 6 | Clicked meeting link, no reply | Offer 2 times, or resend the link | same | 1 day after the click |
| 7 | Engaged, then went quiet | Short break-up | same | +7 business days |
| 8 | Hasn't replied (fallback) | Your current step list | same | 3 → 4 → 7 business days |
| 9 | Said "not now" | "Circling back as promised" | new | their date or +90 days |
| 10 | Back from out-of-office | "Welcome back, resurfacing this" | same | on return |
| 11 | You replied, they went quiet | Conversational nudge | same | +3 business days (approval) |
| 12 | Referred you to someone | First email to the new contact, naming who referred | new | immediately (approval) |
| 13 | Finished sequence, no reply | Re-engagement with a new angle | new | +60–90 days |

Merge tags available: every sheet column, `{{x | fallback}}`, spintax, `{{ai:…}}`. Behaviour-aware tags such as the name of the clicked link are **off by default**: "I saw you clicked…" reads as creepy and hurts replies.

---

## 9. Phased plan

**Phase 1 status (2026-09-30): built; not yet run against the real database.** Migration `0025_activity_ledger.sql` must be applied **before** deploying the code. It was verified on a scratch Postgres 16: schema + 0002–0025 apply cleanly; the backfill is idempotent (a re-run adds nothing); rollups count human activity only; RLS lets owners read and nobody else, and users can't insert. `tsc` and `next build` pass.
- ✅ `recipient_events` log + rollup trigger + backfill (sends, opens/clicks with inferred email attribution and machine flags, replies, labels, unsubscribes, bounces, stop/skip reasons)
- ✅ Per-email tokens (`<recipient>~<send_log>`) for pixel, clicks and unsubscribe; old recipient-only tokens still work
- ✅ `send_log` rows use a pre-generated id and store `message_id`, provider id and SMTP response (G3, G11)
- ✅ Machine detection: Apple MPP, prefetch, scanners, too-fast clicks, link bursts, HEAD probes; click dedup (G2). Stats and scores count humans only
- ✅ Events at every tick outcome, including skipped/deferred steps with the reason (G4); unsubscribe sets `stop_reason` (G9); `replied_at` = message time (G5); stored reply rows are never rewritten by re-polls (G6); DSN detail kept (G12)
- ✅ The pre-send check honours stored auto-reply labels. **Bug fixed:** an AI/manual "ooo" relabel resumed the sequence, then the guard saw the same message as a human reply and stopped it again
- ✅ Paginated per-recipient timeline API + drawer (any row, full history, automated events hidden by default, next step / stop reason) (G10)
- ✅ New-campaign save reuses the draft on retry (G13)
- Behaviour changes to know: `email.bounced` now also fires for bounces confirmed by a reply label; `sequence.stopped` now also fires with `unsubscribed` / `suppressed`; open/click numbers drop as machine traffic is excluded

**Phase 2 status (2026-09-30): built; not yet run against the real database.** Migration `0026_follow_up_rules.sql` must be applied after 0025 and before deploying. It was verified on a scratch Postgres 16: it applies cleanly and is idempotent. The save RPC runs under RLS as the owner; another user gets `campaign_not_found`. Rule and email ids survive reordering. A failed save rolls back. A human click sets `reeval_pending` (machine clicks don't). 18 engine scenarios pass. `tsc` and `next build` pass.
- ✅ `src/lib/situations.ts`: registry + pure matching, shared by the engine and the editor. Engagement situations are live; after-reply ones are listed as "coming next"
- ✅ `src/lib/followup-engine.ts` `decide()`: per-person cap → rules top-to-bottom, first match with an unsent email wins → default steps. Delays run from our last email or from the activity. The min-gap floor applies, and activity-anchored emails are never sooner than 4h after our last email
- ✅ Tick: campaigns with rules (and `conditional_sequences`) use the engine; **campaigns without rules run the old path unchanged**. New-thread rule emails send with their own subject and no threading. Decisions are logged when the chosen rule changes
- ✅ Re-evaluation: a human open/click flags the person; tick pulls their next check earlier if a rule is now due sooner. A `completed` sequence reopens on new activity (within 60 days)
- ✅ UI: "Smart follow-ups" in the campaign form. Multi-select situations, parameters (opens threshold, specific links, quiet after N), 1–5 emails per rule (delay, anchor, same or new thread, subject), write or upload `.txt/.md/.html`, per-rule test send, reorder/enable, per-person cap + min gap, live "N people now" counts, "Use recommended rules" (bracketed placeholders block saving). The campaign page shows the rules and people reached / replied after
- ✅ Plan gate: saving rules needs Growth/Scale (402 otherwise); tick ignores rules if the plan drops
- ⏸ `.docx` upload and the template library (Phase 3), rules in the public API (Phase 4)

**Phase 3 status (2026-09-30): built; not yet run against the real database.** Migration `0027_followups_after_reply.sql` must be applied after 0026 and before deploying. It was verified on a scratch Postgres 16: it applies cleanly and is idempotent. The dedupe and kind checks work, the new intents and `send_log.kind = 'nurture'` are accepted, and RLS isolates users. Tests pass: 11 date-parsing cases, 23 engine scenarios, and `.docx`/HTML/Markdown import. `tsc` and `next build` pass. New dependencies: `mammoth` (.docx) and `chrono-node` (dates).
- ✅ Template library: `email_templates`, `/app/templates` (write, upload, tag with situations, edit, delete), `/api/templates` (+ `/parse` for .docx/.html/.md/.txt; a first-line "Subject:" becomes the subject). In the rule editor: upload, "From your templates…" (templates tagged for the rule's situations are starred), and "Save as template". Using a template copies it
- ✅ Real out-of-office return dates (chrono-node): resume the day after they're back (up to a year out), else the 7-day fallback. Used by the pre-send check, the poller and AI relabels (G7)
- ✅ After-reply rules (each a rule of its own):
  - "Replied *not now*" sends on the date they gave ("next quarter", "Q2", "in March"), else after the rule's delay. It's scheduled when the label is set, and cancelled on relabel or when they write again
  - "You replied, they went quiet" is a nudge scheduled when you answer from EmailsVia. When due it waits for approval ("Follow-ups after a reply" on the campaign page: Send now / Skip). It's cancelled if they write back or you answer again
  - "Finished the sequence, no reply" re-engages when the engine would end, doesn't count toward the cap, and uses the normal sequence path
  - "Was referred to you" supplies the first email for leads added from a reply (`recipients.referred_by_recipient_id`)
- ✅ After-reply sends go through tick as `kind = 'nurture'` with every normal gate. The pre-send check looks for mail newer than the scheduling point. Their sequence fields are never touched. Emails thread into the conversation (In-Reply-To their reply / your answer). A stuck `sending` row is retried after 2h. Pending ones keep the campaign open
- ✅ New reply labels: `wrong_person`, `left_company` (the second suppresses the address and stops other campaigns), in triage, the inbox, relabel, integrations, and the step-condition picker
- ⏸ System template pack (waiting for your templates), rules in the public API, meeting-booked integration (Phase 4)

**Phase 4 status (2026-09-30): built; not yet run against the real database.** Migration `0028_meetings_send_time.sql` must be applied after 0027 and before deploying. It was verified on a scratch Postgres 16: it applies cleanly and is idempotent, meeting tokens are unique, the `meeting_booked` event type is accepted, and the case-insensitive email match has no wildcard false positives. Tests pass: 12 new cases (send-time shifting, Calendly/Cal.com/generic parsing) and the earlier suites unchanged. `tsc` and `next build` pass.
- ✅ Webhooks: `email.opened` (once per email, humans only), `email.clicked` (humans only), `followup.needs_approval`, `meeting.booked`. `sequence.stopped` reasons are documented, including `meeting_booked`
- ✅ Meeting bookings: Settings → Meeting bookings gives a private URL (`/api/inbound/meetings/<token>`, replace/turn off). It accepts Cal.com `BOOKING_CREATED`/`RESCHEDULED`, Calendly `invitee.created` and generic `{email}`; cancellations are ignored. A booking stops follow-ups in every campaign (pending → skipped), cancels scheduled after-reply follow-ups, applies the company-level stop, is logged in the timeline, and counts as "N meetings booked" on the campaign
- ✅ Send-time optimisation (per campaign, needs tracking): moves each follow-up forward (never earlier, under a day) to the hour that person opens most (at least 2 opens in that hour). Business-day emails never land on a weekend. Click/open-triggered emails are exempt. Turning it on runs the plain step list through the engine too
- ✅ Public API: `rules` / limits / `send_time_optimization` on `POST /v1/campaigns`, `rules` in `GET /v1/campaigns/:id`, `GET`/`PUT /v1/campaigns/:id/rules` (`docs/API.md`)
- ✅ Hour-level click-anchored follow-ups (shipped in Phase 2)
- ✅ Space for the EmailsVia template set: `src/lib/template-pack.ts` has one slot per situation (§8), each with its goal and suggested timing. Empty slots show as "coming soon" in every campaign's rule editor ("From templates…" → EmailsVia templates) and on /app/templates. Filling a slot's `subject`/`body` publishes it, and "Use recommended rules" then uses the filled slots instead of placeholders
- ✅ Dependencies: nodemailer 6 → 10 (security advisories, incl. cross-tenant SMTP credential disclosure), imapflow 1.3 → 1.7 (no longer bundles nodemailer), mailparser 3.9.8 → 3.9.31. None of the breaking changes (SES removal, `NoAuth`→`ENOAUTH`, TLS checks on remote fetches, Node ≥ 20) touch this code. Smoke-tested compose → parse, send, pooled SMTP options, and one-click unsubscribe headers
- ⏸ Template copy: waiting for your templates

| Phase | Scope | User-visible |
|---|---|---|
| **1. Activity foundation** | `recipient_events` + rollup trigger + backfill; per-email tokens and Message-IDs; bot/MPP/scanner flags + click dedup; events at every tick outcome incl. skips/defers; fixes G5, G6, G9, G10, G11, G12, G13; paginated timeline drawer with reasons | Accurate per-person history; no change in who gets what |
| **2. Rules engine + campaign UI** | `situations.ts`, `followup-engine.ts`, rules tables + atomic RPC, re-evaluation on activity, Smart follow-ups section with multi-select and write/upload, live situation counts, decision log, per-rule funnel, plan gate, per-rule test send. Existing steps become the fallback rule | Activity-based follow-ups |
| **3. Post-reply + templates** | Template library page + your system pack; `.docx` upload; OOO date parsing + `back_from_ooo`; `not_now` nurture with date extraction; `thread_stalled` (approval queue); referral first email; new intents + `left_company` | Full situation map |
| **4. Extras** | Hour-level click-anchored follow-ups, send-time optimisation from open times, webhooks for opens/clicks/situation changes, rules in the public API, meeting-booked via Calendly/Cal.com | – |

Each phase keeps the invariant from `COLD_OUTREACH_PLAN.md` §9: **0 follow-ups after a reply, 0 sequences ending without a reason.**

---

## 10. Decisions needed

1. **Rules model.** Rules with their own emails and timing, plus a fallback rule (recommended, §7.2), or a fixed-cadence matrix with per-situation variants?
2. **Tracking stance.** Open pixels cost some deliverability and are unreliable (MPP). Recommendation: **click tracking on** when a click rule exists; **open tracking optional**, with the warning in the UI; open-based situations only when it's on.
3. **Post-reply automation.** Should `not_now` nurture send automatically (opt-in) or always go to an approval queue? Recommendation: auto with opt-in for nurture; approval for `thread_stalled` and referrals.
4. **Plan gating.** Recommendation: fallback step list on Starter+ (`follow_ups`, as today); activity rules on Growth+ (`conditional_sequences`, as today).
5. **Defaults.**
   - max 5 follow-ups per person
   - minimum 2 business days between emails (4h after a click)
   - "opened repeatedly" = 3 opens
   - "went quiet" = nothing on the last 2 emails
   - situations judged on **any email so far** (not only the last one)

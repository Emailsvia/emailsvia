# EmailsVia public API (v1)

Scale plan. Create a key in **Settings → API keys** and send it on every request:

```
Authorization: Bearer eav_live_…
```

All bodies are JSON. Errors look like `{"error": "code", "message": "…"}`.
Status codes: `400` invalid request · `401` missing/invalid key · `402` plan doesn't include it · `404` not found · `409` state conflict.

## Account

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me` | `{ plan: {id, name, daily_cap, sender_limit}, sent_today_utc }` |
| GET | `/api/v1/senders` | Connected inboxes. Use `id` as `sender_id` when creating campaigns. |

## Campaigns

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/campaigns?status=running` | Campaigns with `recipients`, `sent`, `failed` counts |
| POST | `/api/v1/campaigns` | Creates a **draft** |
| GET | `/api/v1/campaigns/:id` | Campaign, `follow_ups`, `rules`, `stats` (pending/sent/replied/bounced/…/reply_rate) |
| PATCH | `/api/v1/campaigns/:id` | `{"status":"running"}` to start (needs a sender and pending recipients), `{"status":"paused"}`, `name`, `daily_cap` |

`POST /api/v1/campaigns` body:

```json
{
  "name": "Q4 founders",
  "subject": "{Quick question|Idea} for {{Company | your team}}",
  "template": "Hi {{First Name | there}},\n\n…",
  "sender_id": "uuid",
  "timezone": "America/New_York",
  "daily_cap": 150,
  "gap_seconds": 120,
  "stop_on_domain_reply": true,
  "follow_ups": [
    { "delay_days": 3, "delay_unit": "business_days", "template": "Hi {{First Name | there}}, …" },
    { "delay_days": 4, "delay_unit": "business_days", "template": "…" }
  ]
}
```

Template syntax: `{{Column}}`, `{{Column | fallback}}`, spintax `{a|b|c}`, `{{ai: instruction}}` (Growth/Scale).

`POST /api/v1/campaigns` also accepts `rules`, `max_follow_ups`, `min_gap_days` and `send_time_optimization` (same shapes as below).

## Follow-up rules (Growth & Scale)

Send a different follow-up depending on what each person did. Rules are checked top to bottom; the first one whose
`situations` include one the person is in, and that still has an unsent email, sends next. `follow_ups` stay as the
default sequence for everyone no rule matches.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/campaigns/:id/rules` | `{ rules, max_follow_ups, min_gap_days, send_time_optimization }` |
| PUT | `/api/v1/campaigns/:id/rules` | Replaces all rules. Send back rule/email `id`s to keep each person's progress |

```json
{
  "max_follow_ups": 5,
  "min_gap_days": 2,
  "send_time_optimization": true,
  "rules": [
    {
      "name": "Clicked pricing",
      "situations": ["clicked_link"],
      "params": { "link_keys": ["acme.com/pricing"] },
      "then_action": "end",
      "emails": [
        { "delay_value": 1, "delay_unit": "days", "anchor": "activity", "thread_mode": "same", "template": "Hi {{First Name}}, …" }
      ]
    },
    {
      "name": "Didn't open",
      "situations": ["not_opened"],
      "emails": [
        { "delay_value": 3, "delay_unit": "business_days", "anchor": "last_email", "thread_mode": "new", "subject": "Quick one", "template": "…" }
      ]
    }
  ]
}
```

`situations` (one or more; the rule applies if the person is in any): `not_opened`, `opened_no_click`,
`opened_repeatedly` (`params.min_opens`, default 3), `clicked`, `clicked_link` (`params.link_keys`),
`clicked_meeting_link`, `went_quiet` (`params.quiet_after`, default 2), `back_from_ooo`, `no_reply`.
Each of these must be a rule on its own: `replied_not_now` (sent on the date they gave, else after the delay),
`thread_stalled` (after you answer in EmailsVia; waits for approval), `sequence_finished` (re-engage later),
`referred` (first email to a lead added from a reply).
Emails: `delay_value` + `delay_unit` (`hours` | `days` | `business_days`), `anchor` (`last_email` | `activity`),
`thread_mode` (`same` | `new`; `new` needs a `subject`). Opens/clicks only count with `tracking_enabled`, and
robots (Apple Mail privacy proxy, link scanners) never count.

## Recipients

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/campaigns/:id/recipients?status=replied&limit=100&offset=0` | Includes `status`, `stop_reason`, `next_follow_up_at` |
| POST | `/api/v1/campaigns/:id/recipients` | `{"rows":[{"email":"a@b.com","name":"Ann","company":"B","Role":"CTO"}]}`: up to 10,000 per call; extra fields become merge tags; addresses already in the campaign are skipped |

## Replies

`GET /api/v1/replies?since=2026-09-01T00:00:00Z&intent=interested&campaign_id=…&limit=100`

Auto-replies (out-of-office) are excluded unless `include_auto=1`. `intent` is one of
`interested | question | not_now | unsubscribe | wrong_person | left_company | ooo | bounce | other` (or null if not labelled yet).

## Do-not-contact list

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/suppressions?limit=500&offset=0` | |
| POST | `/api/v1/suppressions` | `{"emails":["ceo@customer.com"],"domains":["customer.com"]}`: nobody on the list is emailed by any campaign |

## Webhooks (Growth & Scale)

Configure in **Settings → Webhooks**. Each POST is signed:
`EmailsVia-Signature: sha256=HMAC_SHA256(raw_body, secret)`.

Envelope: `{"event", "event_id", "created_at", "delivered_at", "data"}`. `event_id` is stable, so dedupe on it.
Non-2xx responses are retried after 1m, 5m, 30m, 2h, 6h and 12h, then marked exhausted (visible under **Deliveries**, with a Redeliver button).

| Event | `data` |
|---|---|
| `email.sent` | campaign_id, recipient_id, email, step (0 = first email), kind, sender, message_id |
| `email.bounced` | campaign_id, recipient_id, email, detail |
| `sequence.stopped` | campaign_id, recipient_id, email, reason (`replied`, `domain_replied`, `bounced`, `unsubscribed`, `suppressed`, `meeting_booked`, `merge_failed`, `send_failed`, `guard_failed`, `completed`) |
| `email.opened` | campaign_id, recipient_id, email, step, opened_at. Once per email, human opens only |
| `email.clicked` | campaign_id, recipient_id, email, url, link_key, step, clicked_at. Human clicks only |
| `followup.needs_approval` | campaign_id, recipient_id, kind (`thread_stalled`), scheduled_id |
| `meeting.booked` | campaign_id, recipient_id, email, provider, start_time, event_name, booking_id |
| `reply.received` | reply_id, campaign_id, recipient_id, from_email, subject, snippet, received_at |
| `reply.classified` | reply_id, intent, confidence |
| `recipient.unsubscribed` | email, campaign_id |
| `campaign.paused` | campaign_id, name, reason (`bounce_rate`, `sender_auth`) |
| `campaign.finished` | campaign_id, name, finished_at |

`email.sent` has `kind` = `initial`, `retry`, `follow_up` or `nurture` (a follow-up to someone who replied).

### Meeting bookings (inbound)

**Settings → Meeting bookings** gives you a private URL. Point Cal.com ("Booking created") or a Calendly
`invitee.created` webhook at it, or POST `{"email": "jane@acme.com"}` from Zapier/Make. A booking stops that
person's follow-ups in every campaign (and their colleagues', where the campaign stops the whole company) and fires
`meeting.booked`.

### Zapier / Make

Use **Webhooks by Zapier → Catch Hook** (or Make **Custom webhook**), paste the URL into a new EmailsVia webhook,
select e.g. `reply.classified`, and filter on `data.intent = interested`. Built-in HubSpot, Pipedrive and Slack
pushes are under **Settings → Integrations**.

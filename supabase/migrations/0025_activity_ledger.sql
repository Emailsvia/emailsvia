-- 0025: activity ledger (Phase 1 of docs/MASTER_FOLLOW_UP_SYSTEM.md)
--
--  1. send_log: message_id (every email, not just the first), the provider's
--     id and the SMTP acceptance line. Rows are now written with an id picked
--     before sending, so tracking links can point at the exact email.
--  2. tracking_events: send_log_id (which email was opened/clicked) and
--     is_machine + machine_reason (Apple Mail Privacy Protection, prefetches,
--     link scanners). Machine events are kept but excluded from stats and
--     from follow-up decisions.
--  3. recipients: engagement rollup (human opens/clicks, first/last times,
--     clicked link keys, last activity, ooo_until), maintained by a trigger
--     on recipient_events so concurrent pixel hits can't drift the counts.
--  4. recipient_events: append-only per-recipient activity log. Written only
--     by the server (service role); users can read their own rows.
--  5. Backfill from send_log, tracking_events, replies, unsubscribes and
--     recipient state. Dedupe keys match the ones the app writes, so this is
--     safe to re-run and never double-counts.
--
-- Idempotent.

-- ============================================================
-- 1. send_log
-- ============================================================

alter table send_log
  add column if not exists message_id text,
  add column if not exists provider_message_id text,
  add column if not exists smtp_response text;

create index if not exists send_log_message_id_idx on send_log(message_id) where message_id is not null;
create index if not exists send_log_recipient_idx on send_log(recipient_id, sent_at desc);

-- ============================================================
-- 2. tracking_events
-- ============================================================

alter table tracking_events
  add column if not exists send_log_id uuid references send_log(id) on delete set null,
  add column if not exists is_machine boolean not null default false,
  add column if not exists machine_reason text;

create index if not exists tracking_events_recipient_kind_idx
  on tracking_events(recipient_id, kind, created_at desc);

-- ============================================================
-- 3. recipients rollup
-- ============================================================

alter table recipients
  add column if not exists open_count int not null default 0,
  add column if not exists machine_open_count int not null default 0,
  add column if not exists first_opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists click_count int not null default 0,
  add column if not exists machine_click_count int not null default 0,
  add column if not exists first_clicked_at timestamptz,
  add column if not exists last_clicked_at timestamptz,
  add column if not exists clicked_link_keys text[] not null default '{}',
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_activity_type text,
  add column if not exists ooo_until timestamptz;

-- ============================================================
-- 4. recipient_events
-- ============================================================

create table if not exists recipient_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  recipient_id   uuid not null references recipients(id) on delete cascade,
  -- Which email this is about (null when not tied to one email).
  send_log_id    uuid references send_log(id) on delete set null,
  -- 0 = first email, n = follow-up step n. Null when not tied to an email.
  step_number    int,
  type           text not null,
  occurred_at    timestamptz not null default now(),
  is_machine     boolean not null default false,
  machine_reason text,
  data           jsonb not null default '{}'::jsonb,
  -- Idempotency: the same fact recorded twice (poller re-read, retried
  -- request, re-run backfill) lands once. Null = always insert.
  dedupe_key     text,
  created_at     timestamptz not null default now(),
  unique (recipient_id, dedupe_key)
);

alter table recipient_events drop constraint if exists recipient_events_type_chk;
alter table recipient_events add constraint recipient_events_type_chk check (type in (
  'sent',              -- an email was accepted by Gmail / the SMTP server
  'send_failed',       -- a send attempt (or pre-send reply check) failed
  'skipped',           -- not sent: missing merge field, suppressed, invalid address, colleague replied…
  'bounced',           -- hard bounce (SMTP rejection or delivery-failure notice)
  'opened',
  'clicked',
  'replied',           -- human reply
  'auto_replied',      -- out-of-office / auto-responder
  'intent_labeled',    -- reply labelled by AI triage or by hand
  'unsubscribed',
  'sequence_paused',   -- e.g. out-of-office: follow-ups wait until data.until
  'sequence_resumed',
  'sequence_stopped',  -- data.reason = recipients.stop_reason
  'followup_decided',  -- the engine skipped / deferred / ended a step, with why
  'you_replied',       -- the user answered from inside EmailsVia
  'referral_added'     -- a person they referred was added as a lead
));

create index if not exists recipient_events_recipient_idx on recipient_events(recipient_id, occurred_at desc);
create index if not exists recipient_events_campaign_idx on recipient_events(campaign_id, type, occurred_at desc);
create index if not exists recipient_events_user_idx on recipient_events(user_id, occurred_at desc);

-- Read-only for users (same model as webhook_deliveries): the log is only
-- trustworthy if the server is the only writer.
alter table recipient_events enable row level security;
drop policy if exists own_rows on recipient_events;
drop policy if exists own_rows_read on recipient_events;
create policy own_rows_read on recipient_events for select
  using (user_id = auth.uid());

-- ============================================================
-- 5. Rollup trigger
-- ============================================================

create or replace function apply_recipient_event()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'opened' then
    if new.is_machine then
      update recipients set machine_open_count = machine_open_count + 1 where id = new.recipient_id;
    else
      update recipients set
        open_count = open_count + 1,
        first_opened_at = least(coalesce(first_opened_at, new.occurred_at), new.occurred_at),
        last_opened_at = greatest(coalesce(last_opened_at, new.occurred_at), new.occurred_at),
        last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                  then new.type else last_activity_type end,
        last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
      where id = new.recipient_id;
    end if;

  elsif new.type = 'clicked' then
    if new.is_machine then
      update recipients set machine_click_count = machine_click_count + 1 where id = new.recipient_id;
    else
      update recipients set
        click_count = click_count + 1,
        first_clicked_at = least(coalesce(first_clicked_at, new.occurred_at), new.occurred_at),
        last_clicked_at = greatest(coalesce(last_clicked_at, new.occurred_at), new.occurred_at),
        clicked_link_keys = case
          when coalesce(new.data->>'link_key', '') = ''
            or (new.data->>'link_key') = any(clicked_link_keys)
            or cardinality(clicked_link_keys) >= 50
          then clicked_link_keys
          else array_append(clicked_link_keys, new.data->>'link_key')
        end,
        last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                  then new.type else last_activity_type end,
        last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
      where id = new.recipient_id;
    end if;

  elsif new.type in ('replied', 'auto_replied', 'unsubscribed', 'bounced') then
    update recipients set
      last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                then new.type else last_activity_type end,
      last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.recipient_id;

  elsif new.type = 'sequence_paused'
    and new.data->>'reason' = 'out_of_office'
    and coalesce(new.data->>'until', '') <> '' then
    update recipients set
      ooo_until = greatest(coalesce(ooo_until, (new.data->>'until')::timestamptz), (new.data->>'until')::timestamptz)
    where id = new.recipient_id;
  end if;
  return null;
end;
$$;

drop trigger if exists recipient_events_apply on recipient_events;
create trigger recipient_events_apply
after insert on recipient_events
for each row execute function apply_recipient_event();

-- ============================================================
-- 6. Backfill
-- ============================================================

-- Same heuristics as src/lib/bot-detect.ts (minus the IP check: historic
-- rows have no IP). Only used here; live traffic is classified in the app.
create or replace function emailsvia_machine_reason(ua text, secs_after_send double precision, kind text)
returns text
language sql
immutable
as $$
  select case
    when ua is null or btrim(ua) = '' then 'no_user_agent'
    when btrim(ua) = 'Mozilla/5.0' then 'apple_mpp'
    when ua ~* '(bot\y|crawler|spider|headless|scanner|barracuda|mimecast|proofpoint|safelinks|symantec|forcepoint|trend ?micro|sophos|bitdefender|fortinet|fortiguard|ironport|zscaler|python-|go-http-client|curl/|wget|okhttp|axios|node-fetch|java/|libwww|facebookexternalhit|slackbot|linkedinbot|twitterbot|whatsapp|skypeuripreview|discordbot|telegrambot|bingpreview)'
      then 'scanner'
    when secs_after_send is not null and secs_after_send >= 0
      and secs_after_send < (case when kind = 'click' then 30 else 20 end)
      then case when kind = 'click' then 'too_fast' else 'prefetch' end
    else null
  end
$$;

-- Same normalisation as linkKey() in src/lib/activity.ts.
create or replace function emailsvia_link_key(url text)
returns text
language sql
immutable
as $$
  select nullif(left(lower(regexp_replace(regexp_replace(
    regexp_replace(coalesce(url, ''), '^[a-z][a-z0-9+.-]*://(www\.)?', '', 'i'),
    '[?#].*$', ''), '/+$', '')), 200), '')
$$;

-- 6a. Historic opens/clicks: attribute to the latest successful email sent
--     before them and classify machine traffic. Only rows not yet in the log.
update tracking_events te
set send_log_id = x.send_log_id,
    is_machine = x.reason is not null,
    machine_reason = x.reason
from (
  select
    t.id,
    last_send.id as send_log_id,
    emailsvia_machine_reason(
      t.user_agent,
      extract(epoch from t.created_at - last_send.sent_at),
      t.kind
    ) as reason
  from tracking_events t
  left join lateral (
    select s.id, s.sent_at
    from send_log s
    where s.recipient_id = t.recipient_id
      and s.error_class is null
      and s.sent_at <= t.created_at
    order by s.sent_at desc
    limit 1
  ) last_send on true
  where not exists (
    select 1 from recipient_events e
    where e.recipient_id = t.recipient_id and e.dedupe_key = 'track:' || t.id
  )
) x
where te.id = x.id
  and te.send_log_id is null;

-- 6b. Every send attempt.
insert into recipient_events
  (user_id, campaign_id, recipient_id, send_log_id, step_number, type, occurred_at, data, dedupe_key)
select
  s.user_id, s.campaign_id, s.recipient_id, s.id,
  case when s.kind = 'follow_up' then coalesce(s.step_number, 1) else 0 end,
  case
    when s.error_class is null then 'sent'
    when s.error_class = 'missing_merge_field' then 'skipped'
    else 'send_failed'
  end,
  s.sent_at,
  jsonb_strip_nulls(jsonb_build_object(
    'kind', s.kind,
    'error_class', s.error_class,
    'reason', case when s.error_class = 'missing_merge_field' then 'missing_merge_field' end,
    'backfilled', true
  )),
  'send:' || s.id
from send_log s
on conflict (recipient_id, dedupe_key) do nothing;

-- 6c. Opens and clicks.
insert into recipient_events
  (user_id, campaign_id, recipient_id, send_log_id, step_number, type, occurred_at,
   is_machine, machine_reason, data, dedupe_key)
select
  t.user_id, t.campaign_id, t.recipient_id, t.send_log_id,
  case when s.id is null then null when s.kind = 'follow_up' then coalesce(s.step_number, 1) else 0 end,
  case when t.kind = 'open' then 'opened' else 'clicked' end,
  t.created_at,
  t.is_machine, t.machine_reason,
  jsonb_strip_nulls(jsonb_build_object(
    'url', t.url,
    'link_key', case when t.kind = 'click' then emailsvia_link_key(t.url) end,
    'user_agent', left(t.user_agent, 300),
    'attribution', case when t.send_log_id is not null then 'inferred' end,
    'backfilled', true
  )),
  'track:' || t.id
from tracking_events t
left join send_log s on s.id = t.send_log_id
on conflict (recipient_id, dedupe_key) do nothing;

-- 6d. Replies (human and automatic).
insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  r.user_id, r.campaign_id, r.recipient_id,
  case when r.is_auto_reply then 'auto_replied' else 'replied' end,
  coalesce(r.received_at, r.created_at),
  jsonb_strip_nulls(jsonb_build_object(
    'reply_id', r.id,
    'from_email', r.from_email,
    'subject', left(r.subject, 300),
    'snippet', left(r.snippet, 300),
    'backfilled', true
  )),
  'reply:' || r.id
from replies r
where r.recipient_id is not null and r.campaign_id is not null
on conflict (recipient_id, dedupe_key) do nothing;

insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  r.user_id, r.campaign_id, r.recipient_id, 'intent_labeled',
  coalesce(r.received_at, r.created_at),
  jsonb_strip_nulls(jsonb_build_object(
    'reply_id', r.id,
    'intent', r.intent,
    'confidence', r.intent_confidence,
    'source', coalesce(r.intent_source, 'ai'),
    'backfilled', true
  )),
  'intent:' || r.id || ':backfill'
from replies r
where r.recipient_id is not null and r.campaign_id is not null and r.intent is not null
on conflict (recipient_id, dedupe_key) do nothing;

-- 6e. Unsubscribes.
insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  rc.user_id, rc.campaign_id, rc.id, 'unsubscribed',
  coalesce(u.created_at, rc.last_sent_at, rc.created_at),
  jsonb_build_object('method', 'unknown', 'backfilled', true),
  'unsubscribed'
from recipients rc
left join unsubscribes u on u.user_id = rc.user_id and u.email = rc.email
where rc.status = 'unsubscribed'
on conflict (recipient_id, dedupe_key) do nothing;

-- 6f. Bounces.
insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  rc.user_id, rc.campaign_id, rc.id, 'bounced',
  coalesce(rc.last_sent_at, rc.sent_at, rc.created_at),
  jsonb_strip_nulls(jsonb_build_object('kind', 'hard', 'detail', left(rc.error, 300), 'backfilled', true)),
  'bounced'
from recipients rc
where rc.status = 'bounced'
on conflict (recipient_id, dedupe_key) do nothing;

-- 6g. Why sequences ended / rows were skipped.
insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  rc.user_id, rc.campaign_id, rc.id,
  case when rc.status = 'skipped' then 'skipped' else 'sequence_stopped' end,
  coalesce(rc.replied_at, rc.last_sent_at, rc.sent_at, rc.created_at),
  jsonb_build_object('reason', rc.stop_reason, 'backfilled', true),
  case when rc.status = 'skipped'
       then 'skipped:' || rc.stop_reason
       else 'stopped:' || rc.stop_reason || ':' || rc.follow_up_count end
from recipients rc
where rc.stop_reason is not null
on conflict (recipient_id, dedupe_key) do nothing;

insert into recipient_events
  (user_id, campaign_id, recipient_id, type, occurred_at, data, dedupe_key)
select
  rc.user_id, rc.campaign_id, rc.id, 'skipped', rc.created_at,
  jsonb_build_object('reason', 'invalid_address', 'detail', left(rc.error, 300), 'backfilled', true),
  'skipped:invalid_address'
from recipients rc
where rc.status = 'skipped' and rc.stop_reason is null and rc.error like 'invalid:%'
on conflict (recipient_id, dedupe_key) do nothing;

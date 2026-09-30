-- 0027: follow-ups after a reply + template library (Phase 3 of
-- docs/MASTER_FOLLOW_UP_SYSTEM.md)
--
--  1. scheduled_followups  one-off follow-ups that live outside the normal
--     sequence, because the person already replied:
--       not_now         they said "not now": re-engage on the date they gave
--                       (or after the rule's delay). Cancelled if they write again.
--       thread_stalled  you answered from EmailsVia and they went quiet: a
--                       nudge that waits for your approval before sending.
--     Sent by tick through the normal gates (window, caps, sticky sender,
--     do-not-contact, reply check) as send_log.kind = 'nurture'.
--  2. email_templates     the user's reusable templates (written or uploaded).
--  3. recipients.referred_by_recipient_id  a lead added from someone's reply,
--     so a "referred" rule can supply their first email.
--  4. replies.intent       + wrong_person, left_company.
--  5. send_log.kind        + nurture.
--
-- Idempotent. Requires 0026.

create table if not exists scheduled_followups (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  recipient_id   uuid not null references recipients(id) on delete cascade,
  rule_id        uuid references follow_up_rules(id) on delete cascade,
  rule_email_id  uuid references follow_up_rule_emails(id) on delete cascade,
  kind           text not null,
  -- The inbound reply (not_now) or our in-app answer (thread_stalled) this
  -- follow-up is measured from; anything newer from them cancels it.
  anchor_reply_id uuid references replies(id) on delete set null,
  anchor_at      timestamptz not null,
  due_at         timestamptz not null,
  -- Where the date came from: 'their_words' ("next quarter") or 'rule_delay'.
  due_source     text not null default 'rule_delay',
  requires_approval boolean not null default false,
  approved_at    timestamptz,
  status         text not null default 'scheduled',
  cancel_reason  text,
  send_log_id    uuid references send_log(id) on delete set null,
  sent_at        timestamptz,
  attempts       int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (recipient_id, rule_email_id, anchor_at)
);
alter table scheduled_followups drop constraint if exists scheduled_followups_chk;
alter table scheduled_followups add constraint scheduled_followups_chk check (
  kind in ('not_now', 'thread_stalled')
  and status in ('scheduled', 'needs_approval', 'sending', 'sent', 'cancelled', 'failed')
  and due_source in ('their_words', 'rule_delay')
);
create index if not exists scheduled_followups_due_idx
  on scheduled_followups(campaign_id, due_at) where status in ('scheduled', 'needs_approval');
create index if not exists scheduled_followups_recipient_idx on scheduled_followups(recipient_id, status);

alter table scheduled_followups enable row level security;
drop policy if exists own_rows on scheduled_followups;
create policy own_rows on scheduled_followups for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists scheduled_followups_set_updated_at on scheduled_followups;
create trigger scheduled_followups_set_updated_at
before update on scheduled_followups
for each row execute function set_updated_at();

create table if not exists email_templates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  subject           text,
  body              text not null,
  -- Situations this template is written for (suggested in the rule editor).
  situations        text[] not null default '{}',
  source            text not null default 'written',
  original_filename text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table email_templates drop constraint if exists email_templates_chk;
alter table email_templates add constraint email_templates_chk check (
  source in ('written', 'uploaded')
  and char_length(name) between 1 and 120
  and char_length(body) between 1 and 100000
);
create index if not exists email_templates_user_idx on email_templates(user_id, updated_at desc);

alter table email_templates enable row level security;
drop policy if exists own_rows on email_templates;
create policy own_rows on email_templates for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists email_templates_set_updated_at on email_templates;
create trigger email_templates_set_updated_at
before update on email_templates
for each row execute function set_updated_at();

alter table recipients
  add column if not exists referred_by_recipient_id uuid references recipients(id) on delete set null;

alter table replies drop constraint if exists replies_intent_check;
alter table replies add constraint replies_intent_check check (intent in (
  'interested', 'not_now', 'question', 'unsubscribe', 'ooo', 'bounce', 'other',
  'wrong_person', 'left_company'
));

alter table send_log drop constraint if exists send_log_kind_check;
alter table send_log add constraint send_log_kind_check
  check (kind in ('initial', 'follow_up', 'retry', 'nurture'));

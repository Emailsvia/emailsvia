-- 0022: reply workflow (Phase 3 of COLD_OUTREACH_PLAN.md)
--
--  1. replies: inbox state + threading + AI draft
--       message_id     inbound Message-ID, so an in-app answer threads under it
--       read_at        opened in the Replies inbox
--       handled_at     marked done (moves from Inbox to Done)
--       intent_source  'ai' | 'manual' (manual relabels win over triage)
--       ai_draft       last AI-suggested answer (editable before sending)
--  2. reply_messages: answers sent from inside EmailsVia, via the recipient's
--     pinned sender, in the same thread.
--  3. user_settings: meeting_link (inserted into drafts), notify_interested
--     (email the owner when a reply is labelled interested).
--
-- Idempotent.

alter table replies
  add column if not exists message_id text,
  add column if not exists read_at timestamptz,
  add column if not exists handled_at timestamptz,
  add column if not exists intent_source text,
  add column if not exists ai_draft text,
  add column if not exists ai_draft_at timestamptz,
  add column if not exists notified_at timestamptz;

alter table replies drop constraint if exists replies_intent_source_chk;
alter table replies add constraint replies_intent_source_chk
  check (intent_source is null or intent_source in ('ai', 'manual'));

create index if not exists replies_user_inbox_idx
  on replies(user_id, handled_at, received_at desc);

create table if not exists reply_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  reply_id     uuid not null references replies(id) on delete cascade,
  recipient_id uuid references recipients(id) on delete set null,
  campaign_id  uuid references campaigns(id) on delete set null,
  sender_id    uuid references senders(id) on delete set null,
  subject      text not null,
  body         text not null,
  message_id   text,
  sent_at      timestamptz not null default now()
);

create index if not exists reply_messages_reply_idx on reply_messages(reply_id, sent_at);

alter table reply_messages enable row level security;
drop policy if exists own_rows on reply_messages;
create policy own_rows on reply_messages for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table user_settings
  add column if not exists meeting_link text,
  add column if not exists notify_interested boolean not null default true;

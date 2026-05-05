-- AI reply triage (Phase 3.3).
--
-- Adds intent + intent_confidence to replies so the UI can filter inbound
-- responses by classification (interested / not_now / question / etc.).
-- Populated by check-replies via claude-haiku-4-5 for users on the
-- Growth and Scale tiers; leftnull for everyone else.
--
-- Idempotent.

alter table replies
  add column if not exists intent text
    check (intent in (
      'interested',
      'not_now',
      'question',
      'unsubscribe',
      'ooo',
      'bounce',
      'other'
    )),
  add column if not exists intent_confidence real
    check (intent_confidence is null or (intent_confidence >= 0 and intent_confidence <= 1));

create index if not exists replies_intent_idx
  on replies(user_id, intent)
  where intent is not null;

-- 0028: meeting bookings + send-time optimisation (Phase 4 of
-- docs/MASTER_FOLLOW_UP_SYSTEM.md)
--
--  1. user_settings.meetings_token  secret for the per-user inbound URL
--     /api/inbound/meetings/<token> that Calendly / Cal.com / Zapier call on
--     a new booking. A booking stops that person's follow-ups
--     (stop_reason 'meeting_booked'), cancels anything scheduled, and is
--     logged as a 'meeting_booked' activity event.
--  2. campaigns.send_time_optimization  send each follow-up at the hour the
--     person usually opens mail (when there are enough human opens to tell).
--
-- Idempotent. Requires 0027.

alter table user_settings
  add column if not exists meetings_token text;
create unique index if not exists user_settings_meetings_token_uidx
  on user_settings(meetings_token) where meetings_token is not null;

alter table campaigns
  add column if not exists send_time_optimization boolean not null default false;

alter table recipient_events drop constraint if exists recipient_events_type_chk;
alter table recipient_events add constraint recipient_events_type_chk check (type in (
  'sent', 'send_failed', 'skipped', 'bounced', 'opened', 'clicked', 'replied', 'auto_replied',
  'intent_labeled', 'unsubscribed', 'sequence_paused', 'sequence_resumed', 'sequence_stopped',
  'followup_decided', 'you_replied', 'referral_added',
  'meeting_booked'
));

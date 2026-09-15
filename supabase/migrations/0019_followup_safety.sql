-- 0019: follow-up safety (Phase 0 of COLD_OUTREACH_PLAN.md)
--
--  1. recipients.next_step_number   which follow_up_steps row is due next.
--     Previously tick always loaded follow_up_count+1, so a step skipped by
--     its condition was still sent. NULL = legacy row → follow_up_count+1.
--  2. recipients.gmail_thread_id    Gmail API thread of the first send, so
--     follow-ups stay in the same Gmail thread for the sender.
--  3. recipients.follow_up_attempts transient-failure retries for the
--     currently-due step (reset to 0 after each successful follow-up).
--  4. recipients.stop_reason        why a sequence ended early
--     (replied | bounced | unsubscribed | merge_failed | send_failed).
--  5. replies.is_auto_reply         out-of-office / vacation responders are
--     stored (the owner still sees them) but no longer stop the sequence.
--
-- Idempotent. Apply before deploying the matching tick/check-replies code.

alter table recipients
  add column if not exists next_step_number int,
  add column if not exists gmail_thread_id text,
  add column if not exists follow_up_attempts int not null default 0,
  add column if not exists stop_reason text;

alter table replies
  add column if not exists is_auto_reply boolean not null default false;

-- Tick's follow-up picker: status='sent' rows with a due next_follow_up_at.
create index if not exists recipients_followup_due_idx
  on recipients(campaign_id, next_follow_up_at)
  where status = 'sent' and next_follow_up_at is not null;

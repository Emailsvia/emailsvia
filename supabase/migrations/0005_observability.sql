-- Observability (Phase 1.6).
--
-- Adds an error_class column to send_log so the admin dashboard can group
-- failed sends by category (auth_revoked / smtp_timeout / rate_limit / etc).
-- Existing successful rows leave it null.
--
-- Idempotent.

alter table send_log
  add column if not exists error_class text;

create index if not exists send_log_error_class_idx on send_log(error_class) where error_class is not null;

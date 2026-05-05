-- Sender Gmail OAuth (Phase 1.3).
--
-- Adds OAuth-based authentication to senders. After this migration a sender
-- can be connected either via app password (legacy) or Google OAuth (preferred).
-- The reply-poll path uses the same column to choose IMAP vs Gmail API.
--
-- Idempotent — safe to re-run.

alter table senders
  add column if not exists auth_method text
    not null default 'oauth'
    check (auth_method in ('app_password', 'oauth')),
  -- App password is only required for the legacy auth_method='app_password'
  -- senders. New OAuth senders never set this column. Existing rows already
  -- have a non-null app_password so we relax the constraint instead of
  -- backfilling fake values.
  alter column app_password drop not null,
  add column if not exists oauth_refresh_token text,   -- AES-GCM ciphertext
  add column if not exists oauth_access_token  text,   -- AES-GCM ciphertext
  add column if not exists oauth_expires_at    timestamptz,
  -- Set when Google revokes / token-refresh hits invalid_grant. The cron
  -- paths pause campaigns owned by a revoked sender and surface this in the
  -- UI so the user can re-connect.
  add column if not exists oauth_status text
    not null default 'ok'
    check (oauth_status in ('ok', 'revoked', 'pending'));

-- Default for *new* rows is 'oauth' but existing app-password rows were
-- inserted before this migration — flip them back to app_password so they
-- continue to work.
update senders
   set auth_method = 'app_password'
 where app_password is not null
   and auth_method = 'oauth'
   and oauth_refresh_token is null;

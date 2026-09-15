-- Send-as alias per sender.
--
-- A sender authenticates as its mailbox (`email`, e.g. care@taskly.ca) but
-- may put a different address in From/Reply-To — a Google Workspace user
-- alias or alias domain (e.g. hello@tasklyanything.net).
--
-- The alias must be configured in Gmail → Settings → Accounts → "Send mail
-- as" first. If it isn't, Gmail silently rewrites From back to the primary
-- address — nothing breaks, the alias just doesn't show. We can't verify it
-- server-side without the gmail.settings.basic scope (not requested, to
-- avoid re-running Google OAuth verification).
--
-- Replies to the alias land in the same mailbox, so reply polling is
-- unchanged. Existing RLS policy `own_rows for all` covers the column.
--
-- Idempotent — safe to re-run.

alter table senders
  add column if not exists send_as_email text
    check (send_as_email is null or send_as_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

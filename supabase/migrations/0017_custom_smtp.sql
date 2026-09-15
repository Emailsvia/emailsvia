-- Custom-domain senders (non-Gmail SMTP/IMAP).
--
-- Until now every sender was a Gmail inbox: OAuth, or an app password against
-- the hard-coded smtp.gmail.com / imap.gmail.com. This adds a `provider`
-- column so a sender can instead point at any SMTP/IMAP server (e.g. Spaceship
-- Spacemail for a domain with no Google Workspace).
--
-- Custom senders reuse auth_method='app_password' + the encrypted
-- app_password column for the mailbox password — same crypto, same code path,
-- just different hosts.
--
-- Existing RLS policy `own_rows` on senders is `for all`, so it already covers
-- the new columns. No new table.
--
-- Idempotent — safe to re-run.

alter table senders
  add column if not exists provider text
    not null default 'gmail'
    check (provider in ('gmail', 'smtp')),
  add column if not exists smtp_host   text,
  add column if not exists smtp_port   int check (smtp_port between 1 and 65535),
  add column if not exists smtp_secure boolean,   -- true = implicit TLS (465), false = STARTTLS (587)
  add column if not exists imap_host   text,
  add column if not exists imap_port   int check (imap_port between 1 and 65535),
  add column if not exists imap_secure boolean;

-- A custom sender must carry full server config and a password; Gmail
-- senders ignore these columns entirely.
alter table senders drop constraint if exists senders_smtp_config_chk;
alter table senders add constraint senders_smtp_config_chk check (
  provider = 'gmail'
  or (
    auth_method = 'app_password'
    and app_password is not null
    and smtp_host is not null and smtp_port is not null and smtp_secure is not null
    and imap_host is not null and imap_port is not null and imap_secure is not null
  )
);

-- API keys (Phase 2 — Sheets add-on, public API).
--
-- One row per personal access token. We store ONLY the SHA-256 hash; the
-- raw `eav_live_...` token is shown to the user once at creation time
-- and never leaves the response. To revoke, delete the row.
--
-- prefix is the first 11 chars of the raw token (e.g. "eav_live_a1") —
-- shown in the UI alongside last_used_at so the user can identify the
-- right key to revoke without seeing the secret.
--
-- Idempotent.

create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  prefix        text not null,
  key_hash      text not null unique,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists api_keys_user_idx       on api_keys(user_id);
create index if not exists api_keys_last_used_idx  on api_keys(last_used_at) where last_used_at is not null;

alter table api_keys enable row level security;
drop policy if exists own_rows on api_keys;
create policy own_rows on api_keys for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

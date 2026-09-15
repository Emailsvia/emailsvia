-- 0024: CRM / chat integrations (Phase 4 of COLD_OUTREACH_PLAN.md)
--
--  integrations: one row per (user, provider). When a reply gets a label in
--  `push_intents` (default: interested), EmailsVia pushes it:
--    hubspot    upsert contact by email + note with the reply   (private app token)
--    pipedrive  upsert person by email + note (+ lead if interested) (API token)
--    slack      message to an incoming-webhook URL
--  The token / webhook URL is AES-256-GCM encrypted by the app
--  (src/lib/crypto.ts) before it reaches this table and is never returned
--  to the browser.
--
--  integration_syncs: one row per (integration, reply). Claimed before the
--  push so a reply reaches each integration at most once; failures are
--  retried with backoff by /api/cron/webhooks.
--
-- Idempotent.

create table if not exists integrations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  provider         text not null check (provider in ('hubspot', 'pipedrive', 'slack')),
  secret_encrypted text not null,
  config           jsonb not null default '{}'::jsonb,
  push_intents     text[] not null default array['interested']::text[],
  active           boolean not null default true,
  last_synced_at   timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  unique (user_id, provider)
);

alter table integrations enable row level security;
drop policy if exists own_rows on integrations;
create policy own_rows on integrations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists integration_syncs (
  integration_id  uuid not null references integrations(id) on delete cascade,
  reply_id        uuid not null references replies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'exhausted')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  primary key (integration_id, reply_id)
);

create index if not exists integration_syncs_retry_idx
  on integration_syncs(next_attempt_at) where status = 'failed';

alter table integration_syncs enable row level security;
drop policy if exists own_rows_read on integration_syncs;
create policy own_rows_read on integration_syncs for select
  using (user_id = auth.uid());

-- Paid mailbox verification (ZeroBounce / NeverBounce / MillionVerifier,
-- configured by the operator via env). Stored per recipient so the same
-- address is never paid for twice.
--   verification: valid | invalid | catch_all | unknown | risky
alter table recipients
  add column if not exists verification text,
  add column if not exists verified_at timestamptz;

-- webhook_deliveries: read-only for signed-in users. Rows are written only
-- by the server (service role). With the old "for all" policy a user could
-- insert a delivery pointing at another tenant's webhook_id.
drop policy if exists own_rows on webhook_deliveries;
drop policy if exists own_rows_read on webhook_deliveries;
create policy own_rows_read on webhook_deliveries for select
  using (user_id = auth.uid());

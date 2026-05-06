-- v2 features (post-MVP, pre-public-launch).
-- Bundles five orthogonal feature additions into one migration so the
-- launch run only needs ten paste-and-runs total.
--
--  1. recipients.sender_id            sticky sender per recipient
--  2. recipients.variant_id           which A/B variant they got
--  3. campaigns.variants              A/B variant array
--  4. follow_up_steps.condition       conditional-send gate
--  5. ai_personalizations             per-recipient cache for {{ai:...}} tags
--  6. webhooks + webhook_deliveries   outbound webhook surface
--
-- Idempotent.

-- ============================================================
-- 1. Sticky sender per recipient. Set on first send under inbox rotation;
--    follow-ups use the same sender so the recipient sees a coherent
--    from-line across the thread.
-- ============================================================

alter table recipients
  add column if not exists sender_id uuid references senders(id) on delete set null;

create index if not exists recipients_sender_idx on recipients(sender_id) where sender_id is not null;

-- ============================================================
-- 2. A/B test variants on campaigns. variants is null = legacy single-
--    variant mode (use campaigns.subject + campaigns.template directly).
--    When set, it's a JSON array of { id, weight, subject, template }.
--    recipients.variant_id records which one this row received.
-- ============================================================

alter table campaigns
  add column if not exists variants jsonb;
-- Optional auto-pick threshold: when total sent across variants >=
-- ab_winner_threshold AND one variant has materially better reply rate,
-- new sends use only the winner. Null disables auto-pick.
alter table campaigns
  add column if not exists ab_winner_threshold int;
alter table campaigns
  add column if not exists ab_winner_id text;

alter table recipients
  add column if not exists variant_id text;
create index if not exists recipients_variant_idx on recipients(campaign_id, variant_id) where variant_id is not null;

-- ============================================================
-- 3. Conditional follow-up steps. condition is a JSON object describing
--    when the step should fire. Currently supported shapes:
--      {"type": "always"}                      (default — always fire)
--      {"type": "no_reply"}                    (fire only if not yet replied)
--      {"type": "intent_in", "intents": [...]} (fire only if last reply intent matches)
--      {"type": "intent_not_in", "intents": [...]}
--    Tick evaluates the condition before scheduling next_follow_up_at.
-- ============================================================

alter table follow_up_steps
  add column if not exists condition jsonb;

-- ============================================================
-- 4. AI personalization cache. Generated text per (recipient, tag) so
--    a re-render or retry doesn't re-pay Haiku. Rough size cap of 4KB
--    is enforced by the application (column type allows more).
-- ============================================================

create table if not exists ai_personalizations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  tag          text not null,
  prompt_hash  text not null,
  output       text not null,
  cost_tokens  int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (recipient_id, tag, prompt_hash)
);

create index if not exists ai_personalizations_user_idx
  on ai_personalizations(user_id, created_at desc);

alter table ai_personalizations enable row level security;
drop policy if exists own_rows on ai_personalizations;
create policy own_rows on ai_personalizations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 5. Outbound webhooks. webhooks holds user-defined URLs + secret;
--    webhook_deliveries logs each fire-and-confirm attempt for audit
--    + idempotent retry.
-- ============================================================

create table if not exists webhooks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  url           text not null,
  secret        text not null,
  events        text[] not null default array['reply.received','reply.classified','recipient.unsubscribed','campaign.finished']::text[],
  active        boolean not null default true,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists webhooks_user_idx on webhooks(user_id) where active = true;

alter table webhooks enable row level security;
drop policy if exists own_rows on webhooks;
create policy own_rows on webhooks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  webhook_id   uuid not null references webhooks(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_type   text not null,
  event_id     text not null,
  payload      jsonb not null,
  status       text not null check (status in ('pending','succeeded','failed','exhausted')),
  attempts     int  not null default 0,
  http_status  int,
  response_excerpt text,
  next_attempt_at timestamptz,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  unique (webhook_id, event_id)
);

create index if not exists webhook_deliveries_pending_idx
  on webhook_deliveries(next_attempt_at)
  where status = 'pending';
create index if not exists webhook_deliveries_user_idx
  on webhook_deliveries(user_id, created_at desc);

alter table webhook_deliveries enable row level security;
drop policy if exists own_rows on webhook_deliveries;
create policy own_rows on webhook_deliveries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 6. plans.features additions for the new gates. Re-seed plans so the
--    new flags are visible to billing.ts. Only flips the feature flags;
--    doesn't touch caps / prices.
-- ============================================================

update plans set features = features || jsonb_build_object(
  'a_b_testing', case when id in ('growth','scale') then true else false end,
  'ai_personalization', case when id in ('growth','scale') then true else false end,
  'conditional_sequences', case when id in ('growth','scale') then true else false end,
  'webhooks', case when id in ('growth','scale') then true else false end,
  'sticky_sender', true
);

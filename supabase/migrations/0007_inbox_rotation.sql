-- Inbox rotation (Phase 3.2).
--
-- Lets a single campaign send through multiple senders, picking the
-- least-loaded one each tick. Required for Scale-tier users splitting a
-- 10K-recipient list across 10 connected Gmails — each stays under its
-- own ~400/day warmup ceiling.
--
-- When campaign_senders has zero rows for a campaign, tick falls back to
-- campaigns.sender_id (single-sender mode). When it has >=1 row, those
-- override the single-sender default.
--
-- Idempotent.

-- ============================================================
-- 1. campaign_senders — N:M between campaigns and senders, with weight
--    reserved for future weighted-random distribution (today the picker
--    just chooses the least-loaded eligible sender).
-- ============================================================

create table if not exists campaign_senders (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  sender_id   uuid not null references senders(id)   on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  weight      int  not null default 1 check (weight > 0),
  created_at  timestamptz not null default now(),
  primary key (campaign_id, sender_id)
);

create index if not exists campaign_senders_campaign_idx on campaign_senders(campaign_id);
create index if not exists campaign_senders_sender_idx   on campaign_senders(sender_id);
create index if not exists campaign_senders_user_idx     on campaign_senders(user_id);

alter table campaign_senders enable row level security;
drop policy if exists own_rows on campaign_senders;
create policy own_rows on campaign_senders for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 2. send_log.sender_id — required for "how many sends has sender X done
--    today" lookups in the rotation picker. Nullable so the column can
--    be added without rewriting existing rows; new inserts always set it.
-- ============================================================

alter table send_log
  add column if not exists sender_id uuid references senders(id) on delete set null;

create index if not exists send_log_sender_day_idx on send_log(sender_id, day) where sender_id is not null;

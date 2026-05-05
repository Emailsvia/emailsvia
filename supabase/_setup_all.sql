-- ==========================================================
-- EmailsVia: combined initial setup (schema + migrations 0002-0010)
-- Idempotent. Paste this whole file into Supabase SQL Editor and Run.
-- ==========================================================


-- ---------- schema.sql ----------

-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

create extension if not exists pgcrypto;

create table if not exists senders (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  email text not null unique,
  app_password text not null,
  from_name text,
  is_default boolean not null default false,
  warmup_enabled boolean not null default false,
  warmup_started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table senders
  add column if not exists warmup_enabled boolean not null default false,
  add column if not exists warmup_started_at timestamptz;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  template text not null,
  from_name text,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'done')),
  daily_cap int not null default 300,
  gap_seconds int not null default 120,
  window_start_hour int not null default 8,
  window_end_hour int not null default 18,
  timezone text not null default 'Asia/Kolkata',
  sender_id uuid references senders(id) on delete set null,
  schedule jsonb,
  follow_ups_enabled boolean not null default false,
  retry_enabled boolean not null default false,
  max_retries int not null default 2,
  attachment_path text,
  attachment_filename text,
  tracking_enabled boolean not null default true,
  unsubscribe_enabled boolean not null default false,
  start_at timestamptz,
  known_vars text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table campaigns
  add column if not exists sender_id uuid references senders(id) on delete set null,
  add column if not exists schedule jsonb,
  add column if not exists follow_ups_enabled boolean not null default false,
  add column if not exists retry_enabled boolean not null default false,
  add column if not exists max_retries int not null default 2,
  add column if not exists attachment_path text,
  add column if not exists attachment_filename text,
  add column if not exists attachment_paths text[] not null default array[]::text[],
  add column if not exists attachment_filenames text[] not null default array[]::text[],
  add column if not exists tracking_enabled boolean not null default false,
  add column if not exists unsubscribe_enabled boolean not null default true,
  add column if not exists start_at timestamptz,
  add column if not exists known_vars text[] not null default array[]::text[],
  add column if not exists archived_at timestamptz;

-- Migrate legacy single-attachment to the new arrays (idempotent).
update campaigns
set attachment_paths = array[attachment_path],
    attachment_filenames = array[coalesce(attachment_filename, 'attachment')]
where attachment_path is not null
  and coalesce(array_length(attachment_paths, 1), 0) = 0;

create index if not exists campaigns_archived_idx on campaigns(archived_at);

create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  company text not null,
  email text not null,
  vars jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'replied', 'unsubscribed', 'bounced')),
  sent_at timestamptz,
  last_sent_at timestamptz,
  follow_up_count int not null default 0,
  next_follow_up_at timestamptz,
  replied_at timestamptz,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  error text,
  row_index int not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

alter table recipients
  add column if not exists vars jsonb not null default '{}'::jsonb,
  add column if not exists last_sent_at timestamptz,
  add column if not exists follow_up_count int not null default 0,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists retry_count int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists message_id text,
  add column if not exists domain text generated always as (lower(split_part(email, '@', 2))) stored;

-- Older installs may have a stale status check constraint missing the new statuses.
alter table recipients drop constraint if exists recipients_status_check;
alter table recipients add constraint recipients_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped', 'replied', 'unsubscribed', 'bounced'));

create index if not exists recipients_campaign_status_idx on recipients(campaign_id, status);
create index if not exists recipients_row_idx on recipients(campaign_id, row_index);
create index if not exists recipients_next_retry_idx on recipients(next_retry_at) where next_retry_at is not null;
create index if not exists recipients_next_follow_up_idx on recipients(next_follow_up_at) where next_follow_up_at is not null;
create index if not exists recipients_domain_idx on recipients(campaign_id, domain);
create index if not exists campaigns_sender_idx on campaigns(sender_id);
create index if not exists campaigns_status_idx on campaigns(status);

create table if not exists follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_number int not null,
  delay_days numeric not null default 4,
  subject text,
  template text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, step_number)
);

create table if not exists send_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  kind text not null default 'initial' check (kind in ('initial', 'follow_up', 'retry')),
  step_number int,
  sent_at timestamptz not null default now(),
  day date not null default ((now() at time zone 'Asia/Kolkata')::date)
);

alter table send_log
  add column if not exists kind text not null default 'initial',
  add column if not exists step_number int;

create index if not exists send_log_day_idx on send_log(day);
create index if not exists send_log_sent_at_idx on send_log(sent_at desc);
create index if not exists send_log_campaign_kind_idx on send_log(campaign_id, kind);

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind text not null check (kind in ('open', 'click')),
  url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists tracking_events_recipient_idx on tracking_events(recipient_id);
create index if not exists tracking_events_campaign_idx on tracking_events(campaign_id, kind);

create table if not exists unsubscribes (
  email text primary key,
  campaign_id uuid references campaigns(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references recipients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  from_email text not null,
  subject text,
  snippet text,
  body_text text,
  body_html text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, received_at)
);

alter table replies
  add column if not exists body_text text,
  add column if not exists body_html text;

create index if not exists replies_recipient_idx on replies(recipient_id);
create index if not exists replies_received_at_idx on replies(received_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
before update on campaigns
for each row execute function set_updated_at();

-- storage bucket for attachments (idempotent)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- ----- Row-Level Security: default-deny for anon / authenticated roles.
-- The server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, so this
-- doesn't change app behavior. It's defense-in-depth against accidental
-- client-side Supabase use leaking data. Safe to re-run.
alter table senders            enable row level security;
alter table campaigns          enable row level security;
alter table recipients         enable row level security;
alter table follow_up_steps    enable row level security;
alter table send_log           enable row level security;
alter table tracking_events    enable row level security;
alter table unsubscribes       enable row level security;
alter table replies            enable row level security;

-- ---------- migrations/0002_multitenant.sql ----------

-- Multi-tenant migration for EmailsVia.
-- Adds user_id to every domain table and turns on real RLS so each user only
-- sees their own rows. Designed to run AFTER schema.sql on a fresh Supabase
-- project (no data to backfill).
--
-- If you ever run this against a database that already has rows, do it in
-- three passes per table: (1) add column nullable, (2) backfill with a real
-- auth.users id, (3) ALTER NOT NULL. This file does (1)+(3) in one shot
-- because the plan assumes greenfield.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. Add user_id to every tenant-scoped table.
-- ============================================================

alter table senders            add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table campaigns          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table recipients         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table follow_up_steps    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table send_log           add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table tracking_events    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table replies            add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table unsubscribes       add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Enforce NOT NULL once the column exists. Greenfield assumption: there is
-- nothing to backfill. If a row predates the migration this will throw —
-- that's the desired loud failure.
alter table senders            alter column user_id set not null;
alter table campaigns          alter column user_id set not null;
alter table recipients         alter column user_id set not null;
alter table follow_up_steps    alter column user_id set not null;
alter table send_log           alter column user_id set not null;
alter table tracking_events    alter column user_id set not null;
alter table replies            alter column user_id set not null;
-- unsubscribes is keyed by email (global PK) but still scoped per user so two
-- users unsubscribing the same address don't collide. Drop the legacy PK and
-- rebuild as a composite (user_id, email) so each user has their own list.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.unsubscribes'::regclass
      and contype = 'p'
      and conname = 'unsubscribes_pkey'
  ) then
    -- Only drop+rebuild if the existing PK is the legacy single-column one.
    if (
      select count(*) from pg_attribute a
      join pg_constraint c on c.conrelid = a.attrelid and a.attnum = any(c.conkey)
      where c.conname = 'unsubscribes_pkey' and a.attrelid = 'public.unsubscribes'::regclass
    ) = 1 then
      alter table unsubscribes drop constraint unsubscribes_pkey;
    end if;
  end if;
end$$;

alter table unsubscribes alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.unsubscribes'::regclass and contype = 'p'
  ) then
    alter table unsubscribes add primary key (user_id, email);
  end if;
end$$;

-- ============================================================
-- 2. Indexes on user_id (every RLS-filtered query benefits).
-- ============================================================

create index if not exists senders_user_idx         on senders(user_id);
create index if not exists campaigns_user_idx       on campaigns(user_id);
create index if not exists recipients_user_idx      on recipients(user_id);
create index if not exists follow_up_steps_user_idx on follow_up_steps(user_id);
create index if not exists send_log_user_idx        on send_log(user_id);
create index if not exists tracking_events_user_idx on tracking_events(user_id);
create index if not exists replies_user_idx         on replies(user_id);

-- ============================================================
-- 3. Drop the global-uniqueness on senders.email — two different users can
--    legitimately connect their own gmail. Replace with per-user uniqueness.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.senders'::regclass
      and contype = 'u'
      and conname = 'senders_email_key'
  ) then
    alter table senders drop constraint senders_email_key;
  end if;
end$$;

create unique index if not exists senders_user_email_uidx on senders(user_id, lower(email));

-- ============================================================
-- 4. RLS policies. RLS itself was already enabled in schema.sql; add the
--    per-table "own rows only" policies now.
--
--    The service-role key (used by /api/tick, /api/check-replies, tracking
--    pixels, unsubscribe handler) bypasses RLS entirely, so background jobs
--    keep working. Authenticated request handlers must use the user JWT
--    client (supabaseUser) for these policies to apply.
-- ============================================================

drop policy if exists own_rows on senders;
create policy own_rows on senders for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on campaigns;
create policy own_rows on campaigns for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on recipients;
create policy own_rows on recipients for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on follow_up_steps;
create policy own_rows on follow_up_steps for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on send_log;
create policy own_rows on send_log for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on tracking_events;
create policy own_rows on tracking_events for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on replies;
create policy own_rows on replies for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on unsubscribes;
create policy own_rows on unsubscribes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 5. Storage policies for the attachments bucket — users can only touch
--    objects under their own /<user_id>/... prefix.
-- ============================================================

drop policy if exists "attachments own folder read"   on storage.objects;
drop policy if exists "attachments own folder write"  on storage.objects;
drop policy if exists "attachments own folder update" on storage.objects;
drop policy if exists "attachments own folder delete" on storage.objects;

create policy "attachments own folder read" on storage.objects for select
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder write" on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder update" on storage.objects for update
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder delete" on storage.objects for delete
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- migrations/0003_sender_oauth.sql ----------

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

-- ---------- migrations/0004_billing.sql ----------

-- Stripe billing + per-user quotas (Phase 1.4).
--
-- Adds plans, subscriptions and usage_daily tables, plus a trigger that
-- gives every freshly-created auth.users row a 'free' subscription so the
-- rest of the app can assume `subscriptions.plan_id` is always set.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. plans — catalogue of billing tiers. Seeded with the four tiers from
--    the roadmap; price/feature changes happen here, not in app code.
-- ============================================================

create table if not exists plans (
  id text primary key,
  name text not null,
  daily_cap int not null,
  sender_limit int not null,
  monthly_price_cents int not null default 0,
  watermark boolean not null default false,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into plans (id, name, daily_cap, sender_limit, monthly_price_cents, watermark, features) values
  ('free',    'Free',    50,    1,  0,    true,  '{"follow_ups":false,"ai":false,"import_row_limit":100,"a_b_testing":false,"inbox_rotation":false,"email_verification":false,"public_api":false}'::jsonb),
  ('starter', 'Starter', 500,   1,  900,  false, '{"follow_ups":true, "ai":false,"import_row_limit":null,"a_b_testing":false,"inbox_rotation":false,"email_verification":false,"public_api":false,"warmup":true}'::jsonb),
  ('growth',  'Growth',  1500,  3,  1900, false, '{"follow_ups":true, "ai":true, "import_row_limit":null,"a_b_testing":true, "inbox_rotation":false,"email_verification":false,"public_api":false,"warmup":true}'::jsonb),
  ('scale',   'Scale',   5000,  10, 3900, false, '{"follow_ups":true, "ai":true, "import_row_limit":null,"a_b_testing":true, "inbox_rotation":true, "email_verification":true, "public_api":true, "warmup":true}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  daily_cap = excluded.daily_cap,
  sender_limit = excluded.sender_limit,
  monthly_price_cents = excluded.monthly_price_cents,
  watermark = excluded.watermark,
  features = excluded.features;

-- ============================================================
-- 2. subscriptions — one row per auth.users (PK is user_id). plan_id is
--    free for unpaid users. stripe_* fields are null until first checkout.
-- ============================================================

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null references plans(id) default 'free',
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  stripe_customer_id text unique,
  stripe_sub_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_idx on subscriptions(stripe_customer_id);
create index if not exists subscriptions_stripe_sub_idx on subscriptions(stripe_sub_id);

create or replace function set_subscriptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at
before update on subscriptions
for each row execute function set_subscriptions_updated_at();

alter table subscriptions enable row level security;
drop policy if exists own_row on subscriptions;
create policy own_row on subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 3. usage_daily — running tally of sends per user per day. The tick
--    handler upserts +1 after each successful send, and gates the next
--    send against plan.daily_cap.
-- ============================================================

create table if not exists usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sent int not null default 0,
  primary key (user_id, day)
);

create index if not exists usage_daily_day_idx on usage_daily(day);

alter table usage_daily enable row level security;
drop policy if exists own_rows on usage_daily;
create policy own_rows on usage_daily for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 4. Auto-create a free subscription for every new auth.users row so the
--    app can always assume `subscriptions.plan_id` exists. Runs in the
--    auth schema since that's where the source row lives.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, plan_id, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- migrations/0005_observability.sql ----------

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

-- ---------- migrations/0006_strict_merge.sql ----------

-- Hard-fail merge-field validation (Phase 3.1).
--
-- When strict_merge is true, the tick handler skips any recipient whose
-- template references a merge tag that resolves to an empty string,
-- instead of mailing "Hey , at !". The pre-flight UI surfaces missing
-- tags before the campaign goes live so the user can fix the sheet.
--
-- Default true: cold-email best practice is to fail loud, and existing
-- campaigns can opt out per-row. Idempotent.

alter table campaigns
  add column if not exists strict_merge boolean not null default true;

-- ---------- migrations/0007_inbox_rotation.sql ----------

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

-- ---------- migrations/0008_reply_intent.sql ----------

-- AI reply triage (Phase 3.3).
--
-- Adds intent + intent_confidence to replies so the UI can filter inbound
-- responses by classification (interested / not_now / question / etc.).
-- Populated by check-replies via claude-haiku-4-5 for users on the
-- Growth and Scale tiers; leftnull for everyone else.
--
-- Idempotent.

alter table replies
  add column if not exists intent text
    check (intent in (
      'interested',
      'not_now',
      'question',
      'unsubscribe',
      'ooo',
      'bounce',
      'other'
    )),
  add column if not exists intent_confidence real
    check (intent_confidence is null or (intent_confidence >= 0 and intent_confidence <= 1));

create index if not exists replies_intent_idx
  on replies(user_id, intent)
  where intent is not null;

-- ---------- migrations/0009_scale_infra.sql ----------

-- Scale infra (Phase 4).
--
-- Lease-based distributed lock for the tick handler. Postgres advisory locks
-- (`pg_try_advisory_lock`) hold the lock for the SESSION, but Supabase routes
-- traffic through pgbouncer in transaction mode — every query is a separate
-- session, so the advisory lock is released the moment the statement returns.
-- A regular table with a TTL works through pgbouncer and is just as cheap.
--
-- Idempotent.

create table if not exists tick_locks (
  key         text primary key,
  acquired_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists tick_locks_expires_at_idx on tick_locks(expires_at);

-- Try to acquire `lock_key` with a TTL. Returns true if we got it.
-- An expired holder is overwritten — survives a Vercel function that
-- crashes mid-tick without releasing.
create or replace function public.try_tick_lock(lock_key text, ttl_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  inserted text;
begin
  insert into tick_locks (key, acquired_at, expires_at)
  values (lock_key, now(), now() + (ttl_seconds || ' seconds')::interval)
  on conflict (key) do update
    set acquired_at = excluded.acquired_at,
        expires_at  = excluded.expires_at
    where tick_locks.expires_at < now()
  returning key into inserted;
  return inserted is not null;
end;
$$;

-- Voluntary release. Safe to call even if we never held the lock — the
-- caller still wraps acquire/work/release in try/finally.
create or replace function public.release_tick_lock(lock_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update tick_locks set expires_at = now() where key = lock_key;
end;
$$;

-- Strip read access from anon/authenticated; only service-role + the
-- functions above touch this table.
revoke all on table tick_locks from anon, authenticated;
alter table tick_locks enable row level security;

-- ---------- migrations/0010_api_keys.sql ----------

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

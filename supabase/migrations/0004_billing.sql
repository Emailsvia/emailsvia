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

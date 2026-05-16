-- Per-user tracking opt-ins.
--
-- Open/click pixel injection and 5-minute Gmail reply polling are off by
-- default. Users flip these on in /app/settings when they want them.
-- The reply poll is the heaviest knob — it hits each connected Gmail
-- inbox every 5 minutes, so leaving it off for the long tail of users
-- who don't care about reply tracking is a real resource saving.
--
-- Idempotent — safe to re-run.

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Default for new campaigns' `campaigns.tracking_enabled` column. The
  -- per-campaign toggle still wins at send time; this only seeds the
  -- form. Off by default so users opt in rather than opt out.
  tracking_enabled_default boolean not null default false,
  -- Gates /api/check-replies: senders whose owner has this off are
  -- skipped entirely (no Gmail API calls, no inbox scan, no AI triage).
  poll_replies boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists user_settings_self on user_settings;
create policy user_settings_self on user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function set_user_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_settings_set_updated_at on user_settings;
create trigger user_settings_set_updated_at
before update on user_settings
for each row execute function set_user_settings_updated_at();

-- Flip the default for new campaigns so even if the app forgets to seed
-- `tracking_enabled` from user_settings, the column lands as `false`.
-- Existing rows are untouched — users who already turned tracking on for
-- a running campaign keep their setting.
alter table campaigns alter column tracking_enabled set default false;

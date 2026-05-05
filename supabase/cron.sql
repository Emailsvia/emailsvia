-- Free-tier cron setup for EmailsVia.
-- Runs INSIDE Supabase (free) instead of Vercel Cron (requires Pro for 1-min schedules).
--
-- URL + secret live in `public.cron_config` so you can change them later without
-- rebuilding the cron jobs. To change the URL in future, just:
--     update public.cron_config set value = 'https://new-url' where key = 'app_url';
-- No unschedule/reschedule needed.
--
-- BEFORE RUNNING: edit the two values in Step 2 with your real URL + CRON_SECRET.
-- Idempotent — safe to re-run.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ============================================================
-- Step 1. Config table (readable only by postgres/superuser; cron runs as postgres)
-- ============================================================
create table if not exists public.cron_config (
  key   text primary key,
  value text not null
);

-- Hide from the API — anon/authenticated/service_role cannot read this.
-- postgres (cron job owner) still reads freely because it owns the table.
revoke all on public.cron_config from anon, authenticated, service_role;
alter table public.cron_config enable row level security;

-- ============================================================
-- Step 2. Set / update config values. Edit the two lines below.
-- ============================================================
insert into public.cron_config (key, value) values
  ('app_url',     'https://emailsvia.vercel.app'),
  ('cron_secret', 'CHANGE_ME_BEFORE_RUNNING_IN_SUPABASE')
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- Step 3. (Re)schedule the jobs. They read app_url + cron_secret from the
-- config table at every tick, so updating the config automatically applies.
-- ============================================================

-- Drop legacy Mailvia-era jobs if they still exist (cleanup from rebrand).
-- Safe no-op on a fresh Supabase project.
select cron.unschedule('mail-automation-tick')
  where exists (select 1 from cron.job where jobname = 'mail-automation-tick');
select cron.unschedule('mail-automation-check-replies')
  where exists (select 1 from cron.job where jobname = 'mail-automation-check-replies');

-- Drop existing EmailsVia jobs if present (idempotent re-run).
select cron.unschedule('emailsvia-tick')
  where exists (select 1 from cron.job where jobname = 'emailsvia-tick');
select cron.unschedule('emailsvia-check-replies')
  where exists (select 1 from cron.job where jobname = 'emailsvia-check-replies');
select cron.unschedule('emailsvia-refresh-tokens')
  where exists (select 1 from cron.job where jobname = 'emailsvia-refresh-tokens');

-- Tick every minute. `params := '{}'::jsonb` is required to work around a
-- pg_net overload bug where the internal _encode_url_with_params_array call
-- fails when params is omitted.
select cron.schedule(
  'emailsvia-tick',
  '* * * * *',
  $$
    select net.http_get(
      url := (select value from public.cron_config where key = 'app_url') || '/api/tick',
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select value from public.cron_config where key = 'cron_secret')
      ),
      timeout_milliseconds := 15000
    );
  $$
);

-- Reply check every 5 minutes
select cron.schedule(
  'emailsvia-check-replies',
  '*/5 * * * *',
  $$
    select net.http_get(
      url := (select value from public.cron_config where key = 'app_url') || '/api/check-replies',
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select value from public.cron_config where key = 'cron_secret')
      ),
      timeout_milliseconds := 50000
    );
  $$
);

-- Proactive OAuth refresh — hourly. Walks senders whose token expires
-- within the next 2h and rotates the access token before the tick lands
-- on it. Catches Google's invalid_grant in a low-stakes context (no
-- recipient on the line) and fires the "sender disconnected" email.
select cron.schedule(
  'emailsvia-refresh-tokens',
  '7 * * * *',
  $$
    select net.http_get(
      url := (select value from public.cron_config where key = 'app_url') || '/api/cron/refresh-tokens',
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select value from public.cron_config where key = 'cron_secret')
      ),
      timeout_milliseconds := 55000
    );
  $$
);

-- ============================================================
-- Helpful diagnostics
-- ============================================================
-- View scheduled jobs:
--   select jobname, schedule, active from cron.job;
-- View recent runs:
--   select d.status, d.start_time, d.return_message
--   from cron.job_run_details d
--   join cron.job j on j.jobid = d.jobid
--   where j.jobname = 'emailsvia-tick'
--   order by d.start_time desc limit 10;
-- View pg_net HTTP responses (should be 200, not 404/401/500):
--   select id, status_code, created, content::text
--   from net._http_response
--   where created > now() - interval '10 minutes'
--   order by created desc limit 10;
-- Change URL later:
--   update public.cron_config set value = 'https://new-url.vercel.app' where key = 'app_url';
-- Rotate the cron secret:
--   update public.cron_config set value = 'new-secret' where key = 'cron_secret';
-- Pause cron without deleting it:
--   update cron.job set active = false where jobname = 'emailsvia-tick';

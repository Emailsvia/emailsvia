-- 0020: sequences v2 (Phase 1 of COLD_OUTREACH_PLAN.md)
--
--  1. follow_up_steps.delay_unit        'days' (calendar) | 'business_days'
--     (skips Sat/Sun in the campaign timezone). Existing steps stay 'days'.
--  2. campaigns.stop_on_domain_reply    when anyone at a company replies,
--     stop the sequence for everyone else at that domain in the campaign
--     (free-mail domains like gmail.com are never grouped).
--  3. suppressions                      per-user do-not-contact list by email
--     OR domain. Fed by hard bounces and manual entries; checked by tick
--     before every send, across all campaigns. `unsubscribes` stays as-is
--     (its token flow + webhooks depend on it) and is checked alongside.
--  4. backfill_follow_ups(campaign)     schedules the first follow-up for
--     already-sent recipients when follow-ups are turned on (or steps are
--     first added) after the campaign started sending.
--
-- Idempotent.

alter table follow_up_steps
  add column if not exists delay_unit text not null default 'days';
alter table follow_up_steps drop constraint if exists follow_up_steps_delay_unit_chk;
alter table follow_up_steps add constraint follow_up_steps_delay_unit_chk
  check (delay_unit in ('days', 'business_days'));

alter table campaigns
  add column if not exists stop_on_domain_reply boolean not null default true;

create table if not exists suppressions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('email', 'domain')),
  value      text not null check (value = lower(value)),
  reason     text not null default 'manual'
             check (reason in ('bounced', 'manual', 'not_interested', 'import')),
  source_campaign_id uuid references campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, value)
);

alter table suppressions enable row level security;
drop policy if exists own_rows on suppressions;
create policy own_rows on suppressions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Recipient lookups by domain for company-level stop.
create index if not exists recipients_campaign_domain_idx
  on recipients(campaign_id, (lower(split_part(email, '@', 2))));

-- Schedules step 1 for sent recipients that never had a follow-up scheduled
-- (follow_up_count = 0, no next_step_number, no stop_reason). Due time is
-- sent_at + step 1 delay, but never in the past — overdue rows become due
-- now and tick paces them out one per gap. Runs as the caller (RLS applies).
create or replace function backfill_follow_ups(p_campaign_id uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  first_step follow_up_steps%rowtype;
  n integer;
begin
  select * into first_step
  from follow_up_steps
  where campaign_id = p_campaign_id
  order by step_number asc
  limit 1;
  if not found then
    return 0;
  end if;

  update recipients r
  set next_step_number = first_step.step_number,
      -- Calendar days even for business_days steps: close enough for a
      -- one-off backfill, and tick's schedule window still gates the send.
      next_follow_up_at = greatest(
        now(),
        coalesce(r.sent_at, now()) + first_step.delay_days * interval '1 day'
      )
  where r.campaign_id = p_campaign_id
    and r.status = 'sent'
    and r.next_follow_up_at is null
    and r.next_step_number is null
    and r.follow_up_count = 0
    and r.stop_reason is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Atomic replace of a campaign's follow-up steps. The API used to delete
-- then insert in two requests; a tick landing between them saw zero steps
-- and ended every due sequence. Runs as the caller (RLS applies), so a user
-- can only replace steps on their own campaigns.
create or replace function replace_follow_up_steps(p_campaign_id uuid, p_steps jsonb)
returns setof follow_up_steps
language plpgsql
security invoker
as $$
declare
  v_user uuid;
begin
  -- RLS on campaigns hides other users' rows, so this doubles as the
  -- ownership check.
  select user_id into v_user from campaigns where id = p_campaign_id;
  if v_user is null then
    raise exception 'campaign_not_found';
  end if;
  delete from follow_up_steps where campaign_id = p_campaign_id;
  return query
  with ins as (
  insert into follow_up_steps
    (campaign_id, user_id, step_number, delay_days, delay_unit, subject, template, condition)
  select
    p_campaign_id,
    v_user,
    (s->>'step_number')::int,
    (s->>'delay_days')::numeric,
    coalesce(s->>'delay_unit', 'days'),
    nullif(s->>'subject', ''),
    s->>'template',
    case when s->'condition' is null or jsonb_typeof(s->'condition') = 'null'
         then null else s->'condition' end
  from jsonb_array_elements(p_steps) as s
  returning *
  )
  select * from ins order by step_number;
end;
$$;

-- 0023: safer follow-up step edits (replaces two functions from 0020)
--
--  1. replace_follow_up_steps now remaps recipients. The editor renumbers
--     steps 1..n on every save, but recipients point at the step that's due
--     by number (recipients.next_step_number). Deleting step 2 of [1,2,3]
--     used to leave people waiting on "3", which no longer existed, so their
--     sequence silently ended; deleting step 1 made people skip a step.
--     Steps sent back with their existing `id` are matched old -> new; a
--     deleted step maps to the next surviving step; nothing left = sequence
--     complete. Payloads without ids (API clients) keep the old behaviour.
--  2. backfill_follow_ups only schedules recipients first contacted in the
--     last 30 days, so saving steps on an old campaign doesn't send a
--     "Re:" bump to people emailed months ago.
--
-- Idempotent.

create or replace function replace_follow_up_steps(p_campaign_id uuid, p_steps jsonb)
returns setof follow_up_steps
language plpgsql
security invoker
as $$
declare
  v_user uuid;
  v_has_ids boolean;
  v_old_ids uuid[];
begin
  -- RLS on campaigns hides other users' rows, so this doubles as the
  -- ownership check.
  select user_id into v_user from campaigns where id = p_campaign_id;
  if v_user is null then
    raise exception 'campaign_not_found';
  end if;

  select exists (
    select 1 from jsonb_array_elements(p_steps) s where coalesce(s->>'id', '') <> ''
  ) into v_has_ids;
  select coalesce(array_agg(id), '{}') into v_old_ids
  from follow_up_steps where campaign_id = p_campaign_id;

  if v_has_ids then
    with incoming as (
      select (s->>'step_number')::int as new_num, nullif(s->>'id', '') as id
      from jsonb_array_elements(p_steps) s
    ),
    step_map as (
      select
        o.step_number as old_num,
        coalesce(
          -- same step, possibly renumbered
          (select i.new_num from incoming i where i.id = o.id::text limit 1),
          -- step was deleted: the next surviving step after it
          (select min(i.new_num)
             from incoming i
             join follow_up_steps o2 on o2.id::text = i.id
            where o2.campaign_id = p_campaign_id and o2.step_number > o.step_number)
        ) as new_num
      from follow_up_steps o
      where o.campaign_id = p_campaign_id
    )
    update recipients r
    set next_step_number = m.new_num,
        next_follow_up_at = case when m.new_num is null then null else r.next_follow_up_at end,
        stop_reason = case when m.new_num is null then 'completed' else r.stop_reason end
    from step_map m
    where r.campaign_id = p_campaign_id
      and r.status = 'sent'
      and r.next_step_number = m.old_num
      and m.new_num is distinct from m.old_num;
  end if;

  delete from follow_up_steps where campaign_id = p_campaign_id;
  return query
  with ins as (
  insert into follow_up_steps
    (id, campaign_id, user_id, step_number, delay_days, delay_unit, subject, template, condition)
  select
    -- Keep a step's id across saves (only ids that belonged to this
    -- campaign's steps are reused), so repeated saves remap correctly.
    case when nullif(s->>'id', '') is not null and (s->>'id')::uuid = any(v_old_ids)
         then (s->>'id')::uuid else gen_random_uuid() end,
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
    and r.stop_reason is null
    and r.sent_at > now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

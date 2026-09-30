-- 0026: activity-based follow-up rules (Phase 2 of docs/MASTER_FOLLOW_UP_SYSTEM.md)
--
--  1. follow_up_rules        per campaign, ordered: "when the recipient is in
--     any of these situations (didn't open, clicked a link, …) send these
--     emails". First matching rule with an unsent email wins; the campaign's
--     follow_up_steps stay as the built-in last rule ("everyone else who
--     hasn't replied"), so campaigns without rules behave exactly as before.
--  2. follow_up_rule_emails  1..n emails per rule, each with its own delay,
--     anchor (after our last email / after the activity) and thread mode.
--  3. campaigns.max_follow_ups / min_gap_days  guardrails across all rules.
--  4. recipients: sent_rule_email_ids (each rule email goes once per person),
--     current_rule_id (last rule chosen, to log changes), reeval_pending (set
--     by the activity trigger on a human open/click so tick re-decides when
--     the next email is due without waiting for the old schedule).
--  5. send_log.rule_id / rule_email_id  per-rule analytics.
--  6. replace_follow_up_rules(campaign, rules, max, gap)  atomic save, keeps
--     rule/email ids across saves so per-person progress survives edits.
--
-- Idempotent. Requires 0025.

create table if not exists follow_up_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  position     int  not null,
  name         text not null default '',
  enabled      boolean not null default true,
  situations   text[] not null,
  params       jsonb not null default '{}'::jsonb,
  then_action  text not null default 'end',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table follow_up_rules drop constraint if exists follow_up_rules_situations_chk;
alter table follow_up_rules add constraint follow_up_rules_situations_chk
  check (cardinality(situations) between 1 and 20);
alter table follow_up_rules drop constraint if exists follow_up_rules_then_chk;
alter table follow_up_rules add constraint follow_up_rules_then_chk
  check (then_action in ('end', 'next_rule'));
create index if not exists follow_up_rules_campaign_idx on follow_up_rules(campaign_id, position);

create table if not exists follow_up_rule_emails (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  rule_id      uuid not null references follow_up_rules(id) on delete cascade,
  position     int  not null,
  delay_value  numeric not null,
  delay_unit   text not null default 'business_days',
  anchor       text not null default 'last_email',
  thread_mode  text not null default 'same',
  subject      text,
  template     text not null,
  created_at   timestamptz not null default now(),
  unique (rule_id, position)
);
alter table follow_up_rule_emails drop constraint if exists follow_up_rule_emails_chk;
alter table follow_up_rule_emails add constraint follow_up_rule_emails_chk check (
  delay_value > 0 and delay_value <= 90
  and delay_unit in ('hours', 'days', 'business_days')
  and anchor in ('last_email', 'activity')
  and thread_mode in ('same', 'new')
  and (thread_mode = 'same' or coalesce(btrim(subject), '') <> '')
);
create index if not exists follow_up_rule_emails_rule_idx on follow_up_rule_emails(rule_id, position);

alter table follow_up_rules enable row level security;
drop policy if exists own_rows on follow_up_rules;
create policy own_rows on follow_up_rules for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table follow_up_rule_emails enable row level security;
drop policy if exists own_rows on follow_up_rule_emails;
create policy own_rows on follow_up_rule_emails for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table campaigns
  add column if not exists max_follow_ups int not null default 5,
  add column if not exists min_gap_days numeric not null default 2;
alter table campaigns drop constraint if exists campaigns_follow_up_limits_chk;
alter table campaigns add constraint campaigns_follow_up_limits_chk
  check (max_follow_ups between 1 and 10 and min_gap_days >= 0 and min_gap_days <= 30);

alter table recipients
  add column if not exists sent_rule_email_ids uuid[] not null default '{}',
  add column if not exists current_rule_id uuid,
  add column if not exists reeval_pending boolean not null default false;
create index if not exists recipients_reeval_idx
  on recipients(campaign_id) where reeval_pending and status = 'sent';

alter table send_log
  add column if not exists rule_id uuid,
  add column if not exists rule_email_id uuid;
create index if not exists send_log_rule_idx on send_log(campaign_id, rule_id) where rule_id is not null;

-- ============================================================
-- Activity trigger: also flag the recipient for re-evaluation on a human
-- open or click (0025's function, plus reeval_pending).
-- ============================================================
create or replace function apply_recipient_event()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'opened' then
    if new.is_machine then
      update recipients set machine_open_count = machine_open_count + 1 where id = new.recipient_id;
    else
      update recipients set
        open_count = open_count + 1,
        first_opened_at = least(coalesce(first_opened_at, new.occurred_at), new.occurred_at),
        last_opened_at = greatest(coalesce(last_opened_at, new.occurred_at), new.occurred_at),
        last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                  then new.type else last_activity_type end,
        last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at),
        reeval_pending = true
      where id = new.recipient_id;
    end if;

  elsif new.type = 'clicked' then
    if new.is_machine then
      update recipients set machine_click_count = machine_click_count + 1 where id = new.recipient_id;
    else
      update recipients set
        click_count = click_count + 1,
        first_clicked_at = least(coalesce(first_clicked_at, new.occurred_at), new.occurred_at),
        last_clicked_at = greatest(coalesce(last_clicked_at, new.occurred_at), new.occurred_at),
        clicked_link_keys = case
          when coalesce(new.data->>'link_key', '') = ''
            or (new.data->>'link_key') = any(clicked_link_keys)
            or cardinality(clicked_link_keys) >= 50
          then clicked_link_keys
          else array_append(clicked_link_keys, new.data->>'link_key')
        end,
        last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                  then new.type else last_activity_type end,
        last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at),
        reeval_pending = true
      where id = new.recipient_id;
    end if;

  elsif new.type in ('replied', 'auto_replied', 'unsubscribed', 'bounced') then
    update recipients set
      last_activity_type = case when last_activity_at is null or last_activity_at <= new.occurred_at
                                then new.type else last_activity_type end,
      last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
    where id = new.recipient_id;

  elsif new.type = 'sequence_paused'
    and new.data->>'reason' = 'out_of_office'
    and coalesce(new.data->>'until', '') <> '' then
    update recipients set
      ooo_until = greatest(coalesce(ooo_until, (new.data->>'until')::timestamptz), (new.data->>'until')::timestamptz)
    where id = new.recipient_id;
  end if;
  return null;
end;
$$;

-- ============================================================
-- Atomic save. Runs as the caller (RLS applies): the campaign lookup is the
-- ownership check. Ids sent back that already belong to this campaign are
-- kept, so recipients' sent_rule_email_ids / current_rule_id stay valid.
-- Recipients still in a sequence are flagged for re-evaluation; sent
-- recipients with nothing scheduled (e.g. the campaign had no follow-ups)
-- are picked up too, if first contacted in the last 30 days.
-- ============================================================
create or replace function replace_follow_up_rules(
  p_campaign_id uuid,
  p_rules jsonb,
  p_max_follow_ups int,
  p_min_gap_days numeric
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_user uuid;
  v_old_rules uuid[];
  v_old_emails uuid[];
  r jsonb;
  e jsonb;
  v_rule_id uuid;
  v_rpos int := 0;
  v_epos int;
  n int := 0;
begin
  select user_id into v_user from campaigns where id = p_campaign_id;
  if v_user is null then
    raise exception 'campaign_not_found';
  end if;

  update campaigns
  set max_follow_ups = p_max_follow_ups, min_gap_days = p_min_gap_days
  where id = p_campaign_id;

  select coalesce(array_agg(id), '{}') into v_old_rules from follow_up_rules where campaign_id = p_campaign_id;
  select coalesce(array_agg(id), '{}') into v_old_emails from follow_up_rule_emails where campaign_id = p_campaign_id;
  delete from follow_up_rules where campaign_id = p_campaign_id;  -- cascades to emails

  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    v_rpos := v_rpos + 1;
    v_rule_id := case
      when nullif(r->>'id', '') is not null and (r->>'id')::uuid = any(v_old_rules) then (r->>'id')::uuid
      else gen_random_uuid() end;
    insert into follow_up_rules (id, user_id, campaign_id, position, name, enabled, situations, params, then_action)
    values (
      v_rule_id, v_user, p_campaign_id, v_rpos,
      coalesce(r->>'name', ''),
      coalesce((r->>'enabled')::boolean, true),
      array(select jsonb_array_elements_text(r->'situations')),
      coalesce(r->'params', '{}'::jsonb),
      coalesce(r->>'then_action', 'end')
    );
    v_epos := 0;
    for e in select * from jsonb_array_elements(coalesce(r->'emails', '[]'::jsonb)) loop
      v_epos := v_epos + 1;
      insert into follow_up_rule_emails
        (id, user_id, campaign_id, rule_id, position, delay_value, delay_unit, anchor, thread_mode, subject, template)
      values (
        case when nullif(e->>'id', '') is not null and (e->>'id')::uuid = any(v_old_emails)
             then (e->>'id')::uuid else gen_random_uuid() end,
        v_user, p_campaign_id, v_rule_id, v_epos,
        (e->>'delay_value')::numeric,
        coalesce(e->>'delay_unit', 'business_days'),
        coalesce(e->>'anchor', 'last_email'),
        coalesce(e->>'thread_mode', 'same'),
        nullif(btrim(coalesce(e->>'subject', '')), ''),
        e->>'template'
      );
    end loop;
  end loop;

  update recipients
  set reeval_pending = true
  where campaign_id = p_campaign_id
    and status = 'sent'
    and (
      next_follow_up_at is not null
      or (next_follow_up_at is null and stop_reason is null and sent_at > now() - interval '30 days')
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

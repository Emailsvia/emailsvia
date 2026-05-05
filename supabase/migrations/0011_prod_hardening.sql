-- Production hardening (Phase 4 follow-on).
--
--  1. processed_stripe_events — webhook idempotency. Stripe retries on
--     any non-2xx; without this, a network blip after our DB upsert but
--     before the 200 response would re-process the same event and could
--     clobber later state changes. We insert event.id with a uniqueness
--     constraint and bail early on duplicate.
--
--  2. recipients_message_id_idx — the reply-correlation path in
--     /api/check-replies looks up recipients by Message-ID (RFC 5322
--     header that Gmail copies into In-Reply-To / References on the
--     reply). Without an index this becomes a table scan inside a
--     range(0,99999) fetch every 5 minutes per sender.
--
-- Idempotent.

create table if not exists processed_stripe_events (
  event_id    text primary key,
  type        text not null,
  processed_at timestamptz not null default now()
);

-- Restrict to service-role; webhook handler is the only writer.
revoke all on table processed_stripe_events from anon, authenticated;
alter table processed_stripe_events enable row level security;

-- Index on the reply-correlation lookup column.
create index if not exists recipients_message_id_idx
  on recipients(message_id)
  where message_id is not null;

--  3. campaign_status_counts(user_id) — Postgres-side aggregation for the
--     campaigns list page. Was N+1 (3 head-count queries × N campaigns)
--     in the route handler; this collapses to one round trip with the
--     aggregation done where it belongs. SECURITY INVOKER so RLS
--     applies; the route calls it via supabaseUser() which carries the
--     user JWT.
create or replace function public.campaign_status_counts(p_user_id uuid)
returns table(campaign_id uuid, total int, sent int, failed int)
language sql security invoker
set search_path = public, pg_catalog
as $$
  select
    campaign_id,
    count(*)::int                                               as total,
    count(*) filter (where status in ('sent', 'replied'))::int  as sent,
    count(*) filter (where status in ('failed', 'bounced'))::int as failed
  from recipients
  where user_id = p_user_id
  group by campaign_id;
$$;

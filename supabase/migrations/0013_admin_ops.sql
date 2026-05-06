-- Admin operations migration.
--
-- 1. Adds `suspended_at` to subscriptions so an operator can lock a tenant
--    out of sending without canceling Stripe. Cron + send paths honor it.
-- 2. Adds `admin_audit` so every operator-side mutation (force plan change,
--    suspend, manual cron trigger) leaves a tamper-evident trail. Service
--    role only — never queried by user-facing code.
--
-- Idempotent.

alter table subscriptions
  add column if not exists suspended_at timestamptz;

create index if not exists subscriptions_suspended_idx
  on subscriptions(suspended_at)
  where suspended_at is not null;

create table if not exists admin_audit (
  id          bigserial primary key,
  actor_id    uuid not null references auth.users(id) on delete restrict,
  action      text not null,
  target_type text,
  target_id   text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_actor_idx on admin_audit(actor_id, created_at desc);
create index if not exists admin_audit_target_idx on admin_audit(target_type, target_id, created_at desc);

revoke all on table admin_audit from anon, authenticated;
alter table admin_audit enable row level security;
-- No policies — only the service role can read or write. RLS on without
-- policies = no rows visible.

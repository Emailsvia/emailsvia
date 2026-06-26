-- Make the `plans` catalogue readable by end users.
--
-- 0004_billing.sql created and seeded `plans` but — unlike `subscriptions`
-- and `usage_daily` in the same migration — never gave it an RLS read policy
-- or role grant. The app reads `plans` through the user-scoped (RLS) client
-- inside getPlanForUser(): it resolves subscriptions.plan_id, then looks the
-- tier up in `plans`. When that lookup is denied (default-deny RLS / missing
-- grant) it returns zero rows, so the code silently falls back to the Free
-- plan — a paying user on plan_id='growth' renders as "Free" everywhere.
--
-- Pricing tiers are public, non-sensitive data (the marketing pricing page
-- shows them too). Allow everyone to read; mutations stay service-role only
-- (RLS denies write to anon/authenticated, migrations bypass via service role).
--
-- Idempotent — safe to re-run.

alter table plans enable row level security;

drop policy if exists plans_public_read on plans;
create policy plans_public_read on plans
  for select
  using (true);

grant select on plans to anon, authenticated;

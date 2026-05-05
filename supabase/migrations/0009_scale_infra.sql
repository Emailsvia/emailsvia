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

-- Multi-tenant migration for EmailsVia.
-- Adds user_id to every domain table and turns on real RLS so each user only
-- sees their own rows. Designed to run AFTER schema.sql on a fresh Supabase
-- project (no data to backfill).
--
-- If you ever run this against a database that already has rows, do it in
-- three passes per table: (1) add column nullable, (2) backfill with a real
-- auth.users id, (3) ALTER NOT NULL. This file does (1)+(3) in one shot
-- because the plan assumes greenfield.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. Add user_id to every tenant-scoped table.
-- ============================================================

alter table senders            add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table campaigns          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table recipients         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table follow_up_steps    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table send_log           add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table tracking_events    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table replies            add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table unsubscribes       add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Enforce NOT NULL once the column exists. Greenfield assumption: there is
-- nothing to backfill. If a row predates the migration this will throw —
-- that's the desired loud failure.
alter table senders            alter column user_id set not null;
alter table campaigns          alter column user_id set not null;
alter table recipients         alter column user_id set not null;
alter table follow_up_steps    alter column user_id set not null;
alter table send_log           alter column user_id set not null;
alter table tracking_events    alter column user_id set not null;
alter table replies            alter column user_id set not null;
-- unsubscribes is keyed by email (global PK) but still scoped per user so two
-- users unsubscribing the same address don't collide. Drop the legacy PK and
-- rebuild as a composite (user_id, email) so each user has their own list.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.unsubscribes'::regclass
      and contype = 'p'
      and conname = 'unsubscribes_pkey'
  ) then
    -- Only drop+rebuild if the existing PK is the legacy single-column one.
    if (
      select count(*) from pg_attribute a
      join pg_constraint c on c.conrelid = a.attrelid and a.attnum = any(c.conkey)
      where c.conname = 'unsubscribes_pkey' and a.attrelid = 'public.unsubscribes'::regclass
    ) = 1 then
      alter table unsubscribes drop constraint unsubscribes_pkey;
    end if;
  end if;
end$$;

alter table unsubscribes alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.unsubscribes'::regclass and contype = 'p'
  ) then
    alter table unsubscribes add primary key (user_id, email);
  end if;
end$$;

-- ============================================================
-- 2. Indexes on user_id (every RLS-filtered query benefits).
-- ============================================================

create index if not exists senders_user_idx         on senders(user_id);
create index if not exists campaigns_user_idx       on campaigns(user_id);
create index if not exists recipients_user_idx      on recipients(user_id);
create index if not exists follow_up_steps_user_idx on follow_up_steps(user_id);
create index if not exists send_log_user_idx        on send_log(user_id);
create index if not exists tracking_events_user_idx on tracking_events(user_id);
create index if not exists replies_user_idx         on replies(user_id);

-- ============================================================
-- 3. Drop the global-uniqueness on senders.email — two different users can
--    legitimately connect their own gmail. Replace with per-user uniqueness.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.senders'::regclass
      and contype = 'u'
      and conname = 'senders_email_key'
  ) then
    alter table senders drop constraint senders_email_key;
  end if;
end$$;

create unique index if not exists senders_user_email_uidx on senders(user_id, lower(email));

-- ============================================================
-- 4. RLS policies. RLS itself was already enabled in schema.sql; add the
--    per-table "own rows only" policies now.
--
--    The service-role key (used by /api/tick, /api/check-replies, tracking
--    pixels, unsubscribe handler) bypasses RLS entirely, so background jobs
--    keep working. Authenticated request handlers must use the user JWT
--    client (supabaseUser) for these policies to apply.
-- ============================================================

drop policy if exists own_rows on senders;
create policy own_rows on senders for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on campaigns;
create policy own_rows on campaigns for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on recipients;
create policy own_rows on recipients for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on follow_up_steps;
create policy own_rows on follow_up_steps for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on send_log;
create policy own_rows on send_log for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on tracking_events;
create policy own_rows on tracking_events for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on replies;
create policy own_rows on replies for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists own_rows on unsubscribes;
create policy own_rows on unsubscribes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 5. Storage policies for the attachments bucket — users can only touch
--    objects under their own /<user_id>/... prefix.
-- ============================================================

drop policy if exists "attachments own folder read"   on storage.objects;
drop policy if exists "attachments own folder write"  on storage.objects;
drop policy if exists "attachments own folder update" on storage.objects;
drop policy if exists "attachments own folder delete" on storage.objects;

create policy "attachments own folder read" on storage.objects for select
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder write" on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder update" on storage.objects for update
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments own folder delete" on storage.objects for delete
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

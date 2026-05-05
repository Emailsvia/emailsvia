-- Hard-fail merge-field validation (Phase 3.1).
--
-- When strict_merge is true, the tick handler skips any recipient whose
-- template references a merge tag that resolves to an empty string,
-- instead of mailing "Hey , at !". The pre-flight UI surfaces missing
-- tags before the campaign goes live so the user can fix the sheet.
--
-- Default true: cold-email best practice is to fail loud, and existing
-- campaigns can opt out per-row. Idempotent.

alter table campaigns
  add column if not exists strict_merge boolean not null default true;

-- Kill the free-tier "Sent with EmailsVia" watermark.
--
-- Originally added in 0004_billing.sql as a free→paid conversion lever.
-- Removed because it cheapens outbound from a real cold-email rep —
-- prospects shouldn't see ad copy on a 1:1 message. App code no longer
-- reads `plans.watermark`; this migration just flips the row value off
-- on already-deployed databases so the next code-vs-DB audit is clean.
--
-- Idempotent. We keep the column itself (no DROP) — removing it would
-- be a destructive change that breaks rollbacks. The column is now dead
-- weight: nothing reads it, defaulting to false on insert.

update plans set watermark = false where watermark = true;
alter table plans alter column watermark set default false;

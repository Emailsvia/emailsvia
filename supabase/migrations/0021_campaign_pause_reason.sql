-- 0021: why a campaign was paused automatically.
--   'bounce_rate'  Bounce Shield: too many of the contacted recipients bounced
--   'sender_auth'  a receiver rejected the sender domain's SPF/DKIM/DMARC
-- NULL for manual pauses. Cleared by the API when the campaign is resumed.
alter table campaigns
  add column if not exists paused_reason text;

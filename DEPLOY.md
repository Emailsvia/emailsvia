# EmailsVia — Production deployment checklist

The codebase ships ready-to-deploy. This is the operational checklist for first-time prod launch.

## 1. Apply migration 0011

The new prod-hardening migration (Stripe webhook idempotency + recipients.message_id index + campaign_status_counts RPC) needs to be applied to the live Supabase project. Open the SQL Editor and paste:

```
supabase/migrations/0011_prod_hardening.sql
```

Verify: `select count(*) from processed_stripe_events;` returns 0; `select count(*) from pg_indexes where indexname = 'recipients_message_id_idx';` returns 1.

## 2. Vercel project setup

1. Connect the GitHub repo to Vercel. Framework auto-detects as Next.js.
2. **Environment variables** — paste from `.env.local`, plus add the production-only ones:
   - `APP_URL=https://emailsvia.com` (or wherever you deploy)
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (from prod Supabase)
   - `ENCRYPTION_SECRET` + `CRON_SECRET` (32+ chars, generated fresh — DO NOT reuse dev values)
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
   - `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*`
   - `ANTHROPIC_API_KEY` (for reply triage)
   - `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM_EMAIL` + `POSTMARK_FROM_NAME` (for transactional)
   - `NEXT_PUBLIC_SENTRY_DSN` (optional but recommended)
   - `ADMIN_USER_IDS` (comma-separated auth.users.id values that can access /app/admin)
3. `vercel.json` already declares the cron schedule — Vercel Cron picks them up automatically on first deploy.
4. **Disable Supabase pg_cron** (or leave both running — the lock prevents duplicate sends, just wastes function invocations). The `supabase/cron.sql` setup is now redundant once Vercel Cron is live. To disable: `select cron.unschedule('emailsvia-tick'); select cron.unschedule('emailsvia-check-replies'); select cron.unschedule('emailsvia-refresh-tokens');`.

## 3. Supabase → URL configuration

In Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://emailsvia.com`
- **Redirect URLs**: add `https://emailsvia.com/auth/callback` and `https://emailsvia.com/app/**`

## 4. Google Cloud OAuth → production redirect URIs

In Google Cloud Console → OAuth client → Authorized redirect URIs, ADD (don't replace):
- `https://emailsvia.com/api/auth/google/callback` (sender Gmail OAuth)
- `https://qxtbnxseqbbdavrwtboa.supabase.co/auth/v1/callback` (already there from setup)

JavaScript origins: also add `https://emailsvia.com`.

## 5. Stripe → live mode

- Switch test mode → live mode in the Stripe Dashboard.
- Re-create the three products (Starter $9, Growth $19, Scale $39) in live mode — they're separate from test mode.
- Copy the live `price_…` IDs into Vercel env (`STRIPE_PRICE_*`).
- Webhook endpoint: `https://emailsvia.com/api/stripe/webhook`. Subscribe to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- Settings → Tax → enable Stripe Tax (live mode).

## 6. Postmark → verify domain

- Create a server in Postmark, copy `POSTMARK_SERVER_TOKEN` into Vercel env.
- Verify your sending domain (`emailsvia.com`) in Postmark + add the SPF/DKIM records they show. Without verified DNS, transactional emails (sender-revoked / payment-failed) get rejected.
- Set the message stream to `outbound` (default) or create a dedicated transactional stream.

## 7. Google OAuth verification (4-8 week wait, start NOW)

The sender-Gmail OAuth flow uses sensitive scopes (`gmail.send` + `gmail.readonly`). In Testing mode only listed test users can authorize. For public launch:
- Google Cloud Console → OAuth consent screen → Publish app → submit verification.
- Verification needs the privacy + terms URLs (already live at `/privacy` + `/terms`), a 2-min demo video, and a Limited-Use justification doc.
- Submit the **Sheets add-on scopes** (`spreadsheets.currentonly`, `script.external_request`) in the same submission — saves a round.

## 8. Smoke test post-deploy

Hit `https://emailsvia.com/api/health` — should return `{"ok": true, "db": "ok", "latency_ms": <100}`.

End-to-end:
1. Visit landing → click Get Started → sign up with Google → land in `/app`.
2. Connect a sender → `/app/senders` → Connect Gmail → consent → see "Connected" toast.
3. Create a 5-row test campaign → start it → verify first send within 60s (Vercel Cron tick).
4. Reply to your own campaign from another inbox → verify it appears in `/app/replies` within 5 min.
5. Hit `/app/billing` → verify your plan shows + the Stripe upgrade button redirects to a Stripe-hosted checkout (don't actually pay).
6. Hit `/app/admin` (if your auth.users.id is in `ADMIN_USER_IDS`) — verify MRR + signup metrics render.

## 9. Operational monitoring

- Sentry → confirm errors are flowing (trigger a deliberate one if curious).
- Vercel → Cron tab → confirm `/api/tick` runs every minute and `/api/check-replies` every 5 min.
- Supabase → Logs → watch for any RLS denials in `postgrest` logs (would indicate a missed `user_id` insert).

## 10. Day-one limits to be aware of

- Vercel Hobby plan: 12 cron jobs max + 100 GB bandwidth/mo + 1k function exec hrs/mo. Plenty for first 100 users; bump to Pro before 1000.
- Supabase Free: 500MB DB, 2GB bandwidth, paused if idle for 7 days. Bump to Pro ($25/mo) before launch.
- Stripe live mode: ramp `STRIPE_PRICE_*` IDs into env, test one $9 transaction yourself end-to-end before announcing.

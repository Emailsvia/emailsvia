import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// System health: cron lease state, last tick, recent tick error rate, free-
// space proxy (recent send_log volume), pending webhook deliveries, recent
// audit-log activity. Designed to fit one screen.
export async function GET() {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const [{ data: locks }, { data: lastSend }, { data: pendingDeliveries }, { data: audit }] =
    await Promise.all([
      db.from("tick_locks").select("key, acquired_at, expires_at"),
      db
        .from("send_log")
        .select("sent_at")
        .order("sent_at", { ascending: false })
        .limit(1),
      db
        .from("webhook_deliveries")
        .select("id", { count: "exact", head: false })
        .eq("status", "pending")
        .limit(1),
      db
        .from("admin_audit")
        .select("id, action, target_type, target_id, actor_id, payload, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const since1h = new Date(Date.now() - 3600_000).toISOString();
  const [okRes, errRes] = await Promise.all([
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", since1h).is("error_class", null),
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", since1h).not("error_class", "is", null),
  ]);

  const env = {
    has_anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    has_postmark: Boolean(process.env.POSTMARK_SERVER_TOKEN),
    has_stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    has_sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    has_cron_secret: Boolean(process.env.CRON_SECRET),
    has_oauth: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
    has_encryption: Boolean(process.env.ENCRYPTION_SECRET),
    app_url: process.env.APP_URL ?? null,
  };

  return NextResponse.json({
    locks: locks ?? [],
    last_send_at: lastSend?.[0]?.sent_at ?? null,
    sends_1h: okRes.count ?? 0,
    errors_1h: errRes.count ?? 0,
    pending_deliveries: pendingDeliveries?.length ?? 0,
    env,
    audit: audit ?? [],
  });
}

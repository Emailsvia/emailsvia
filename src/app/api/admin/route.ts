import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin metrics endpoint backing /admin. Returns aggregate operator-side
// numbers (MRR, daily sends, error rate, signups, free→paid conversion) so
// the dashboard can render without a per-card round-trip.
//
// Uses supabaseAdmin (service role) intentionally — the gate is purely
// "is the caller in ADMIN_USER_IDS?". RLS doesn't help when the whole point
// is to read across tenants.
export async function GET() {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ---- MRR + paying-user count from active subscriptions joined to plans.
  const { data: paidSubs } = await db
    .from("subscriptions")
    .select("plan_id, status, plans(monthly_price_cents)")
    .in("status", ["active", "trialing", "past_due"])
    .neq("plan_id", "free");
  const mrrCents =
    paidSubs?.reduce((sum, s) => {
      const plan = (s as unknown as { plans: { monthly_price_cents: number } | null }).plans;
      return sum + (plan?.monthly_price_cents ?? 0);
    }, 0) ?? 0;

  // ---- Plan distribution
  const { data: planRows } = await db
    .from("subscriptions")
    .select("plan_id")
    .in("status", ["active", "trialing", "past_due"]);
  const planCounts: Record<string, number> = {};
  for (const r of planRows ?? []) {
    planCounts[r.plan_id] = (planCounts[r.plan_id] ?? 0) + 1;
  }

  // ---- Sends + error rate (last 24h, last 7d) from send_log
  const [sendOk24h, sendErr24h, sendOk7d, sendErr7d] = await Promise.all([
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", last24h).is("error_class", null),
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", last24h).not("error_class", "is", null),
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", last7d).is("error_class", null),
    db.from("send_log").select("*", { count: "exact", head: true }).gte("sent_at", last7d).not("error_class", "is", null),
  ]);
  const sends24h = sendOk24h.count ?? 0;
  const errs24h = sendErr24h.count ?? 0;
  const sends7d = sendOk7d.count ?? 0;
  const errs7d = sendErr7d.count ?? 0;

  // ---- Top error classes (last 24h)
  const { data: errBuckets } = await db
    .from("send_log")
    .select("error_class")
    .gte("sent_at", last24h)
    .not("error_class", "is", null)
    .range(0, 9999);
  const errorByClass: Record<string, number> = {};
  for (const r of errBuckets ?? []) {
    const k = r.error_class ?? "unknown";
    errorByClass[k] = (errorByClass[k] ?? 0) + 1;
  }

  // ---- Recent signups + free→paid conversion
  const { count: signups7d } = await db
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", last7d);
  const { count: signups30d } = await db
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", last30d);
  const { count: paidSignups30d } = await db
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", last30d)
    .neq("plan_id", "free")
    .in("status", ["active", "trialing", "past_due"]);

  // ---- Most recent 10 signups (for the "newcomers" list in the UI)
  const { data: recentRows } = await db
    .from("subscriptions")
    .select("user_id, plan_id, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    mrr_cents: mrrCents,
    paying_users: paidSubs?.length ?? 0,
    plan_counts: planCounts,
    sends_24h: sends24h,
    errors_24h: errs24h,
    error_rate_24h: sends24h + errs24h > 0 ? errs24h / (sends24h + errs24h) : 0,
    sends_7d: sends7d,
    errors_7d: errs7d,
    error_rate_7d: sends7d + errs7d > 0 ? errs7d / (sends7d + errs7d) : 0,
    error_by_class_24h: errorByClass,
    signups_7d: signups7d ?? 0,
    signups_30d: signups30d ?? 0,
    paid_signups_30d: paidSignups30d ?? 0,
    free_to_paid_30d:
      (signups30d ?? 0) > 0 ? (paidSignups30d ?? 0) / (signups30d ?? 0) : 0,
    recent_signups: recentRows ?? [],
  });
}

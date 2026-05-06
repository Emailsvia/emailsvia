import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Billing-side dashboard data:
// - MRR snapshot (active+trialing+past_due paid plans)
// - 90-day MRR trend (using subscription change-times as a proxy)
// - Recent processed Stripe events (idempotency log)
// - Churn-prone subs (cancel_at_period_end, past_due)
export async function GET() {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();

  // Active subs joined to plan price for MRR.
  const { data: paidSubs } = await db
    .from("subscriptions")
    .select("user_id, plan_id, status, current_period_end, cancel_at_period_end, suspended_at, plans(monthly_price_cents)")
    .in("status", ["active", "trialing", "past_due"])
    .neq("plan_id", "free");
  const mrrCents =
    paidSubs?.reduce((sum, s) => {
      const plan = (s as unknown as { plans: { monthly_price_cents: number } | null }).plans;
      return sum + (plan?.monthly_price_cents ?? 0);
    }, 0) ?? 0;

  // 90-day MRR trend: take all subs ever, walk day-by-day. For each day,
  // count subs whose created_at <= day AND (current_period_end is null OR
  // > day). Approximation — a real "MRR over time" needs a snapshot table,
  // but this is good enough for the operator view at our stage.
  const { data: allSubs } = await db
    .from("subscriptions")
    .select("plan_id, status, created_at, current_period_end, cancel_at_period_end, plans(monthly_price_cents)")
    .neq("plan_id", "free");
  const days = 90;
  const trend: Array<{ day: string; mrr_cents: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    let total = 0;
    for (const s of allSubs ?? []) {
      const created = new Date(s.created_at);
      if (created > d) continue;
      const end = s.current_period_end ? new Date(s.current_period_end) : null;
      if (end && end <= d) continue;
      if (!["active", "trialing", "past_due"].includes(s.status)) continue;
      const price = (s as unknown as { plans: { monthly_price_cents: number } | null }).plans
        ?.monthly_price_cents ?? 0;
      total += price;
    }
    trend.push({ day: key, mrr_cents: total });
  }

  // Recent Stripe events (from idempotency log).
  const { data: events } = await db
    .from("processed_stripe_events")
    .select("event_id, type, processed_at")
    .order("processed_at", { ascending: false })
    .limit(50);

  // Churn signals.
  const churning = (paidSubs ?? []).filter(
    (s) => s.cancel_at_period_end || s.status === "past_due" || s.suspended_at,
  );

  // Owner emails for churn list.
  const { data: usersData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailByUser = new Map<string, string>();
  for (const au of usersData?.users ?? []) {
    if (au.email) emailByUser.set(au.id, au.email);
  }
  const churnList = churning.map((s) => ({
    user_id: s.user_id,
    plan_id: s.plan_id,
    status: s.status,
    cancel_at_period_end: s.cancel_at_period_end,
    suspended_at: s.suspended_at,
    current_period_end: s.current_period_end,
    owner_email: emailByUser.get(s.user_id) ?? null,
  }));

  return NextResponse.json({
    mrr_cents: mrrCents,
    paying_users: paidSubs?.length ?? 0,
    trend,
    events: events ?? [],
    churn: churnList,
  });
}

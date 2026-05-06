import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-tenant user list. Joins auth.users (paginated through the Supabase
// admin SDK) with subscriptions and a per-user 30-day send count. Designed
// for a single-page table with optional ?q= filter and ?plan= filter.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const plan = req.nextUrl.searchParams.get("plan");
  const status = req.nextUrl.searchParams.get("status");

  const db = supabaseAdmin();

  // Pull up to 1000 users (early-stage cap; fine for the operator UI).
  // perPage caps at 1000 in supabase-js admin SDK.
  const { data: usersData, error: usersErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersErr) {
    return NextResponse.json({ error: "list_users_failed" }, { status: 500 });
  }

  const userIds = usersData.users.map((u) => u.id);

  // Subscriptions for those users in one round-trip.
  const subsRes = await db
    .from("subscriptions")
    .select("user_id, plan_id, status, current_period_end, suspended_at, stripe_customer_id, stripe_sub_id")
    .in("user_id", userIds);
  const subsByUser = new Map<string, {
    plan_id: string;
    status: string;
    current_period_end: string | null;
    suspended_at: string | null;
    stripe_customer_id: string | null;
    stripe_sub_id: string | null;
  }>();
  for (const s of subsRes.data ?? []) subsByUser.set(s.user_id, s);

  // Sends per user · last 30 days. Single query then aggregate in JS.
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const sendsRes = await db
    .from("send_log")
    .select("user_id, error_class")
    .gte("sent_at", since30)
    .in("user_id", userIds)
    .range(0, 99999);
  const sendsByUser = new Map<string, { sent: number; errors: number }>();
  for (const r of sendsRes.data ?? []) {
    const cur = sendsByUser.get(r.user_id) ?? { sent: 0, errors: 0 };
    if (r.error_class) cur.errors += 1;
    else cur.sent += 1;
    sendsByUser.set(r.user_id, cur);
  }

  // Plans index (price lookup for MRR per user).
  const plansRes = await db
    .from("plans")
    .select("id, monthly_price_cents");
  const priceByPlan: Record<string, number> = {};
  for (const p of plansRes.data ?? []) priceByPlan[p.id] = p.monthly_price_cents;

  let rows = usersData.users.map((au) => {
    const sub = subsByUser.get(au.id);
    const counts = sendsByUser.get(au.id) ?? { sent: 0, errors: 0 };
    const planId = sub?.plan_id ?? "free";
    const priceCents = sub && ["active", "trialing", "past_due"].includes(sub.status) ? priceByPlan[planId] ?? 0 : 0;
    return {
      id: au.id,
      email: au.email ?? null,
      created_at: au.created_at,
      last_sign_in_at: au.last_sign_in_at ?? null,
      plan_id: planId,
      status: sub?.status ?? "active",
      suspended_at: sub?.suspended_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      stripe_customer_id: sub?.stripe_customer_id ?? null,
      mrr_cents: priceCents,
      sends_30d: counts.sent,
      errors_30d: counts.errors,
    };
  });

  if (q) {
    rows = rows.filter(
      (r) =>
        r.email?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }
  if (plan) rows = rows.filter((r) => r.plan_id === plan);
  if (status === "suspended") rows = rows.filter((r) => r.suspended_at != null);
  if (status === "active") rows = rows.filter((r) => r.suspended_at == null);

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return NextResponse.json({
    total: rows.length,
    users: rows,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator-side detail endpoint for one tenant. Aggregates everything an
// operator might want to see in one round-trip: account, subscription,
// 30-day sends, sender count, recent campaigns, recent replies, audit trail.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me || !isAdminUser(me.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = supabaseAdmin();

  // ---- Auth user
  const { data: authRes, error: authErr } = await db.auth.admin.getUserById(id);
  if (authErr || !authRes.user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const au = authRes.user;

  // ---- Subscription
  const { data: sub } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", id)
    .maybeSingle();

  // ---- 30-day send window
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: sendRows } = await db
    .from("send_log")
    .select("sent_at, error_class")
    .eq("user_id", id)
    .gte("sent_at", since30)
    .range(0, 99999);
  const buckets = new Map<string, { day: string; sends: number; errors: number }>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.now() - (29 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { day: key, sends: 0, errors: 0 });
  }
  for (const r of sendRows ?? []) {
    const key = (r.sent_at as string).slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (r.error_class) b.errors += 1;
    else b.sends += 1;
  }
  const series = Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));

  // ---- Counts
  const [{ count: senderCount }, { count: campaignCount }, { count: replyCount }] =
    await Promise.all([
      db.from("senders").select("*", { count: "exact", head: true }).eq("user_id", id),
      db.from("campaigns").select("*", { count: "exact", head: true }).eq("user_id", id),
      db.from("replies").select("*", { count: "exact", head: true }).eq("user_id", id),
    ]);

  // ---- Recent campaigns
  const { data: recentCampaigns } = await db
    .from("campaigns")
    .select("id, name, status, created_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  // ---- Recent senders
  const { data: senders } = await db
    .from("senders")
    .select("id, label, email, auth_method, oauth_status, is_default")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  // ---- Recent audit trail (operator actions on this user)
  const { data: audit } = await db
    .from("admin_audit")
    .select("id, action, payload, actor_id, created_at")
    .eq("target_type", "user")
    .eq("target_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    user: {
      id: au.id,
      email: au.email ?? null,
      created_at: au.created_at,
      last_sign_in_at: au.last_sign_in_at ?? null,
      provider: au.app_metadata?.provider ?? null,
    },
    subscription: sub,
    series,
    counts: {
      senders: senderCount ?? 0,
      campaigns: campaignCount ?? 0,
      replies: replyCount ?? 0,
    },
    recent_campaigns: recentCampaigns ?? [],
    senders: senders ?? [],
    audit: audit ?? [],
  });
}

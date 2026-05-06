import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-tenant senders. Includes 24h send count per sender to flag heavy
// users (and ones close to Gmail's daily limit).
export async function GET() {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data: senders, error } = await db
    .from("senders")
    .select(
      "id, user_id, label, email, auth_method, oauth_status, is_default, warmup_enabled, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
  const list = senders ?? [];

  // 24h sends per sender require a join through campaigns.sender_id since
  // send_log doesn't carry sender_id directly (recipients does, but only
  // post-Phase 1.4 — we read campaigns to keep the count consistent).
  const since24h = new Date(Date.now() - 86400000).toISOString();
  const { data: sendRows } = await db
    .from("send_log")
    .select("campaign_id")
    .gte("sent_at", since24h)
    .range(0, 99999);
  const sendsByCampaign = new Map<string, number>();
  for (const r of sendRows ?? []) {
    sendsByCampaign.set(r.campaign_id, (sendsByCampaign.get(r.campaign_id) ?? 0) + 1);
  }
  const { data: campaignRows } = await db
    .from("campaigns")
    .select("id, sender_id");
  const sendsBySender = new Map<string, number>();
  for (const c of campaignRows ?? []) {
    if (!c.sender_id) continue;
    const sends = sendsByCampaign.get(c.id) ?? 0;
    if (sends > 0) {
      sendsBySender.set(c.sender_id, (sendsBySender.get(c.sender_id) ?? 0) + sends);
    }
  }

  // Owner emails.
  const { data: usersData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailByUser = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailByUser.set(u.id, u.email);
  }

  return NextResponse.json({
    senders: list.map((s) => ({
      ...s,
      owner_email: emailByUser.get(s.user_id) ?? null,
      sends_24h: sendsBySender.get(s.id) ?? 0,
    })),
  });
}

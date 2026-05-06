import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-tenant campaign list. Joins campaigns + recipients_count (sent vs
// failed vs pending) + owner email so the operator UI doesn't have to do
// per-campaign round trips. Pulls from auth.users only for the owner-id
// → email mapping, batched via listUsers.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 200));

  const db = supabaseAdmin();
  let query = db
    .from("campaigns")
    .select("id, user_id, name, subject, status, daily_cap, created_at, archived_at, sender_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  const { data: campaigns, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
  const camps = campaigns ?? [];

  // Aggregate recipient counts per campaign in one round-trip.
  const ids = camps.map((c) => c.id);
  const countsByCampaign = new Map<string, {
    pending: number;
    sent: number;
    failed: number;
    replied: number;
    unsubscribed: number;
    bounced: number;
    skipped: number;
    total: number;
  }>();
  if (ids.length > 0) {
    const { data: rows } = await db
      .from("recipients")
      .select("campaign_id, status")
      .in("campaign_id", ids)
      .range(0, 99999);
    for (const r of rows ?? []) {
      const cur = countsByCampaign.get(r.campaign_id) ?? {
        pending: 0,
        sent: 0,
        failed: 0,
        replied: 0,
        unsubscribed: 0,
        bounced: 0,
        skipped: 0,
        total: 0,
      };
      cur.total += 1;
      const s = r.status as keyof typeof cur;
      if (s in cur) (cur[s] as number) += 1;
      countsByCampaign.set(r.campaign_id, cur);
    }
  }

  // Batched email lookup. Easiest: listUsers and index in memory.
  const { data: usersData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailByUser = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailByUser.set(u.id, u.email);
  }

  return NextResponse.json({
    campaigns: camps.map((c) => ({
      ...c,
      owner_email: emailByUser.get(c.user_id) ?? null,
      counts: countsByCampaign.get(c.id) ?? null,
    })),
  });
}

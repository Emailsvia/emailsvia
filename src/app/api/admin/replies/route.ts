import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-tenant replies. Filterable by intent + last-N-days. Snippet only —
// full HTML stays out of the operator UI for privacy + bandwidth reasons.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const intent = req.nextUrl.searchParams.get("intent");
  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get("days") ?? 7)));
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 200));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const db = supabaseAdmin();
  let query = db
    .from("replies")
    .select(
      "id, user_id, campaign_id, from_email, subject, snippet, intent, intent_confidence, received_at, created_at",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (intent) query = query.eq("intent", intent);

  const { data: replies, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  // Owner emails.
  const { data: usersData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailByUser = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailByUser.set(u.id, u.email);
  }

  // Intent counts (last `days`).
  const { data: bucketRows } = await db
    .from("replies")
    .select("intent")
    .gte("created_at", since)
    .range(0, 99999);
  const intentCounts: Record<string, number> = {};
  for (const r of bucketRows ?? []) {
    const k = r.intent ?? "unclassified";
    intentCounts[k] = (intentCounts[k] ?? 0) + 1;
  }

  return NextResponse.json({
    intent_counts: intentCounts,
    replies: (replies ?? []).map((r) => ({
      ...r,
      owner_email: emailByUser.get(r.user_id) ?? null,
    })),
  });
}

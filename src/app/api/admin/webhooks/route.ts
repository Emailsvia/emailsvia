import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-tenant outbound webhook deliveries. Useful for diagnosing customer
// integrations: which deliveries are stuck, which are exhausted, what HTTP
// the destination returned.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 200));

  const db = supabaseAdmin();
  let query = db
    .from("webhook_deliveries")
    .select(
      "id, webhook_id, user_id, event_type, event_id, status, attempts, http_status, response_excerpt, next_attempt_at, created_at, delivered_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  const { data: deliveries, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  // Webhook destination URLs.
  const webhookIds = Array.from(new Set((deliveries ?? []).map((d) => d.webhook_id)));
  const { data: webhooks } = await db
    .from("webhooks")
    .select("id, name, url, active")
    .in("id", webhookIds.length > 0 ? webhookIds : ["00000000-0000-0000-0000-000000000000"]);
  const webhookById = new Map<string, { name: string; url: string; active: boolean }>();
  for (const w of webhooks ?? []) webhookById.set(w.id, w);

  // Owner emails.
  const { data: usersData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailByUser = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailByUser.set(u.id, u.email);
  }

  // Status counts (last `limit`).
  const statusCounts: Record<string, number> = {};
  for (const d of deliveries ?? []) {
    statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
  }

  return NextResponse.json({
    status_counts: statusCounts,
    deliveries: (deliveries ?? []).map((d) => ({
      ...d,
      owner_email: emailByUser.get(d.user_id) ?? null,
      webhook: webhookById.get(d.webhook_id) ?? null,
    })),
  });
}

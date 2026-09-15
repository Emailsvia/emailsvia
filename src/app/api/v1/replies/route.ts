import { NextRequest, NextResponse } from "next/server";
import { withApi, apiOptions, intParam, apiError } from "@/lib/public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

// GET /api/v1/replies?since=2026-09-01T00:00:00Z&intent=interested&campaign_id=…&include_auto=1&limit=100
export const GET = withApi(async (req: NextRequest, { userId, db }) => {
  const sp = req.nextUrl.searchParams;
  const limit = intParam(req, "limit", 100, 1, 500);
  let q = db
    .from("replies")
    .select(`
      id, campaign_id, recipient_id, from_email, subject, snippet, body_text, received_at,
      intent, intent_confidence, intent_source, is_auto_reply, handled_at,
      recipient:recipients(name, company, email)
    `)
    .eq("user_id", userId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  const since = sp.get("since");
  if (since) {
    if (Number.isNaN(Date.parse(since))) return apiError(400, "invalid_since", "Use an ISO 8601 timestamp.");
    q = q.gte("received_at", new Date(since).toISOString());
  }
  if (sp.get("intent")) q = q.eq("intent", sp.get("intent")!);
  if (sp.get("campaign_id")) q = q.eq("campaign_id", sp.get("campaign_id")!);
  if (sp.get("include_auto") !== "1") q = q.eq("is_auto_reply", false);
  const { data, error } = await q;
  if (error) return apiError(500, "query_failed", error.message);
  return NextResponse.json({ replies: data ?? [] });
});

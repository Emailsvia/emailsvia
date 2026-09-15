import { NextRequest, NextResponse } from "next/server";
import { withApi, apiOptions } from "@/lib/public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

// GET /api/v1/senders — connected sending inboxes (no credentials).
export const GET = withApi(async (_req: NextRequest, { userId, db }) => {
  const { data } = await db
    .from("senders")
    .select("id, label, email, from_name, send_as_email, auth_method, provider, oauth_status, is_default, warmup_enabled, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return NextResponse.json({
    senders: (data ?? []).map((s) => ({
      ...s,
      connected: s.auth_method !== "oauth" || s.oauth_status === "ok",
    })),
  });
});

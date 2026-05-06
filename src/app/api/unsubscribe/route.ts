import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";
import { dispatch as fireWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function process(token: string) {
  const id = verifyToken("u", token);
  if (!id) return { ok: false, status: 400 as const, msg: "invalid_token" };
  const db = supabaseAdmin();
  const { data: r } = await db
    .from("recipients")
    .select("id, email, campaign_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!r) return { ok: false, status: 404 as const, msg: "not_found" };
  // Per-user unsubscribe list (PK is now (user_id, email)). Only mark this
  // user's recipients as unsubscribed — a different user's campaign to the
  // same address is unaffected.
  await db
    .from("unsubscribes")
    .upsert(
      { user_id: r.user_id, email: r.email, campaign_id: r.campaign_id },
      { onConflict: "user_id,email" }
    );
  await db
    .from("recipients")
    .update({ status: "unsubscribed", next_follow_up_at: null })
    .eq("user_id", r.user_id)
    .eq("email", r.email);
  // Webhook event_id keyed on user+email (not recipient_id) so the same
  // unsub across multiple campaigns of the same user fires once.
  await fireWebhook(db, {
    user_id: r.user_id,
    event_type: "recipient.unsubscribed",
    event_id: `unsub:${r.user_id}:${r.email}`,
    payload: {
      email: r.email,
      campaign_id: r.campaign_id,
    },
  });
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: "" }));
  const res = await process(token);
  if (!res.ok) return NextResponse.json({ error: res.msg }, { status: res.status });
  return NextResponse.json({ ok: true });
}

// Gmail/Outlook one-click List-Unsubscribe-Post sends POST with no body — handled above.
// Some clients also do a GET, so redirect them to the page.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const res = await process(token);
  const url = new URL(`/u/${token}`, req.nextUrl.origin);
  return NextResponse.redirect(url, res.ok ? 302 : 303);
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requestOrigin, verifyMessageToken } from "@/lib/tokens";
import { recordEvents, stepOf } from "@/lib/activity";
import { dispatch as fireWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function process(token: string, method: "one_click" | "confirm_page") {
  const ref = verifyMessageToken("u", token);
  if (!ref) return { ok: false, status: 400 as const, msg: "invalid_token" };
  const db = supabaseAdmin();
  const { data: r } = await db
    .from("recipients")
    .select("id, email, campaign_id, user_id")
    .eq("id", ref.recipientId)
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
  const { data: affected } = await db
    .from("recipients")
    .update({ status: "unsubscribed", next_follow_up_at: null })
    .eq("user_id", r.user_id)
    .eq("email", r.email)
    .select("id, campaign_id, user_id, stop_reason");
  // Record why each sequence ended (leave an earlier reason, e.g. replied).
  const unstopped = (affected ?? []).filter((a) => !a.stop_reason).map((a) => a.id);
  if (unstopped.length > 0) {
    await db.from("recipients").update({ stop_reason: "unsubscribed" }).in("id", unstopped);
  }

  // Which email they unsubscribed from (per-email tokens only).
  const { data: email } = ref.sendLogId
    ? await db
        .from("send_log")
        .select("id, kind, step_number")
        .eq("id", ref.sendLogId)
        .eq("recipient_id", r.id)
        .maybeSingle()
    : { data: null };
  await recordEvents(
    db,
    (affected ?? []).map((a) => ({
      user_id: a.user_id,
      campaign_id: a.campaign_id,
      recipient_id: a.id,
      type: "unsubscribed" as const,
      send_log_id: a.id === r.id ? email?.id ?? null : null,
      step_number: a.id === r.id ? stepOf(email) : null,
      data: { method, from_campaign_id: r.campaign_id, via_recipient_id: a.id === r.id ? undefined : r.id },
      dedupe_key: "unsubscribed",
    }))
  );
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

// Two callers:
//   - RFC 8058 one-click: Gmail/Yahoo POST to the List-Unsubscribe URL
//     (`/api/unsubscribe?token=…`) with a form body `List-Unsubscribe=One-Click`.
//     Must return 2xx with no redirect.
//   - The /u/[token] confirm page, which POSTs JSON `{ token }`.
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("token") || "";
  // The header link carries ?token=; the confirm page posts JSON.
  const method = token ? "one_click" : "confirm_page";
  if (!token && (req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await req.json().catch(() => null);
    token = typeof body?.token === "string" ? body.token : "";
  }
  const res = await process(token, method);
  if (!res.ok) return NextResponse.json({ error: res.msg }, { status: res.status });
  return NextResponse.json({ ok: true });
}

// GET never unsubscribes: mail security scanners pre-fetch every URL in a
// message, which would silently opt recipients out (RFC 8058 §3.1). Send
// the visitor to the confirm page instead.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const url = new URL(`/u/${encodeURIComponent(token)}`, requestOrigin(req));
  return NextResponse.redirect(url, 303);
}

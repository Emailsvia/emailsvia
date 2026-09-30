import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyMessageToken } from "@/lib/tokens";
import { classifyOpen, clientIp } from "@/lib/bot-detect";
import { recordEvent, stepOf } from "@/lib/activity";
import { emitOpened } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// Gmail's image proxy (Google ImageProxy) prefetches tracking pixels on mail
// arrival and re-hits the URL when the preview refreshes, inflating open counts
// by 3-10x. Dedup opens of the same email within this window so a burst
// of prefetches counts as a single "open". 2 minutes is short enough that a
// recipient who opens at 10:00 and again at 10:05 still registers 2 opens.
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

function gifResponse() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL.length),
      "cache-control": "no-store, private",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ref = verifyMessageToken("o", token.replace(/\.gif$/, ""));
  if (!ref) return gifResponse();

  try {
    const db = supabaseAdmin();
    const now = new Date();
    const { data: r } = await db
      .from("recipients")
      .select("id, email, campaign_id, user_id, last_sent_at")
      .eq("id", ref.recipientId)
      .maybeSingle();
    if (!r) return gifResponse();

    // The email this pixel was in. Older mail carries recipient-only tokens:
    // fall back to the last send for prefetch timing, with no attribution.
    const { data: email } = ref.sendLogId
      ? await db
          .from("send_log")
          .select("id, kind, step_number, sent_at")
          .eq("id", ref.sendLogId)
          .eq("recipient_id", r.id)
          .maybeSingle()
      : { data: null };
    const sentAtRaw = email?.sent_at ?? r.last_sent_at;

    // Skip the insert if we already logged an open of this email within the
    // dedup window — avoids counting Gmail's image proxy prefetches as
    // separate opens.
    const cutoff = new Date(now.getTime() - DEDUP_WINDOW_MS).toISOString();
    let recentQ = db
      .from("tracking_events")
      .select("id")
      .eq("recipient_id", r.id)
      .eq("kind", "open")
      .gte("created_at", cutoff);
    if (email) recentQ = recentQ.eq("send_log_id", email.id);
    const { data: recent } = await recentQ.limit(1).maybeSingle();
    if (recent) return gifResponse();

    const userAgent = req.headers.get("user-agent");
    const machine = classifyOpen({
      userAgent,
      ip: clientIp(req.headers),
      sentAt: sentAtRaw ? new Date(sentAtRaw) : null,
      now,
    });
    const { data: te } = await db
      .from("tracking_events")
      .insert({
        recipient_id: r.id,
        campaign_id: r.campaign_id,
        user_id: r.user_id,
        kind: "open",
        user_agent: userAgent,
        send_log_id: email?.id ?? null,
        is_machine: !!machine,
        machine_reason: machine,
      })
      .select("id")
      .single();
    if (te) {
      await recordEvent(db, {
        user_id: r.user_id,
        campaign_id: r.campaign_id,
        recipient_id: r.id,
        type: "opened",
        occurred_at: now,
        send_log_id: email?.id ?? null,
        step_number: stepOf(email),
        is_machine: !!machine,
        machine_reason: machine,
        data: { user_agent: userAgent?.slice(0, 300) },
        dedupe_key: `track:${te.id}`,
      });
      // Webhook once per email (event id = the email), humans only.
      if (!machine) {
        await emitOpened(db, r, { send_log_id: email?.id ?? null, step: stepOf(email), opened_at: now.toISOString() });
      }
    }
  } catch {}
  return gifResponse();
}

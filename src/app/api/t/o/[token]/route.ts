import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// Gmail's image proxy (Google ImageProxy) prefetches tracking pixels on mail
// arrival and re-hits the URL when the preview refreshes, inflating open counts
// by 3-10x. Dedup opens from the same recipient within this window so a burst
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
  const raw = token.replace(/\.gif$/, "");
  const id = verifyToken("o", raw);
  if (!id) return gifResponse();

  try {
    const db = supabaseAdmin();
    const { data: r } = await db
      .from("recipients")
      .select("id, campaign_id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (!r) return gifResponse();

    // Skip the insert if we already logged an open for this recipient within
    // the dedup window — avoids counting Gmail's image proxy prefetches as
    // separate opens.
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: recent } = await db
      .from("tracking_events")
      .select("id")
      .eq("recipient_id", r.id)
      .eq("kind", "open")
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();

    if (!recent) {
      await db.from("tracking_events").insert({
        recipient_id: r.id,
        campaign_id: r.campaign_id,
        user_id: r.user_id,
        kind: "open",
        user_agent: req.headers.get("user-agent") ?? null,
      });
    }
  } catch {}
  return gifResponse();
}

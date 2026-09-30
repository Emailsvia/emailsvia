import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyMessageToken, verifyClickUrl, appUrl } from "@/lib/tokens";
import { classifyClick, clientIp } from "@/lib/bot-detect";
import { linkKey, recordEvent, stepOf } from "@/lib/activity";
import { emitClicked } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A second hit on the same link from the same email within this window is
// the same click (double-click, browser retry, scanner re-check).
const CLICK_DEDUP_MS = 60 * 1000;
// Different links of one email hit within this window: a scanner walking
// the message, not a person.
const LINK_BURST_MS = 10 * 1000;

// Only follow destinations we signed at send time; anything else would make
// this route an open redirect for anyone holding one valid click token.
function resolve(req: NextRequest, token: string) {
  const urlStr = req.nextUrl.searchParams.get("u");
  const ref = verifyMessageToken("c", token);
  const signed =
    !!ref && !!urlStr && /^https?:\/\//i.test(urlStr) &&
    verifyClickUrl(token, urlStr, req.nextUrl.searchParams.get("s"));
  return signed ? { ref: ref!, target: urlStr as string } : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ok = resolve(req, token);
  if (!ok) return NextResponse.redirect(new URL("/", appUrl()), 302);
  const { ref, target } = ok;
  try {
    await recordClick(req, ref, target);
  } catch {}
  return NextResponse.redirect(target, 302);
}

// Link checkers often probe with HEAD. Redirect without counting a click.
export async function HEAD(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ok = resolve(req, token);
  return NextResponse.redirect(ok ? ok.target : new URL("/", appUrl()), 302);
}

async function recordClick(
  req: NextRequest,
  ref: { recipientId: string; sendLogId: string | null },
  url: string
) {
  const db = supabaseAdmin();
  const now = new Date();
  const { data: r } = await db
    .from("recipients")
    .select("id, email, campaign_id, user_id, last_sent_at")
    .eq("id", ref.recipientId)
    .maybeSingle();
  if (!r) return;

  const { data: email } = ref.sendLogId
    ? await db
        .from("send_log")
        .select("id, kind, step_number, sent_at")
        .eq("id", ref.sendLogId)
        .eq("recipient_id", r.id)
        .maybeSingle()
    : { data: null };
  const sentAtRaw = email?.sent_at ?? r.last_sent_at;

  // Recent clicks by this recipient (on this email, when we know it).
  let recentQ = db
    .from("tracking_events")
    .select("url, created_at")
    .eq("recipient_id", r.id)
    .eq("kind", "click")
    .gte("created_at", new Date(now.getTime() - CLICK_DEDUP_MS).toISOString());
  if (email) recentQ = recentQ.eq("send_log_id", email.id);
  const { data: recent } = await recentQ.limit(20);
  if ((recent ?? []).some((c) => c.url === url)) return; // same click again

  const burstCutoff = now.getTime() - LINK_BURST_MS;
  const otherLinkJustClicked = (recent ?? []).some(
    (c) => c.url !== url && new Date(c.created_at).getTime() >= burstCutoff
  );
  const userAgent = req.headers.get("user-agent");
  const machine = classifyClick({
    userAgent,
    ip: clientIp(req.headers),
    sentAt: sentAtRaw ? new Date(sentAtRaw) : null,
    now,
    otherLinkJustClicked,
  });

  const { data: te } = await db
    .from("tracking_events")
    .insert({
      recipient_id: r.id,
      campaign_id: r.campaign_id,
      user_id: r.user_id,
      kind: "click",
      url,
      user_agent: userAgent,
      send_log_id: email?.id ?? null,
      is_machine: !!machine,
      machine_reason: machine,
    })
    .select("id")
    .single();
  if (!te) return;
  await recordEvent(db, {
    user_id: r.user_id,
    campaign_id: r.campaign_id,
    recipient_id: r.id,
    type: "clicked",
    occurred_at: now,
    send_log_id: email?.id ?? null,
    step_number: stepOf(email),
    is_machine: !!machine,
    machine_reason: machine,
    data: { url: url.slice(0, 1000), link_key: linkKey(url), user_agent: userAgent?.slice(0, 300) },
    dedupe_key: `track:${te.id}`,
  });
  if (!machine) {
    await emitClicked(db, r, { click_id: te.id, url, link_key: linkKey(url), step: stepOf(email), clicked_at: now.toISOString() });
  }
}

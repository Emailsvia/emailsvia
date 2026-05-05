import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-recipient engagement timeline + campaign-wide link-click breakdown.
// Returns:
//   - recipients: [{ id, name, email, score, opens, clicks, replied, timeline[] }]
//   - links: [{ url, unique_clickers, total_clicks }]
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  // Activity timeline is bounded — at the cap the engagement-by-recipient
  // table simply truncates to the most-engaged 5K. Beyond that the page
  // is unreadable anyway and the polling payload is what kills perf.
  // Tracking + send_log are tied to recipients so the same cap applies.
  const ROW_CAP = 5000;
  const [recipientsRes, sendLogRes, trackingRes, repliesRes] = await Promise.all([
    db.from("recipients")
      .select("id, name, email, company, status, sent_at, replied_at")
      .eq("campaign_id", id)
      .order("row_index", { ascending: true })
      .range(0, ROW_CAP - 1),
    db.from("send_log")
      .select("recipient_id, kind, step_number, sent_at")
      .eq("campaign_id", id)
      .order("sent_at", { ascending: false })
      .range(0, ROW_CAP - 1),
    db.from("tracking_events")
      .select("recipient_id, kind, url, user_agent, created_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .range(0, ROW_CAP - 1),
    db.from("replies")
      .select("recipient_id, subject, snippet, received_at, created_at")
      .eq("campaign_id", id)
      .order("received_at", { ascending: false, nullsFirst: false })
      .range(0, 999),
  ]);

  const recipients = recipientsRes.data ?? [];
  const sendLog = sendLogRes.data ?? [];
  const tracking = trackingRes.data ?? [];
  const replies = repliesRes.data ?? [];

  type Ev = { kind: string; at: string; meta?: Record<string, string | null> };
  const timelines = new Map<string, Ev[]>();
  const opensPerRecipient = new Map<string, number>();
  const clicksPerRecipient = new Map<string, number>();
  const repliedIds = new Set<string>();

  for (const r of recipients) timelines.set(r.id, []);

  for (const s of sendLog) {
    const tl = timelines.get(s.recipient_id);
    if (!tl || !s.sent_at) continue;
    tl.push({
      kind: s.kind === "follow_up" ? `follow_up_${s.step_number ?? 1}` : s.kind,
      at: s.sent_at,
    });
  }
  for (const t of tracking) {
    const tl = timelines.get(t.recipient_id);
    if (!tl) continue;
    tl.push({
      kind: t.kind, // "open" | "click"
      at: t.created_at,
      meta: { url: t.url, user_agent: t.user_agent ?? null },
    });
    if (t.kind === "open") opensPerRecipient.set(t.recipient_id, (opensPerRecipient.get(t.recipient_id) ?? 0) + 1);
    else if (t.kind === "click") clicksPerRecipient.set(t.recipient_id, (clicksPerRecipient.get(t.recipient_id) ?? 0) + 1);
  }
  for (const r of replies) {
    if (!r.recipient_id) continue;
    const tl = timelines.get(r.recipient_id);
    if (!tl) continue;
    tl.push({
      kind: "reply",
      at: r.received_at ?? r.created_at,
      meta: { subject: r.subject ?? null, snippet: r.snippet ?? null },
    });
    repliedIds.add(r.recipient_id);
  }

  // Sort every timeline oldest-first for display
  for (const tl of timelines.values()) {
    tl.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  // Engagement score: opens×1 + clicks×5 + reply×20
  const recipientsOut = recipients.map((r) => {
    const opens = opensPerRecipient.get(r.id) ?? 0;
    const clicks = clicksPerRecipient.get(r.id) ?? 0;
    const replied = repliedIds.has(r.id) || r.status === "replied";
    const score = opens * 1 + clicks * 5 + (replied ? 20 : 0);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      status: r.status,
      sent_at: r.sent_at,
      replied_at: r.replied_at,
      opens,
      clicks,
      replied,
      score,
      timeline: timelines.get(r.id) ?? [],
    };
  });

  // Link click breakdown
  const linkStats = new Map<string, { total: number; uniq: Set<string> }>();
  for (const t of tracking) {
    if (t.kind !== "click" || !t.url) continue;
    const b = linkStats.get(t.url) ?? { total: 0, uniq: new Set<string>() };
    b.total++;
    b.uniq.add(t.recipient_id);
    linkStats.set(t.url, b);
  }
  const links = Array.from(linkStats.entries())
    .map(([url, s]) => ({ url, total_clicks: s.total, unique_clickers: s.uniq.size }))
    .sort((a, b) => b.total_clicks - a.total_clicks);

  return NextResponse.json({ recipients: recipientsOut, links });
}

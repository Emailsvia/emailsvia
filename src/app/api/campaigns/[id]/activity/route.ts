import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Campaign-wide engagement summary for the recipients table + link-click
// breakdown. Per-recipient counts come from the rollup on `recipients`
// (maintained from recipient_events, human activity only), so they're exact
// at any campaign size. Each person's full history is served separately by
// /api/campaigns/[id]/recipients/[rid]/timeline.
// Returns:
//   - recipients: [{ id, opens, clicks, replied, score, last_activity_at, last_activity_type }]
//   - links: [{ url, unique_clickers, total_clicks }]   (human clicks)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const ROW_CAP = 5000;
  const [recipientsRes, clicksRes] = await Promise.all([
    db.from("recipients")
      .select("id, status, open_count, click_count, machine_open_count, last_activity_at, last_activity_type")
      .eq("campaign_id", id)
      .order("row_index", { ascending: true })
      .range(0, ROW_CAP - 1),
    db.from("tracking_events")
      .select("recipient_id, url")
      .eq("campaign_id", id)
      .eq("kind", "click")
      .eq("is_machine", false)
      .order("created_at", { ascending: false })
      .range(0, 19_999),
  ]);

  // Engagement score: opens×1 + clicks×5 + reply×20
  const recipients = (recipientsRes.data ?? []).map((r) => {
    const opens = r.open_count ?? 0;
    const clicks = r.click_count ?? 0;
    const replied = r.status === "replied";
    return {
      id: r.id,
      opens,
      clicks,
      machine_opens: r.machine_open_count ?? 0,
      replied,
      score: opens + clicks * 5 + (replied ? 20 : 0),
      last_activity_at: r.last_activity_at,
      last_activity_type: r.last_activity_type,
    };
  });

  const linkStats = new Map<string, { total: number; uniq: Set<string> }>();
  for (const t of clicksRes.data ?? []) {
    if (!t.url) continue;
    const b = linkStats.get(t.url) ?? { total: 0, uniq: new Set<string>() };
    b.total++;
    b.uniq.add(t.recipient_id);
    linkStats.set(t.url, b);
  }
  const links = Array.from(linkStats.entries())
    .map(([url, s]) => ({ url, total_clicks: s.total, unique_clickers: s.uniq.size }))
    .sort((a, b) => b.total_clicks - a.total_clicks);

  return NextResponse.json({ recipients, links });
}

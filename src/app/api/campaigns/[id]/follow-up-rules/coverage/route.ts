import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { linkKey } from "@/lib/link-key";
import type { Profile } from "@/lib/situations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who is where right now, for the rule editor's "N people match" counts.
// Recipients still in play (status 'sent') are reduced to situation
// profiles and grouped, so the editor can run src/lib/situations.ts over
// any unsaved rule set without a round-trip per edit.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const now = Date.now();

  const [{ data: camp }, { data: recs }, { data: sends }, { data: settings }] = await Promise.all([
    db.from("campaigns").select("tracking_enabled").eq("id", id).maybeSingle(),
    db
      .from("recipients")
      .select("id, open_count, click_count, machine_open_count, clicked_link_keys, last_opened_at, last_clicked_at, last_sent_at, ooo_until")
      .eq("campaign_id", id)
      .eq("status", "sent")
      .range(0, 19_999),
    db
      .from("send_log")
      .select("recipient_id, sent_at")
      .eq("campaign_id", id)
      .is("error_class", null)
      .range(0, 99_999),
    db.from("user_settings").select("meeting_link").eq("user_id", u.id).maybeSingle(),
  ]);
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sendsBy = new Map<string, number[]>();
  for (const s of sends ?? []) {
    const arr = sendsBy.get(s.recipient_id) ?? [];
    arr.push(new Date(s.sent_at).getTime());
    sendsBy.set(s.recipient_id, arr);
  }

  const groups = new Map<string, { profile: Profile; count: number }>();
  for (const r of recs ?? []) {
    const lastEngaged = Math.max(
      r.last_opened_at ? new Date(r.last_opened_at).getTime() : 0,
      r.last_clicked_at ? new Date(r.last_clicked_at).getTime() : 0
    );
    const quiet = lastEngaged ? (sendsBy.get(r.id) ?? []).filter((t) => t > lastEngaged).length : 0;
    const ooo = r.ooo_until ? new Date(r.ooo_until).getTime() : 0;
    const lastSent = r.last_sent_at ? new Date(r.last_sent_at).getTime() : 0;
    // Counts above these caps don't change any situation, so cap them to
    // keep the number of groups small.
    const profile: Profile = {
      opens: Math.min(r.open_count ?? 0, 50),
      clicks: Math.min(r.click_count ?? 0, 5),
      machineOpens: Math.min(r.machine_open_count ?? 0, 1),
      linkKeys: [...(r.clicked_link_keys ?? [])].sort(),
      quietEmails: Math.min(quiet, 10),
      backFromOoo: !!ooo && ooo <= now && lastSent < ooo,
    };
    const key = JSON.stringify(profile);
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { profile, count: 1 });
  }

  return NextResponse.json({
    total: recs?.length ?? 0,
    tracking: !!camp.tracking_enabled,
    meeting_link_key: linkKey(settings?.meeting_link ?? null),
    groups: Array.from(groups.values()),
  });
}

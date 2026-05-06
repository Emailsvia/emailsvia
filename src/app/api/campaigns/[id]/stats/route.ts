import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { variantBreakdown, pickAutoWinner, isVariantArray } from "@/lib/variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const [
    total,
    sent,
    replied,
    failed,
    pending,
    unsubscribed,
    followUpsSent,
    retriesSent,
    opens,
    clicks,
    uniqueOpeners,
    uniqueClickers,
  ] = await Promise.all([
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["sent", "replied"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "replied"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["failed", "bounced"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "pending"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "unsubscribed"),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "follow_up").is("error_class", null),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "retry").is("error_class", null),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "open"),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "click"),
    // Unique-opener / unique-clicker dedupe is bucketed client-side from
    // recipient_id rows. Capped at 20K — beyond that, a Postgres
    // `count(distinct recipient_id)` RPC would be the right answer; the
    // cap is well above any realistic per-campaign open count.
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "open").range(0, 19_999),
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "click").range(0, 19_999),
  ]);

  const uniqOpen = new Set((uniqueOpeners.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const uniqClick = new Set((uniqueClickers.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const sentCount = sent.count ?? 0;

  // Hourly + weekday engagement in the campaign's timezone (default IST).
  const { data: campTz } = await db.from("campaigns").select("timezone").eq("id", id).maybeSingle();
  const tz = campTz?.timezone || "Asia/Kolkata";

  // Hourly + weekday bucketing — same cap as above. A SQL
  // `extract(hour from created_at) group by` RPC would scale better but
  // 20K is well over a typical campaign's open count.
  const [openRowsRes, clickRowsRes] = await Promise.all([
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "open").range(0, 19_999),
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "click").range(0, 19_999),
  ]);
  const openRows = openRowsRes.data ?? [];
  const clickRows = clickRowsRes.data ?? [];

  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const WEEKDAY_IDX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  const opensByHour = new Array(24).fill(0);
  const clicksByHour = new Array(24).fill(0);
  const opensByWeekday = new Array(7).fill(0);
  const clicksByWeekday = new Array(7).fill(0);

  const bucket = (row: { created_at: string }, hourArr: number[], weekdayArr: number[]) => {
    const d = new Date(row.created_at);
    const h = Number(hourFmt.format(d));
    hourArr[h === 24 ? 0 : h]++;
    const w = WEEKDAY_IDX[weekdayFmt.format(d)] ?? 0;
    weekdayArr[w]++;
  };
  for (const o of openRows) bucket(o as { created_at: string }, opensByHour, opensByWeekday);
  for (const c of clickRows) bucket(c as { created_at: string }, clicksByHour, clicksByWeekday);

  const rate = (num: number, denom: number) => (denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0);

  // Per-variant A/B breakdown — null when the campaign isn't running an
  // A/B test. Auto-pick a winner if the threshold is hit and not already
  // pinned (cheap to compute; persistence is opt-in via a separate UI
  // action so the user always sees the data first).
  let variantStats: Awaited<ReturnType<typeof variantBreakdown>> | null = null;
  let suggestedWinner: string | null = null;
  const { data: campRow } = await db
    .from("campaigns")
    .select("variants, ab_winner_id, ab_winner_threshold")
    .eq("id", id)
    .maybeSingle();
  if (campRow && isVariantArray(campRow.variants)) {
    variantStats = await variantBreakdown(db, id);
    if (!campRow.ab_winner_id && campRow.ab_winner_threshold) {
      suggestedWinner = pickAutoWinner(variantStats, campRow.ab_winner_threshold);
    }
  }

  return NextResponse.json({
    total: total.count ?? 0,
    sent: sentCount,
    replied: replied.count ?? 0,
    failed: failed.count ?? 0,
    pending: pending.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
    follow_ups_sent: followUpsSent.count ?? 0,
    retries_sent: retriesSent.count ?? 0,
    opens: opens.count ?? 0,
    unique_opens: uniqOpen,
    clicks: clicks.count ?? 0,
    unique_clicks: uniqClick,
    rates: {
      open_rate: rate(uniqOpen, sentCount),
      click_rate: rate(uniqClick, sentCount),
      reply_rate: rate(replied.count ?? 0, sentCount),
      bounce_rate: rate(failed.count ?? 0, sentCount),
      unsubscribe_rate: rate(unsubscribed.count ?? 0, sentCount),
    },
    opens_by_hour: opensByHour,
    clicks_by_hour: clicksByHour,
    opens_by_weekday: opensByWeekday,
    clicks_by_weekday: clicksByWeekday,
    timezone: tz,
    variants: variantStats,
    suggested_winner: suggestedWinner,
    current_winner: campRow?.ab_winner_id ?? null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

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
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "open").range(0, 99999),
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "click").range(0, 99999),
  ]);

  const uniqOpen = new Set((uniqueOpeners.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const uniqClick = new Set((uniqueClickers.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const sentCount = sent.count ?? 0;

  // Hourly + weekday engagement in the campaign's timezone (default IST).
  const { data: campTz } = await db.from("campaigns").select("timezone").eq("id", id).maybeSingle();
  const tz = campTz?.timezone || "Asia/Kolkata";

  const [openRowsRes, clickRowsRes] = await Promise.all([
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "open").range(0, 99999),
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "click").range(0, 99999),
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
  });
}

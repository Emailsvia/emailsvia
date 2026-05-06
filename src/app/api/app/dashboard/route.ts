import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard summary feed for /app. Single round-trip: returns today's
// activity, totals across the workspace, and a 14-day spark of sends so
// the UI can render the KPI strip + sparkline without N+1 fetches.

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const today = isoDay(new Date());
  const yesterday = isoDay(addDays(new Date(), -1));
  const fourteenDaysAgo = isoDay(addDays(new Date(), -13));
  const startOfToday = new Date(`${today}T00:00:00.000Z`).toISOString();
  const startOfYesterday = new Date(`${yesterday}T00:00:00.000Z`).toISOString();

  const [
    todayUsage,
    yesterdayUsage,
    last14Usage,
    repliesToday,
    repliesYesterday,
    sendersAll,
    campaignsAll,
  ] = await Promise.all([
    db.from("usage_daily").select("sent").eq("user_id", u.id).eq("day", today).maybeSingle(),
    db.from("usage_daily").select("sent").eq("user_id", u.id).eq("day", yesterday).maybeSingle(),
    db.from("usage_daily").select("day, sent").eq("user_id", u.id).gte("day", fourteenDaysAgo).order("day", { ascending: true }),
    db.from("replies").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("received_at", startOfToday),
    db.from("replies").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("received_at", startOfYesterday).lt("received_at", startOfToday),
    db.from("senders").select("id, oauth_status").eq("user_id", u.id),
    db.from("campaigns").select("id, status, archived_at").eq("user_id", u.id),
  ]);

  const sentToday      = todayUsage.data?.sent ?? 0;
  const sentYesterday  = yesterdayUsage.data?.sent ?? 0;
  const replyToday     = repliesToday.count ?? 0;
  const replyYesterday = repliesYesterday.count ?? 0;

  // Spark: dense 14-day series, fill missing days with 0
  const usageByDay = new Map<string, number>();
  for (const row of (last14Usage.data ?? []) as { day: string; sent: number }[]) {
    usageByDay.set(row.day, row.sent);
  }
  const spark: { day: string; sent: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = isoDay(addDays(new Date(), -i));
    spark.push({ day: d, sent: usageByDay.get(d) ?? 0 });
  }

  const senders = sendersAll.data ?? [];
  const sendersConnected = senders.filter((s) => s.oauth_status === "ok").length;

  const campaigns = (campaignsAll.data ?? []).filter((c) => c.archived_at == null);
  const campaignsRunning = campaigns.filter((c) => c.status === "running").length;

  // Reply rate over the last 14 days = total replies (14d) / total sent (14d)
  const sent14 = spark.reduce((acc, x) => acc + x.sent, 0);
  // Pull replies for the 14d window — small + cheap; cheaper than another count query
  const startOf14 = new Date(`${fourteenDaysAgo}T00:00:00.000Z`).toISOString();
  const { count: replies14 } = await db
    .from("replies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", u.id)
    .gte("received_at", startOf14);
  const replyRate = sent14 > 0 ? Math.round(((replies14 ?? 0) / sent14) * 1000) / 10 : 0;

  return NextResponse.json({
    today: {
      sent: sentToday,
      replies: replyToday,
    },
    deltas: {
      sent: deltaPct(sentToday, sentYesterday),
      replies: deltaPct(replyToday, replyYesterday),
    },
    senders: {
      connected: sendersConnected,
      total: senders.length,
    },
    campaigns: {
      running: campaignsRunning,
      total: campaigns.length,
    },
    reply_rate_14d: replyRate,
    spark, // [{day, sent}, ...] last 14 days inclusive of today
  });
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}
function deltaPct(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null; // null = "no baseline"
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

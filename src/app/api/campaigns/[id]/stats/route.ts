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
    machineOpens,
    meetingRows,
  ] = await Promise.all([
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["sent", "replied"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "replied"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["failed", "bounced"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "pending"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "unsubscribed"),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "follow_up").is("error_class", null),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "retry").is("error_class", null),
    // Human engagement only: Apple Mail privacy fetches, prefetches and link
    // scanners are flagged is_machine at capture (src/lib/bot-detect.ts).
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "open").eq("is_machine", false),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "click").eq("is_machine", false),
    // Unique-opener / unique-clicker dedupe is bucketed client-side from
    // recipient_id rows. Capped at 20K — beyond that, a Postgres
    // `count(distinct recipient_id)` RPC would be the right answer; the
    // cap is well above any realistic per-campaign open count.
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "open").eq("is_machine", false).range(0, 19_999),
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "click").eq("is_machine", false).range(0, 19_999),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "open").eq("is_machine", true),
    db.from("recipient_events").select("recipient_id").eq("campaign_id", id).eq("type", "meeting_booked").range(0, 19_999),
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
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "open").eq("is_machine", false).range(0, 19_999),
    db.from("tracking_events").select("created_at").eq("campaign_id", id).eq("kind", "click").eq("is_machine", false).range(0, 19_999),
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

  // ---- Sequence performance: sends and replies per step ----
  // Step 0 = first email. A reply is credited to the last step the recipient
  // got before answering (follow_up_count at reply time: follow-ups stop on
  // reply, so it doesn't move afterwards).
  const [{ data: logRows }, { data: recRows }] = await Promise.all([
    db
      .from("send_log")
      .select("kind, step_number, sender_id, rule_id, recipient_id, sent_at")
      .eq("campaign_id", id)
      .is("error_class", null)
      .range(0, 199_999),
    db
      .from("recipients")
      .select("id, status, follow_up_count, sender_id, replied_at")
      .eq("campaign_id", id)
      .in("status", ["sent", "replied", "bounced", "unsubscribed"])
      .range(0, 99_999),
  ]);
  const stepSent = new Map<number, number>();
  const senderSent = new Map<string, number>();
  for (const l of logRows ?? []) {
    const step = l.kind === "follow_up" ? (l.step_number ?? 0) : 0;
    // Rule emails are reported per rule below, not as default steps.
    if (!l.rule_id && (l.kind === "retry" || l.kind === "initial" || l.kind === "follow_up")) {
      stepSent.set(step, (stepSent.get(step) ?? 0) + 1);
    }
    if (l.sender_id) senderSent.set(l.sender_id, (senderSent.get(l.sender_id) ?? 0) + 1);
  }
  const stepReplies = new Map<number, number>();
  const senderAgg = new Map<string, { contacted: number; replied: number; bounced: number }>();
  for (const r of recRows ?? []) {
    if (r.status === "replied") {
      const step = r.follow_up_count ?? 0;
      stepReplies.set(step, (stepReplies.get(step) ?? 0) + 1);
    }
    if (r.sender_id) {
      const a = senderAgg.get(r.sender_id) ?? { contacted: 0, replied: 0, bounced: 0 };
      a.contacted++;
      if (r.status === "replied") a.replied++;
      if (r.status === "bounced") a.bounced++;
      senderAgg.set(r.sender_id, a);
    }
  }
  const totalReplies = Array.from(stepReplies.values()).reduce((a, b) => a + b, 0);
  const stepNumbers = Array.from(new Set([...stepSent.keys(), ...stepReplies.keys()])).sort((a, b) => a - b);
  const steps = stepNumbers.map((n) => ({
    step: n,
    sent: stepSent.get(n) ?? 0,
    replies: stepReplies.get(n) ?? 0,
    reply_rate: rate(stepReplies.get(n) ?? 0, stepSent.get(n) ?? 0),
    share_of_replies: rate(stepReplies.get(n) ?? 0, totalReplies),
  }));

  // ---- Activity-based rules: people reached, and who replied after ----
  // A reply counts for a rule if it came after that person's first email
  // from the rule.
  const ruleFirstSend = new Map<string, Map<string, number>>(); // rule → recipient → first send
  const ruleSent = new Map<string, number>();
  for (const l of logRows ?? []) {
    if (!l.rule_id) continue;
    ruleSent.set(l.rule_id, (ruleSent.get(l.rule_id) ?? 0) + 1);
    const m = ruleFirstSend.get(l.rule_id) ?? new Map<string, number>();
    const t = new Date(l.sent_at).getTime();
    if (!m.has(l.recipient_id) || t < m.get(l.recipient_id)!) m.set(l.recipient_id, t);
    ruleFirstSend.set(l.rule_id, m);
  }
  const repliedAt = new Map<string, number>();
  for (const r of recRows ?? []) {
    if (r.status === "replied" && r.replied_at) repliedAt.set(r.id, new Date(r.replied_at).getTime());
  }
  const { data: ruleRows } = await db
    .from("follow_up_rules")
    .select("id, name, position")
    .eq("campaign_id", id)
    .order("position", { ascending: true });
  const ruleIds = new Set([...(ruleRows ?? []).map((r) => r.id as string), ...ruleSent.keys()]);
  const rules = Array.from(ruleIds).map((rid) => {
    const reached = ruleFirstSend.get(rid) ?? new Map<string, number>();
    let replied = 0;
    for (const [recipientId, first] of reached) {
      const at = repliedAt.get(recipientId);
      if (at !== undefined && at > first) replied++;
    }
    return {
      rule_id: rid,
      name: (ruleRows ?? []).find((r) => r.id === rid)?.name ?? "Deleted rule",
      sent: ruleSent.get(rid) ?? 0,
      people: reached.size,
      replied,
      reply_rate: rate(replied, reached.size),
    };
  });

  // ---- Inbox health (rotation / sticky sender) ----
  const senderIds = Array.from(new Set([...senderSent.keys(), ...senderAgg.keys()]));
  const { data: senderRows } = senderIds.length
    ? await db.from("senders").select("id, email").in("id", senderIds)
    : { data: [] as { id: string; email: string }[] };
  const senders = senderIds
    .map((sid) => {
      const a = senderAgg.get(sid) ?? { contacted: 0, replied: 0, bounced: 0 };
      return {
        sender_id: sid,
        email: senderRows?.find((s) => s.id === sid)?.email ?? "(removed sender)",
        sent: senderSent.get(sid) ?? 0,
        contacted: a.contacted,
        reply_rate: rate(a.replied, a.contacted),
        bounce_rate: rate(a.bounced, a.contacted),
      };
    })
    .sort((a, b) => b.sent - a.sent);

  return NextResponse.json({
    steps,
    rules,
    senders,
    total: total.count ?? 0,
    sent: sentCount,
    replied: replied.count ?? 0,
    failed: failed.count ?? 0,
    pending: pending.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
    follow_ups_sent: followUpsSent.count ?? 0,
    retries_sent: retriesSent.count ?? 0,
    opens: opens.count ?? 0,
    machine_opens: machineOpens.count ?? 0,
    meetings_booked: new Set((meetingRows.data ?? []).map((m: { recipient_id: string }) => m.recipient_id)).size,
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

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import {
  sendMail,
  serversFromRow,
  SENDER_SERVER_COLUMNS,
  type SenderCreds,
  type SenderServerRow,
} from "@/lib/mail";
import { render, spin, toHtml, toPlain, missingMergeFields } from "@/lib/template";
import { inWindow, dayKey } from "@/lib/time";
import { signMessageToken, signClickUrl, appUrl, cronBearerOk } from "@/lib/tokens";
import { downloadAttachment } from "@/lib/attachment";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { warmupCapForSender } from "@/lib/warmup";
import { assertCanSend, incrementUsage, hasFeature, type Plan } from "@/lib/billing";
import { classifyError, isHardBounce } from "@/lib/errors";
import { markSenderRevoked } from "@/lib/sender-revoke";
import { isVariantArray, pickVariant, maybeAutoPromoteWinner, type Variant } from "@/lib/variants";
import { personalizeTemplate } from "@/lib/personalize";
import {
  fetchReplyContext,
  resolveDueStep,
  stepAfter,
  type FollowUpStep as ConditionalStep,
} from "@/lib/follow-up-condition";
import { checkBeforeFollowUp, saveInboundReply, type GuardVerdict } from "@/lib/followup-guard";
import { recordEvent } from "@/lib/activity";
import { decide, choiceLabel, type Decision, type EngineConfig } from "@/lib/followup-engine";
import { loadEngineConfig, engineRecipient, replyContextFor, reevaluatePending } from "@/lib/followup-rules";
import { scheduleNextNurture, cancelPending, type NurtureKind } from "@/lib/nurture";
import { loadSenderCreds, persistRefreshedToken } from "@/lib/sender-creds";
import { addDelay, withJitter } from "@/lib/sequence-schedule";
import {
  stopDomainAfterReply,
  findSuppression,
  suppressEmail,
  maybePauseForBounces,
} from "@/lib/sequence-stop";
import { dispatch as fireWebhook } from "@/lib/webhooks";
import { emitEmailSent, emitBounced, emitSequenceStopped, emitCampaignPaused, emitNeedsApproval } from "@/lib/events";
import { mapWithLimit } from "@/lib/email-validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// Tick can run for up to ~50s (one send + bookkeeping). The lease covers a
// generous 75s so a slow but completing run never lets a parallel tick in,
// while a crashed run frees automatically after 75s.
const TICK_LOCK_KEY = "emailsvia:tick";
// Must stay above the function's maxDuration (vercel.json: 120s) so a slow
// but live tick can never be overlapped by the next one.
const TICK_LOCK_TTL_SECONDS = 180;

// Transient send failures on a follow-up retry the same step this many times.
const FOLLOW_UP_MAX_ATTEMPTS = 3;
// Failed pre-send reply checks (inbox unreachable) before the sequence stops.
const GUARD_MAX_ATTEMPTS = 6;

// Parallel sending: each tick sends at most one email per campaign and per
// mailbox, for up to MAX_CAMPAIGNS_PER_TICK campaigns, SEND_CONCURRENCY at a
// time. No new slot starts after SEND_BUDGET_MS and no recipient is claimed
// after CLAIM_DEADLINE_MS, leaving the in-flight sends (SMTP/API timeouts
// are ~30s) room to finish inside maxDuration (120s).
const MAX_CAMPAIGNS_PER_TICK = 25;
const CLAIM_DEADLINE_MS = 40_000;
// A claimed-but-unfinished send (process killed mid-send) is left alone
// this long before the row is eligible again, so a crash can't turn into
// an immediate duplicate on the next tick.
const IN_FLIGHT_HOLD_MS = 2 * 60 * 60 * 1000;
// Rotation campaigns get one send per attached inbox per tick (each inbox
// respecting gap_seconds on its own), capped here.
const MAX_SENDS_PER_CAMPAIGN_TICK = 10;

// Outcomes that made progress on the list without being a hard stop; after
// one of these a rotation campaign may use its next slot in the same tick.
const CONTINUE_STATUSES = new Set([
  "sent",
  "send_failed",
  "send_failed_will_retry",
  "follow_up_failed_will_retry",
  "follow_up_step_skipped",
  "follow_up_sequence_complete",
  "follow_up_stopped_replied",
  "follow_up_stopped_bounced",
  "follow_up_paused_ooo",
  "skipped_unsubscribed",
  "skipped_suppressed",
  "skipped_missing_merge_fields",
]);
const SEND_CONCURRENCY = 6;
const SEND_BUDGET_MS = 25_000;

type TickShared = {
  planByUser: Map<string, Plan>;
  lastSendKind: Map<string, string>;
  // Mailboxes already used this tick. Checked and set with no await in
  // between, so two parallel campaigns can't grab the same sender.
  claimedSenders: Set<string>;
  claimDeadline: number;
};

type TickResult = { status?: string; [k: string]: unknown };

export async function GET(req: NextRequest) {
  if (!cronBearerOk(req.headers.get("authorization"))) return unauth();

  const db = supabaseAdmin();
  const now = new Date();

  // Only one tick at a time across the whole deployment. Without this,
  // pg_cron + a manual /api/tick curl that overlap can both pick the same
  // recipient (the per-row CAS catches most but not all races; this is the
  // belt-and-suspenders).
  const { data: gotLock, error: lockErr } = await db.rpc("try_tick_lock", {
    lock_key: TICK_LOCK_KEY,
    ttl_seconds: TICK_LOCK_TTL_SECONDS,
  });
  if (lockErr) {
    // Lock function missing (migration 0009 not applied) — fall through so
    // the app keeps working. Sentry-captured so we notice in prod; not a
    // user-facing error.
    Sentry.captureException(new Error(`tick lock unavailable: ${lockErr.message}`), {
      tags: { route: "tick", op: "lock_acquire" },
    });
  } else if (gotLock !== true) {
    return NextResponse.json({ status: "lock_held" });
  }

  try {
    return await runTick(db, now);
  } finally {
    if (!lockErr) {
      await db.rpc("release_tick_lock", { lock_key: TICK_LOCK_KEY });
    }
  }
}

async function runTick(db: ReturnType<typeof supabaseAdmin>, now: Date): Promise<NextResponse> {

  // Multi-campaign scheduler: rotate fairly across all running campaigns
  // so one long-running campaign doesn't starve the others. Pick the
  // campaign whose most recent send is the oldest (NULL = never sent = top).
  const { data: running } = await db
    .from("campaigns")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: true });

  if (!running || running.length === 0) {
    return NextResponse.json({ status: "no_running_campaign" });
  }

  // Fetch last send per running campaign in one query, then bucket client-side.
  // error_class is null only on successful sends — only those gate the per-
  // campaign gap and daily cap (a failure shouldn't make us idle 2 min).
  const campaignIds = running.map((c) => c.id);
  const { data: recentLogs } = await db
    .from("send_log")
    .select("campaign_id, sent_at, kind")
    .in("campaign_id", campaignIds)
    .is("error_class", null)
    .order("sent_at", { ascending: false });
  const lastSendMs = new Map<string, number>();
  const lastSendKind = new Map<string, string>();
  for (const row of recentLogs ?? []) {
    if (!lastSendMs.has(row.campaign_id)) {
      lastSendMs.set(row.campaign_id, new Date(row.sent_at).getTime());
      lastSendKind.set(row.campaign_id, row.kind);
    }
  }

  // Sort: never-sent first (0), then oldest-last-send first.
  running.sort((a, b) => (lastSendMs.get(a.id) ?? 0) - (lastSendMs.get(b.id) ?? 0));

  // Pre-fetch warmup state for every sender referenced by the running campaigns.
  const senderIds = Array.from(new Set(running.map((c) => c.sender_id).filter((x): x is string => !!x)));
  const warmupMap = new Map<string, { warmup_enabled: boolean; warmup_started_at: string | null }>();
  if (senderIds.length > 0) {
    const { data: sendersInfo } = await db
      .from("senders")
      .select("id, warmup_enabled, warmup_started_at")
      .in("id", senderIds);
    for (const s of sendersInfo ?? []) {
      warmupMap.set(s.id, { warmup_enabled: !!s.warmup_enabled, warmup_started_at: s.warmup_started_at });
    }
  }

  // Inbox-rotation pools for every running campaign, in one query.
  const { data: poolRows } = await db
    .from("campaign_senders")
    .select("campaign_id, sender_id")
    .in("campaign_id", campaignIds);
  const rotationByCampaign = new Map<string, string[]>();
  for (const r of poolRows ?? []) {
    rotationByCampaign.set(r.campaign_id, [...(rotationByCampaign.get(r.campaign_id) ?? []), r.sender_id]);
  }

  // Walk the sorted list — every campaign that passes ALL gates (window,
  // start_at, gap, daily cap incl. warmup) gets a send this tick, up to
  // MAX_CAMPAIGNS_PER_TICK.
  const eligibleCampaigns: Array<{ campaign: typeof running[0]; todayCount: number; slots: number }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  // Plan cache so two campaigns owned by the same user only hit the DB once.
  const planByUser = new Map<string, Plan>();
  // Plan daily allowance left per user, reserved one send per selected
  // campaign so parallel sends can't overshoot the plan cap.
  const userBudget = new Map<string, number>();
  // Senders whose warmup allowance is already spoken for this tick.
  const warmupReserved = new Map<string, number>();

  for (const c of running) {
    const tz = c.timezone || "Asia/Kolkata";

    if (!inWindow(now, tz, c.schedule, c.window_start_hour, c.window_end_hour)) {
      skipped.push({ id: c.id, name: c.name, reason: "outside_window" });
      continue;
    }
    if (c.start_at && new Date(c.start_at) > now) {
      skipped.push({ id: c.id, name: c.name, reason: "not_yet_started" });
      continue;
    }
    const rotationSize = rotationByCampaign.get(c.id)?.length ?? 0;
    // Single-sender campaigns space sends per campaign. Rotation campaigns
    // space them per inbox instead (checked when picking the sender), so N
    // inboxes can each send once a tick.
    const lastTs = rotationSize === 0 ? lastSendMs.get(c.id) : undefined;
    if (lastTs) {
      const gapMs = (c.gap_seconds ?? 120) * 1000;
      if (now.getTime() - lastTs < gapMs) {
        skipped.push({ id: c.id, name: c.name, reason: "gap_not_elapsed" });
        continue;
      }
    }
    // Plan-level daily cap (across ALL of this user's campaigns).
    // Checked BEFORE per-campaign cap so a user on Free with three running
    // campaigns can't sneak past the 50/day ceiling.
    const quota = await assertCanSend(db, c.user_id, now, tz);
    if (!quota.ok) {
      skipped.push({
        id: c.id,
        name: c.name,
        reason: quota.reason === "suspended" ? "tenant_suspended" : "plan_daily_cap_reached",
      });
      continue;
    }
    planByUser.set(c.user_id, quota.plan);
    const budget = userBudget.get(c.user_id) ?? quota.remaining;
    if (budget <= 0) {
      skipped.push({ id: c.id, name: c.name, reason: "plan_daily_cap_reached" });
      continue;
    }

    const today = dayKey(now, tz);
    const { count } = await db
      .from("send_log")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("day", today)
      .is("error_class", null);
    if ((count ?? 0) >= c.daily_cap) {
      skipped.push({ id: c.id, name: c.name, reason: "daily_cap_reached" });
      continue;
    }
    // Warmup is a property of the mailbox, so count the sender's sends
    // across ALL campaigns — two campaigns on one new inbox share one
    // allowance. (Rotation senders are checked per-sender below.)
    const warmupInfo = c.sender_id && rotationSize === 0 ? warmupMap.get(c.sender_id) : undefined;
    const warmupCap = warmupInfo ? warmupCapForSender(warmupInfo, now) : Infinity;
    if (Number.isFinite(warmupCap)) {
      const { count: senderCount } = await db
        .from("send_log")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", c.sender_id)
        .eq("day", today)
        .is("error_class", null);
      const reserved = warmupReserved.get(c.sender_id) ?? 0;
      if ((senderCount ?? 0) + reserved >= warmupCap) {
        skipped.push({ id: c.id, name: c.name, reason: "warmup_cap_reached" });
        continue;
      }
      warmupReserved.set(c.sender_id, reserved + 1);
    }

    const slots =
      rotationSize === 0
        ? 1
        : Math.max(1, Math.min(rotationSize, MAX_SENDS_PER_CAMPAIGN_TICK, budget, c.daily_cap - (count ?? 0)));
    userBudget.set(c.user_id, budget - slots);
    eligibleCampaigns.push({ campaign: c, todayCount: count ?? 0, slots });
    if (eligibleCampaigns.length >= MAX_CAMPAIGNS_PER_TICK) break;
  }

  if (eligibleCampaigns.length === 0) {
    return NextResponse.json({ status: "all_throttled", skipped });
  }

  const tickStart = Date.now();
  const shared: TickShared = {
    planByUser,
    lastSendKind,
    claimedSenders: new Set(),
    claimDeadline: tickStart + CLAIM_DEADLINE_MS,
  };
  const deadline = tickStart + SEND_BUDGET_MS;
  const perCampaign = await mapWithLimit(eligibleCampaigns, SEND_CONCURRENCY, async ({ campaign, todayCount, slots }) => {
    // Slots of one campaign run one after another (they'd race for the same
    // next recipient if run in parallel); campaigns run in parallel.
    const out: TickResult[] = [];
    let sends = 0;
    for (let i = 0; i < slots * 2 && sends < slots; i++) {
      if (Date.now() > deadline) {
        if (out.length === 0) out.push({ status: "deferred_time_budget", campaign: campaign.name });
        break;
      }
      if (i > 0) {
        // The user (or Bounce Shield) may have paused it since the last slot.
        const { data: fresh } = await db.from("campaigns").select("status").eq("id", campaign.id).maybeSingle();
        if (fresh?.status !== "running") break;
      }
      let r: TickResult;
      try {
        const res = await processCampaign(db, now, campaign, todayCount + sends, shared);
        r = (await res.json()) as TickResult;
      } catch (e) {
        // One campaign blowing up must not take the rest of the tick with it.
        Sentry.captureException(e, {
          tags: { route: "tick", op: "process_campaign" },
          contexts: { campaign: { id: campaign.id, name: campaign.name } },
        });
        r = { status: "error", campaign: campaign.name, error: e instanceof Error ? e.message : String(e) };
      }
      out.push(r);
      if (r.campaign_paused) break;
      if (r.status === "sent") {
        sends++;
        // Keep the follow-up / first-send interleave alternating across slots.
        if (typeof r.kind === "string") shared.lastSendKind.set(campaign.id, r.kind);
      }
      if (!CONTINUE_STATUSES.has(String(r.status))) break;
    }
    return out;
  });
  const results = perCampaign.flat();

  const sentCount = results.filter((r) => r.status === "sent").length;
  return NextResponse.json({
    // "sent" when anything went out (the dev burst loop keys off this).
    status: sentCount > 0 ? "sent" : results[0]?.status ?? "idle",
    sent: sentCount,
    // Single-campaign ticks keep the old flat shape (to, campaign, kind…).
    ...(results.length === 1 ? results[0] : {}),
    ...(sentCount > 0 ? { status: "sent" } : {}),
    results,
    skipped,
  });
}

async function processCampaign(
  db: ReturnType<typeof supabaseAdmin>,
  now: Date,
  campaign: Record<string, any>,
  todayCount: number,
  shared: TickShared
): Promise<NextResponse> {
  const { planByUser, lastSendKind, claimedSenders } = shared;
  const tz = campaign.timezone || "Asia/Kolkata";
  const today = dayKey(now, tz);

  // ----- resolve which sender to use for this tick -----
  //
  // Two modes:
  //   - rotation: campaign_senders has >= 1 row. Pick the least-loaded
  //     eligible sender (under its warmup cap, OAuth status ok). Lets
  //     a Scale-tier user split a 10K list across 10 connected Gmails.
  //   - single: fall back to campaigns.sender_id (the historical default).
  //
  // Follow-ups are sticky: they only go out from recipients.sender_id (the
  // mailbox that sent the first email). If that sender is attached but
  // throttled right now, the follow-up waits rather than switching.
  type SenderRow = SenderServerRow & {
    id: string;
    email: string;
    app_password: string | null;
    from_name: string | null;
    auth_method: "oauth" | "app_password";
    oauth_refresh_token: string | null;
    oauth_access_token: string | null;
    oauth_expires_at: string | null;
    oauth_status: "ok" | "revoked" | "pending";
    warmup_enabled: boolean | null;
    warmup_started_at: string | null;
  };
  function toSenderCreds(s: SenderRow): SenderCreds | null {
    if (s.auth_method === "oauth" && s.oauth_refresh_token) {
      return {
        authMethod: "oauth",
        email: s.email,
        fromName: s.from_name,
        refreshToken: decryptSecret(s.oauth_refresh_token),
        accessToken: s.oauth_access_token ? decryptSecret(s.oauth_access_token) : null,
        expiresAt: s.oauth_expires_at ? new Date(s.oauth_expires_at) : null,
        sendAs: s.send_as_email ?? null,
      };
    }
    if (s.app_password) {
      return {
        authMethod: "app_password",
        email: s.email,
        fromName: s.from_name,
        appPassword: decryptSecret(s.app_password),
        sendAs: s.send_as_email ?? null,
        ...serversFromRow(s),
      };
    }
    return null;
  }

  let sender: SenderCreds | null = null;
  let chosenSenderId: string | null = null;
  // Eligible-sender pool (for sticky-sender lookup once we know the
  // recipient). Empty in single-sender mode.
  const eligiblePool = new Map<string, SenderRow>();

  const { data: rotationRows } = await db
    .from("campaign_senders")
    .select("sender_id")
    .eq("campaign_id", campaign.id);
  const rotationIds = (rotationRows ?? []).map((r) => r.sender_id);

  if (rotationIds.length > 0) {
    const { data: senderDetails } = await db
      .from("senders")
      .select(
        `id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, warmup_enabled, warmup_started_at, ${SENDER_SERVER_COLUMNS}`
      )
      .in("id", rotationIds);

    // Per-sender today count from send_log (only successful rows).
    const { data: countsRaw } = await db
      .from("send_log")
      .select("sender_id")
      .in("sender_id", rotationIds)
      .eq("day", today)
      .is("error_class", null)
      .range(0, 99999);
    const todayBySender = new Map<string, number>();
    for (const r of countsRaw ?? []) {
      if (r.sender_id) todayBySender.set(r.sender_id, (todayBySender.get(r.sender_id) ?? 0) + 1);
    }

    // Per-inbox spacing for rotation: an inbox that sent (for any campaign)
    // within gap_seconds is cooling down this tick.
    const gapMs = (campaign.gap_seconds ?? 120) * 1000;
    const { data: recentBySender } = await db
      .from("send_log")
      .select("sender_id")
      .in("sender_id", rotationIds)
      .is("error_class", null)
      .gt("sent_at", new Date(now.getTime() - gapMs).toISOString());
    const coolingDown = new Set((recentBySender ?? []).map((r) => r.sender_id as string));

    // Filter eligible: OAuth status ok, under warmup cap, not cooling down.
    type Eligible = { row: SenderRow; sentToday: number; cap: number };
    const eligible: Eligible[] = [];
    for (const s of (senderDetails ?? []) as SenderRow[]) {
      if (s.auth_method === "oauth" && s.oauth_status !== "ok") continue;
      // Already sending for another campaign this tick, or sent too recently.
      if (claimedSenders.has(s.id) || coolingDown.has(s.id)) continue;
      const sentToday = todayBySender.get(s.id) ?? 0;
      const cap = warmupCapForSender(
        { warmup_enabled: s.warmup_enabled, warmup_started_at: s.warmup_started_at },
        now
      );
      if (sentToday >= cap) continue;
      eligible.push({ row: s, sentToday, cap });
      eligiblePool.set(s.id, s);
    }
    if (eligible.length === 0) {
      return NextResponse.json({
        status: "rotation_all_throttled",
        campaign: campaign.name,
        attached: rotationIds.length,
      });
    }
    // Sort by least-loaded; ties broken by largest remaining headroom so
    // we steer load toward whichever sender has the most room left.
    eligible.sort((a, b) => {
      if (a.sentToday !== b.sentToday) return a.sentToday - b.sentToday;
      return (b.cap - b.sentToday) - (a.cap - a.sentToday);
    });
    const picked = eligible.find((e) => !claimedSenders.has(e.row.id));
    if (!picked) {
      return NextResponse.json({ status: "senders_busy", campaign: campaign.name });
    }
    claimedSenders.add(picked.row.id);
    sender = toSenderCreds(picked.row);
    chosenSenderId = picked.row.id;
  } else if (campaign.sender_id) {
    const { data: s } = await db
      .from("senders")
      .select(
        `id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, warmup_enabled, warmup_started_at, ${SENDER_SERVER_COLUMNS}`
      )
      .eq("id", campaign.sender_id)
      .maybeSingle();
    if (s) {
      const row = s as SenderRow;
      // A revoked OAuth sender can't send — skip the tick rather than fail
      // every recipient. The user gets nudged to reconnect via the senders UI.
      if (row.auth_method === "oauth" && row.oauth_status !== "ok") {
        return NextResponse.json({ status: "sender_revoked", sender_id: campaign.sender_id });
      }
      if (claimedSenders.has(row.id)) {
        return NextResponse.json({ status: "sender_busy", campaign: campaign.name });
      }
      claimedSenders.add(row.id);
      sender = toSenderCreds(row);
      chosenSenderId = row.id;
      eligiblePool.set(row.id, row);
    }
  }

  // ----- pick next thing to send: due follow-up, then retry, then fresh -----
  // (alternating with first sends; see the interleave below)
  const nowIso = now.toISOString();
  // A pending row whose last_sent_at is recent was claimed by a send that
  // never recorded its outcome (killed mid-send); don't re-send it yet.
  const inFlightCutoff = new Date(now.getTime() - IN_FLIGHT_HOLD_MS).toISOString();
  // Assigned inside pickFollowUp/pickFirstSend; the cast stops TS narrowing
  // it to "initial" across those closures.
  // "nurture" = a follow-up to someone who already replied (scheduled_followups:
  // "not now" re-engagement, approved stalled-thread nudge).
  let kind = "initial" as "initial" | "follow_up" | "retry" | "nurture";
  let recipient: any = null;
  let step: any = null;

  // Follow-ups are a paid feature (plans.features.follow_ups). A user who
  // downgrades keeps their campaign running for first sends only.
  const campaignPlan = planByUser.get(campaign.user_id);
  const followUpsActive =
    !!campaign.follow_ups_enabled && !!campaignPlan && hasFeature(campaignPlan, "follow_ups");
  let steps: ConditionalStep[] = [];
  if (followUpsActive) {
    const { data: stepsRaw } = await db
      .from("follow_up_steps")
      .select("step_number, delay_days, delay_unit, subject, template, condition")
      .eq("campaign_id", campaign.id)
      .order("step_number", { ascending: true });
    steps = (stepsRaw ?? []) as ConditionalStep[];
  }
  // Activity-based rules (Growth/Scale: conditional_sequences). Null when the
  // campaign has none, and then everything below runs the plain step
  // sequence exactly as before.
  const engine: EngineConfig | null =
    followUpsActive && campaignPlan && hasFeature(campaignPlan, "conditional_sequences")
      ? await loadEngineConfig(db, campaign as Parameters<typeof loadEngineConfig>[1], steps)
      : null;
  // The scheduled_followups row being sent (kind "nurture" only).
  type NurtureItem = {
    id: string; kind: NurtureKind; rule_id: string | null; rule_email_id: string | null;
    anchor_reply_id: string | null; anchor_at: string; requires_approval: boolean; attempts: number;
    user_id: string; campaign_id: string; recipient_id: string;
    // Threading into the conversation they replied in.
    inReplyTo: string | null; references: string[]; subjectBase: string | null;
  };
  let nurture = null as NurtureItem | null;
  // The engine's pick for this follow-up (rules mode only). Assigned inside
  // pickByRules; the cast stops TS narrowing it to null across the closure.
  let decision = null as Extract<Decision, { kind: "send" }> | null;
  if (engine) {
    // New opens/clicks since the last check can make a rule due sooner.
    await reevaluatePending(db, campaign as { id: string; user_id: string }, engine, now);
  }

  // Returns a response when the tick is consumed without a send (step
  // skipped / sequence finished); otherwise sets recipient/kind/step.
  // Follow-ups to people who already replied, when due. Ones that need the
  // user's go-ahead are parked as needs_approval instead of sent.
  async function pickNurture(): Promise<boolean> {
    if (!followUpsActive || !campaignPlan || !hasFeature(campaignPlan, "conditional_sequences")) return false;
    // A send killed mid-flight leaves its row in 'sending'; like a claimed
    // follow-up, it's retried after the in-flight hold.
    await db
      .from("scheduled_followups")
      .update({ status: "scheduled" })
      .eq("campaign_id", campaign.id)
      .eq("status", "sending")
      .lt("updated_at", inFlightCutoff);
    const { data: parked } = await db
      .from("scheduled_followups")
      .update({ status: "needs_approval" })
      .eq("campaign_id", campaign.id)
      .eq("status", "scheduled")
      .eq("requires_approval", true)
      .is("approved_at", null)
      .lte("due_at", nowIso)
      .select("id, user_id, campaign_id, recipient_id, kind");
    for (const p of parked ?? []) {
      await recordEvent(db, {
        user_id: p.user_id, campaign_id: p.campaign_id, recipient_id: p.recipient_id,
        type: "followup_decided",
        data: { outcome: "needs_approval", kind: p.kind },
        dedupe_key: `approval:${p.id}`,
      });
      await emitNeedsApproval(db, { id: p.recipient_id, campaign_id: p.campaign_id, user_id: p.user_id }, { scheduled_id: p.id, kind: p.kind });
    }
    const { data: item } = await db
      .from("scheduled_followups")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "scheduled")
      .lte("due_at", nowIso)
      .or("requires_approval.eq.false,approved_at.not.is.null")
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!item) return false;
    const [{ data: rec }, { data: ruleEmail }, { data: anchorReply }, { data: ourLast }] = await Promise.all([
      db.from("recipients").select("*").eq("id", item.recipient_id).maybeSingle(),
      item.rule_email_id
        ? db.from("follow_up_rule_emails").select("id, subject, template, thread_mode, rule:follow_up_rules(name)").eq("id", item.rule_email_id).maybeSingle()
        : Promise.resolve({ data: null }),
      item.anchor_reply_id
        ? db.from("replies").select("message_id, subject").eq("id", item.anchor_reply_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("reply_messages").select("message_id").eq("recipient_id", item.recipient_id).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const blocked = rec?.sender_id && rotationIds.includes(rec.sender_id) && !eligiblePool.has(rec.sender_id);
    if (!rec || !ruleEmail || !["replied", "sent"].includes(rec.status)) {
      await db.from("scheduled_followups").update({ status: "cancelled", cancel_reason: !ruleEmail ? "rule_removed" : `recipient_${rec?.status ?? "missing"}` }).eq("id", item.id);
      return false;
    }
    if (blocked) return false; // its mailbox is throttled this tick; try later
    const chain = [rec.message_id, anchorReply?.message_id, item.kind === "thread_stalled" ? ourLast?.message_id : null]
      .filter((x): x is string => !!x)
      .map((m) => (m.startsWith("<") ? m : `<${m}>`));
    nurture = {
      id: item.id, kind: item.kind, rule_id: item.rule_id, rule_email_id: item.rule_email_id,
      anchor_reply_id: item.anchor_reply_id, anchor_at: item.anchor_at, requires_approval: item.requires_approval,
      attempts: item.attempts ?? 0, user_id: item.user_id, campaign_id: item.campaign_id, recipient_id: item.recipient_id,
      inReplyTo: chain[chain.length - 1] ?? null,
      references: Array.from(new Set(chain)),
      subjectBase: anchorReply?.subject ?? null,
    };
    recipient = rec;
    kind = "nurture";
    step = {
      step_number: (rec.follow_up_count ?? 0) + 1,
      subject: ruleEmail.subject,
      template: ruleEmail.template,
      thread_mode: ruleEmail.thread_mode,
      rule_id: item.rule_id,
      rule_email_id: item.rule_email_id,
      rule_name: (Array.isArray(ruleEmail.rule) ? ruleEmail.rule[0] : ruleEmail.rule)?.name ?? null,
    };
    return true;
  }

  async function pickFollowUp(): Promise<NextResponse | null> {
    if (!followUpsActive || !campaign) return null;
    if (await pickNurture()) return null;
    // Rotation senders that are attached but not eligible this tick. Their
    // recipients' follow-ups wait instead of switching mailbox.
    const blockedSenderIds = rotationIds.filter((id) => !eligiblePool.has(id));
    let dueQ = db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", nowIso);
    if (blockedSenderIds.length > 0) {
      dueQ = dueQ.or(`sender_id.is.null,sender_id.not.in.(${blockedSenderIds.join(",")})`);
    }
    const { data: due } = await dueQ
      .order("next_follow_up_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (due && engine) return pickByRules(due, engine);
    if (due) {
      // Conditions are evaluated now, when the step is due — not when the
      // previous email went out.
      const dueStep: number = due.next_step_number ?? due.follow_up_count + 1;
      const needsCtx = steps.some((s) => s.step_number >= dueStep && s.condition);
      const ctx = needsCtx
        ? await fetchReplyContext(db, due.id)
        : { hasReplied: false, lastIntent: null };
      const resolved = resolveDueStep(steps, dueStep, ctx);
      const who = { user_id: campaign.user_id, campaign_id: campaign.id, recipient_id: due.id };
      if (resolved.kind === "end") {
        await db
          .from("recipients")
          .update({ next_follow_up_at: null, next_step_number: null, stop_reason: "completed" })
          .eq("id", due.id);
        await recordEvent(db, {
          ...who,
          type: "followup_decided",
          data: { outcome: "end", due_step: dueStep, why: "no remaining step's condition matched" },
        });
        await emitSequenceStopped(db, { ...due, campaign_id: campaign.id, user_id: campaign.user_id }, "completed", due.follow_up_count ?? 0);
        return NextResponse.json({ status: "follow_up_sequence_complete", recipient: due.email });
      }
      if (resolved.kind === "defer") {
        let atDate = now;
        for (const ds of resolved.delaySteps) atDate = addDelay(atDate, ds.delay_days, ds.delay_unit, tz);
        const at = withJitter(atDate).toISOString();
        await db
          .from("recipients")
          .update({ next_follow_up_at: at, next_step_number: resolved.step.step_number })
          .eq("id", due.id);
        await recordEvent(db, {
          ...who,
          type: "followup_decided",
          data: {
            outcome: "skip",
            skipped_step: dueStep,
            next_step: resolved.step.step_number,
            next_at: at,
            why: "step condition not met",
          },
        });
        return NextResponse.json({
          status: "follow_up_step_skipped",
          recipient: due.email,
          skipped_step: dueStep,
          next_step: resolved.step.step_number,
          next_at: at,
        });
      }
      recipient = due;
      kind = "follow_up";
      step = resolved.step;
    }
    return null;
  }

  // Rules mode: ask the engine what this recipient's activity calls for.
  async function pickByRules(due: Record<string, any>, cfg: EngineConfig): Promise<NextResponse | null> {
    const who = { user_id: campaign.user_id, campaign_id: campaign.id, recipient_id: due.id as string };
    const er = await engineRecipient(db, cfg, due, now);
    const d = decide(cfg, er, await replyContextFor(db, cfg, due.id), now);
    if (d.kind === "end") {
      await db
        .from("recipients")
        .update({ next_follow_up_at: null, stop_reason: "completed", reeval_pending: false })
        .eq("id", due.id);
      await recordEvent(db, { ...who, type: "followup_decided", data: { outcome: "end", why: d.why } });
      await emitSequenceStopped(db, { ...due, campaign_id: campaign.id, user_id: campaign.user_id } as { id: string; email: string; campaign_id: string; user_id: string }, "completed", due.follow_up_count ?? 0);
      return NextResponse.json({ status: "follow_up_sequence_complete", recipient: due.email, why: d.why });
    }
    const label = choiceLabel(d.choice);
    if (d.kind === "wait") {
      const at = withJitter(d.due).toISOString();
      const patch: Record<string, unknown> = { next_follow_up_at: at, current_rule_id: label.rule_id };
      if (d.choice.source === "fallback") patch.next_step_number = d.choice.step.step_number;
      await db.from("recipients").update(patch).eq("id", due.id);
      // Log only when the plan for this person changed (a different rule).
      if ((due.current_rule_id ?? null) !== label.rule_id || (d.choice.source === "fallback" && d.choice.skippedSteps.length > 0)) {
        await recordEvent(db, {
          ...who,
          type: "followup_decided",
          data: {
            outcome: "wait",
            rule_id: label.rule_id,
            rule_name: label.rule_name,
            matched: label.matched,
            skipped_steps: d.choice.source === "fallback" ? d.choice.skippedSteps : undefined,
            next_at: at,
          },
        });
      }
      return NextResponse.json({ status: "follow_up_waiting", recipient: due.email, rule: label.rule_name, next_at: at });
    }
    decision = d;
    recipient = due;
    kind = "follow_up";
    step =
      d.choice.source === "rule"
        ? {
            // Rule emails are numbered by how many follow-ups this person has had.
            step_number: (due.follow_up_count ?? 0) + 1,
            subject: d.choice.email.subject,
            template: d.choice.email.template,
            thread_mode: d.choice.email.thread_mode,
            rule_id: d.choice.rule.id,
            rule_email_id: d.choice.email.id,
          }
        : d.choice.step;
    return null;
  }

  async function pickFirstSend(): Promise<void> {
    if (!campaign) return;
    const { data: retryR } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .gt("retry_count", 0)
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", nowIso)
      .or(`last_sent_at.is.null,last_sent_at.lt.${inFlightCutoff}`)
      .order("next_retry_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (retryR) { recipient = retryR; kind = "retry"; return; }

    const { data: fresh } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .eq("retry_count", 0)
      .or(`last_sent_at.is.null,last_sent_at.lt.${inFlightCutoff}`)
      .order("row_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fresh) { recipient = fresh; kind = "initial"; }
  }

  // Interleave: if the last send was a follow-up, give a first send the
  // next turn, so a big follow-up backlog can't stall new outreach (and new
  // outreach can't starve due follow-ups).
  if (["follow_up", "nurture"].includes(lastSendKind.get(campaign.id) ?? "")) {
    await pickFirstSend();
    if (!recipient) {
      const r = await pickFollowUp();
      if (r) return r;
    }
  } else {
    const r = await pickFollowUp();
    if (r) return r;
    if (!recipient) await pickFirstSend();
  }

  if (!recipient) {
    // Check if any follow-ups are still pending in the future — if so, keep
    // running. With follow-ups off (or not on the plan) stale schedules
    // don't count, otherwise the campaign would sit in "waiting" forever.
    const { count: upcomingRaw } = followUpsActive
      ? await db
          .from("recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("status", "sent")
          .not("next_follow_up_at", "is", null)
      : { count: 0 };
    // Follow-ups scheduled for people who replied ("not now", stalled
    // threads awaiting approval) keep the campaign open too.
    const { count: nurturePending } = followUpsActive
      ? await db
          .from("scheduled_followups")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .in("status", ["scheduled", "needs_approval", "sending"])
      : { count: 0 };
    const upcoming = (upcomingRaw ?? 0) + (nurturePending ?? 0);
    const { count: pendingRetries } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "pending");
    if ((upcoming ?? 0) === 0 && (pendingRetries ?? 0) === 0) {
      await db.from("campaigns").update({ status: "done" }).eq("id", campaign.id);
      await fireWebhook(db, {
        user_id: campaign.user_id,
        event_type: "campaign.finished",
        event_id: `finished:${campaign.id}`,
        payload: {
          campaign_id: campaign.id,
          name: campaign.name,
          finished_at: nowIso,
        },
      }, { queueOnly: true });
      return NextResponse.json({ status: "campaign_finished", campaign: campaign.name });
    }
    return NextResponse.json({ status: "waiting", upcoming_follow_ups: upcoming ?? 0 });
  }

  // Sticky-sender override: if the recipient already has a sender_id
  // (set on its first send under rotation), prefer it so follow-ups
  // come from the same from-line they saw originally. Falls back to the
  // already-picked default if the sticky sender is no longer eligible
  // (revoked, warmup-capped, removed from rotation).
  if (recipient.sender_id && recipient.sender_id !== chosenSenderId) {
    const sticky = eligiblePool.get(recipient.sender_id);
    if (sticky) {
      if (claimedSenders.has(sticky.id)) {
        // Another campaign grabbed that mailbox after we built the pool.
        // Follow-ups wait for it; a first send just goes next tick.
        return NextResponse.json({ status: "sender_busy", campaign: campaign.name, to: recipient.email });
      }
      const candidate = toSenderCreds(sticky);
      if (candidate) {
        if (chosenSenderId) claimedSenders.delete(chosenSenderId);
        claimedSenders.add(sticky.id);
        sender = candidate;
        chosenSenderId = sticky.id;
      }
    }
  }

  // Identity used by webhook events below.
  const rcpt = { id: recipient.id as string, email: recipient.email as string, campaign_id: campaign.id as string, user_id: campaign.user_id as string };
  // Activity-log identity + the email this attempt is about.
  const who = { user_id: rcpt.user_id, campaign_id: rcpt.campaign_id, recipient_id: rcpt.id };
  // Follow-ups and nurture emails send a step's / rule email's content.
  const usesStep = kind === "follow_up" || kind === "nurture";
  const stepNo: number = usesStep ? step.step_number : 0;
  // Nurture bookkeeping lives on its scheduled_followups row, never on the
  // recipient's sequence fields (the person already replied).
  const setNurture = async (patch: Record<string, unknown>) => {
    if (nurture) await db.from("scheduled_followups").update(patch).eq("id", nurture.id);
  };

  // skip if this user has unsubscribed this address (per-user list)
  const { data: unsub } = await db
    .from("unsubscribes")
    .select("email")
    .eq("user_id", campaign.user_id)
    .eq("email", recipient.email)
    .maybeSingle();
  if (unsub) {
    await db
      .from("recipients")
      .update({ status: "unsubscribed", next_follow_up_at: null, stop_reason: recipient.stop_reason ?? "unsubscribed" })
      .eq("id", recipient.id);
    await setNurture({ status: "cancelled", cancel_reason: "unsubscribed" });
    if (kind === "follow_up") {
      await emitSequenceStopped(db, rcpt, "unsubscribed", recipient.follow_up_count ?? 0);
    } else {
      await recordEvent(db, { ...who, type: "skipped", data: { reason: "unsubscribed" }, dedupe_key: "skipped:unsubscribed" });
    }
    return NextResponse.json({ status: "skipped_unsubscribed", to: recipient.email });
  }
  // Do-not-contact list (bounced addresses, blocked domains), all campaigns.
  const suppressed = await findSuppression(db, campaign.user_id, recipient.email);
  if (suppressed && nurture) {
    await setNurture({ status: "cancelled", cancel_reason: "suppressed" });
    await recordEvent(db, { ...who, type: "skipped", step_number: stepNo, data: { reason: "suppressed", by: suppressed.kind, kind: "nurture" } });
    return NextResponse.json({ status: "skipped_suppressed", to: recipient.email, by: suppressed.kind });
  }
  if (suppressed) {
    await db
      .from("recipients")
      .update(
        kind === "follow_up"
          ? { next_follow_up_at: null, stop_reason: "suppressed" }
          : { status: "skipped", stop_reason: "suppressed", next_retry_at: null, error: `suppressed_${suppressed.kind}` }
      )
      .eq("id", recipient.id);
    if (kind === "follow_up") {
      await emitSequenceStopped(db, rcpt, "suppressed", recipient.follow_up_count ?? 0, {
        by: suppressed.kind,
        list_reason: suppressed.reason,
      });
    } else {
      await recordEvent(db, {
        ...who,
        type: "skipped",
        data: { reason: "suppressed", by: suppressed.kind, list_reason: suppressed.reason },
        dedupe_key: "skipped:suppressed",
      });
    }
    return NextResponse.json({ status: "skipped_suppressed", to: recipient.email, by: suppressed.kind });
  }

  // ---- pre-send reply / bounce / out-of-office guard (follow-ups only) ----
  // Ask the mailbox directly instead of trusting the 5-minute reply poll.
  // Fails closed: if we can't check, we don't send and try again later.
  if (usesStep && sender) {
    // A nurture email only cares about mail newer than the point it was
    // scheduled from (their "not now", or your last answer).
    const since = nurture
      ? new Date(new Date(nurture.anchor_at).getTime() + 1000)
      : new Date(new Date(recipient.sent_at ?? recipient.last_sent_at ?? nowIso).getTime() - 60_000);
    let verdict: Awaited<ReturnType<typeof checkBeforeFollowUp>>["verdict"] | undefined;
    const { data: autoRows } = await db
      .from("replies")
      .select("message_id")
      .eq("recipient_id", recipient.id)
      .eq("is_auto_reply", true)
      .not("message_id", "is", null);
    const knownAutoReplyIds = new Set((autoRows ?? []).map((r) => r.message_id as string));
    // Which inbox the guard is reading, so a failure is pinned on that one.
    let checking: { id: string | null; email: string } = { id: chosenSenderId, email: sender.email };
    try {
      // The reply lands in the inbox that sent the first email. Normally
      // that's the sender we're about to use; if the campaign switched
      // sender since, check the original inbox too.
      const inboxes: Array<{ id: string | null; creds: SenderCreds }> = [{ id: chosenSenderId, creds: sender }];
      if (recipient.sender_id && recipient.sender_id !== chosenSenderId) {
        const original = await loadSenderCreds(db, recipient.sender_id);
        if (original?.creds && !original.oauthRevoked) inboxes.push({ id: original.id, creds: original.creds });
      }
      for (const inbox of inboxes) {
        checking = { id: inbox.id, email: inbox.creds.email };
        const out = await checkBeforeFollowUp({
          sender: inbox.creds,
          recipientEmail: recipient.email,
          since,
          now,
          knownAutoReplyIds,
        });
        if (inbox.id) await persistRefreshedToken(db, inbox.id, out.tokensRefreshed);
        if (!verdict || verdict.kind === "clear" || (verdict.kind === "ooo" && out.verdict.kind !== "clear")) {
          verdict = out.verdict;
        }
        if (verdict.kind === "replied" || verdict.kind === "bounced") break;
      }
    } catch (e) {
      const errorClass = classifyError(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (checking.id && errorClass === "auth_revoked") {
        await markSenderRevoked(db, {
          sender_id: checking.id,
          sender_email: checking.email,
          user_id: campaign.user_id,
        });
      }
      Sentry.captureException(e, {
        tags: { route: "tick", op: "followup_guard", error_class: errorClass },
        contexts: { recipient: { id: recipient.id }, inbox: { id: checking.id, email: checking.email } },
      });
      if (nurture) {
        const attempts = nurture.attempts + 1;
        const giveUp = attempts >= GUARD_MAX_ATTEMPTS;
        const retryAt = new Date(now.getTime() + 30 * 60 * 1000 * attempts).toISOString();
        await setNurture(
          giveUp
            ? { status: "failed", attempts, error: `Couldn't check ${checking.email} for a reply: ${msg}`.slice(0, 500) }
            : { due_at: retryAt, attempts, error: msg.slice(0, 500) }
        );
        await recordEvent(db, {
          ...who, type: "send_failed", step_number: stepNo,
          data: { stage: "reply_check", kind: "nurture", error_class: errorClass, error: msg.slice(0, 300), inbox: checking.email, will_retry: !giveUp, retry_at: giveUp ? null : retryAt },
        });
        return NextResponse.json({ status: giveUp ? "nurture_failed_guard" : "nurture_guard_failed", to: recipient.email, error_class: errorClass });
      }
      // Retry with backoff, but don't loop forever on a permanent problem
      // (IMAP disabled, wrong IMAP host): after GUARD_MAX_ATTEMPTS the
      // sequence stops with a visible reason instead of hanging silently.
      const attempts = (recipient.follow_up_attempts ?? 0) + 1;
      const giveUp = attempts >= GUARD_MAX_ATTEMPTS;
      const retryAt = new Date(now.getTime() + 30 * 60 * 1000 * attempts).toISOString();
      const error = `Couldn't check ${checking.email} for a reply before the follow-up: ${msg}`.slice(0, 500);
      await db
        .from("recipients")
        .update(
          giveUp
            ? { next_follow_up_at: null, stop_reason: "guard_failed", follow_up_attempts: attempts, error }
            : { next_follow_up_at: retryAt, follow_up_attempts: attempts, error }
        )
        .eq("id", recipient.id);
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        step_number: stepNo,
        data: {
          stage: "reply_check",
          error_class: errorClass,
          error: msg.slice(0, 300),
          inbox: checking.email,
          will_retry: !giveUp,
          retry_at: giveUp ? null : retryAt,
        },
      });
      if (giveUp) await emitSequenceStopped(db, rcpt, "guard_failed", recipient.follow_up_count ?? 0);
      return NextResponse.json({
        status: giveUp ? "follow_up_stopped_guard_failed" : "follow_up_guard_failed",
        to: recipient.email,
        error_class: errorClass,
        ...(giveUp ? {} : { retry_at: retryAt }),
      });
    }

    const guard: GuardVerdict = verdict ?? { kind: "clear" };
    const owner = { recipient_id: recipient.id, campaign_id: campaign.id, user_id: campaign.user_id };
    // They wrote again (or are away) since this nurture email was scheduled.
    if (nurture && (guard.kind === "replied" || guard.kind === "ooo")) {
      const saved = await saveInboundReply(db, owner, guard.message, guard.kind === "ooo", now);
      if (saved?.created) {
        await recordEvent(db, {
          ...who,
          type: saved.is_auto_reply ? "auto_replied" : "replied",
          occurred_at: guard.message.date ?? now,
          data: { reply_id: saved.id, via: "pre_send_check", from_email: guard.message.from, subject: guard.message.subject?.slice(0, 300), snippet: guard.message.snippet?.slice(0, 300) },
          dedupe_key: `reply:${saved.id}`,
        });
        if (!saved.is_auto_reply) {
          await fireWebhook(db, {
            user_id: campaign.user_id,
            event_type: "reply.received",
            event_id: saved.id,
            payload: { reply_id: saved.id, campaign_id: campaign.id, recipient_id: recipient.id, from_email: guard.message.from, subject: guard.message.subject, snippet: guard.message.snippet, received_at: guard.message.date?.toISOString() ?? null },
          }, { queueOnly: true });
        }
      }
      if (guard.kind === "ooo") {
        await setNurture({ due_at: guard.resumeAt.toISOString() });
        return NextResponse.json({ status: "nurture_paused_ooo", to: recipient.email, resume_at: guard.resumeAt.toISOString() });
      }
      // A human message since this was scheduled (or one we couldn't store):
      // don't send. A stored message relabelled as an auto-reply isn't one.
      if (!saved || !saved.is_auto_reply) {
        await cancelPending(db, recipient.id, { anchoredBefore: guard.message.date ?? now, reason: "they_replied" });
        await setNurture({ status: "cancelled", cancel_reason: "they_replied" });
        return NextResponse.json({ status: "nurture_cancelled_replied", to: recipient.email });
      }
    }
    if (nurture && guard.kind === "bounced") {
      await setNurture({ status: "cancelled", cancel_reason: "bounced" });
    }
    if (guard.kind === "replied" && !nurture) {
      const saved = await saveInboundReply(db, owner, guard.message, false, now);
      const replyId = saved?.id ?? null;
      if (saved) {
        await recordEvent(db, {
          ...who,
          type: saved.is_auto_reply ? "auto_replied" : "replied",
          occurred_at: guard.message.date ?? now,
          data: {
            reply_id: saved.id,
            via: "pre_send_check",
            from_email: guard.message.from,
            subject: guard.message.subject?.slice(0, 300),
            snippet: guard.message.snippet?.slice(0, 300),
          },
          dedupe_key: `reply:${saved.id}`,
        });
      }
      await db
        .from("recipients")
        .update({
          status: "replied",
          replied_at: (guard.message.date ?? now).toISOString(),
          next_follow_up_at: null,
          stop_reason: "replied",
        })
        .eq("id", recipient.id)
        .eq("status", "sent");
      if (replyId && saved?.created) {
        await fireWebhook(db, {
          user_id: campaign.user_id,
          event_type: "reply.received",
          event_id: replyId,
          payload: {
            reply_id: replyId,
            campaign_id: campaign.id,
            recipient_id: recipient.id,
            from_email: guard.message.from,
            subject: guard.message.subject,
            snippet: guard.message.snippet,
            received_at: guard.message.date?.toISOString() ?? null,
          },
        }, { queueOnly: true });
      }
      await emitSequenceStopped(db, rcpt, "replied", recipient.follow_up_count ?? 0);
      const domainStopped = campaign.stop_on_domain_reply !== false
        ? await stopDomainAfterReply(db, campaign.id, { id: recipient.id, email: recipient.email })
        : 0;
      return NextResponse.json({
        status: "follow_up_stopped_replied",
        to: recipient.email,
        domain_stopped: domainStopped,
      });
    }
    if (guard.kind === "bounced") {
      await db
        .from("recipients")
        .update({
          status: "bounced",
          next_follow_up_at: null,
          stop_reason: "bounced",
          error: `bounce: ${guard.message.subject ?? "delivery failure"}`.slice(0, 500),
        })
        .eq("id", recipient.id)
        .eq("status", "sent");
      await suppressEmail(db, campaign.user_id, recipient.email, "bounced", campaign.id);
      await emitBounced(db, rcpt, [guard.message.subject, guard.message.snippet].filter(Boolean).join(" · "), { source: "dsn" });
      await emitSequenceStopped(db, rcpt, "bounced", recipient.follow_up_count ?? 0);
      const shielded = await maybePauseForBounces(db, campaign.id);
      return NextResponse.json({
        status: "follow_up_stopped_bounced",
        to: recipient.email,
        ...(shielded ? { campaign_paused: "bounce_rate" } : {}),
      });
    }
    if (guard.kind === "sender_auth") {
      // A receiver bounced an earlier email because our domain failed
      // SPF/DKIM/DMARC. Same handling as a synchronous rejection.
      await db
        .from("campaigns")
        .update({ status: "paused", paused_reason: "sender_auth" })
        .eq("id", campaign.id)
        .eq("status", "running");
      await emitCampaignPaused(db, campaign as { id: string; user_id: string; name: string }, "sender_auth");
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        data: {
          stage: "delivery",
          error_class: "sender_auth",
          detail: guard.message.subject?.slice(0, 300),
          campaign_paused: true,
        },
      });
      return NextResponse.json({
        status: "campaign_paused_sender_auth",
        campaign: campaign.name,
        campaign_paused: "sender_auth",
        to: recipient.email,
      });
    }
    if (guard.kind === "ooo") {
      const saved = await saveInboundReply(db, owner, guard.message, true, now);
      await db
        .from("recipients")
        .update({ next_follow_up_at: guard.resumeAt.toISOString() })
        .eq("id", recipient.id);
      if (saved) {
        await recordEvent(db, {
          ...who,
          type: "auto_replied",
          occurred_at: guard.message.date ?? now,
          data: {
            reply_id: saved.id,
            via: "pre_send_check",
            subject: guard.message.subject?.slice(0, 300),
            snippet: guard.message.snippet?.slice(0, 300),
          },
          dedupe_key: `reply:${saved.id}`,
        });
      }
      await recordEvent(db, {
        ...who,
        type: "sequence_paused",
        data: { reason: "out_of_office", until: guard.resumeAt.toISOString(), step: stepNo },
        dedupe_key: `paused:ooo:${guard.resumeAt.toISOString().slice(0, 10)}`,
      });
      return NextResponse.json({
        status: "follow_up_paused_ooo",
        to: recipient.email,
        resume_at: guard.resumeAt.toISOString(),
      });
    }
  }

  // sender is null only if the campaign has no sender_id AND no rotation.
  // Checked before claiming so a misconfigured campaign doesn't park rows.
  if (!sender) {
    return NextResponse.json({
      status: "no_sender_configured",
      campaign: campaign.name,
      message: "Campaign has no sender attached. Pick one on /app/senders or in the campaign editor.",
    });
  }

  // Too late in the tick to start a send that must finish inside maxDuration.
  if (Date.now() > shared.claimDeadline) {
    return NextResponse.json({ status: "deferred_time_budget", campaign: campaign.name });
  }

  // ATOMIC CLAIM — optimistic compare-and-set on last_sent_at so only one
  // concurrent tick wins and sends this recipient. It also marks the row
  // in flight: pending rows with a recent last_sent_at are skipped by the
  // pickers, and a claimed follow-up is pushed IN_FLIGHT_HOLD_MS out. Every
  // outcome path below overwrites these, so only a killed process leaves
  // them, and then the row waits instead of being sent twice.
  if (nurture) {
    const { data: claim } = await db
      .from("scheduled_followups")
      .update({ status: "sending" })
      .eq("id", nurture.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claim) return NextResponse.json({ status: "claim_lost", to: recipient.email, kind });
  } else {
    const prior = recipient.last_sent_at;
    let q = db
      .from("recipients")
      .update({ last_sent_at: nowIso })
      .eq("id", recipient.id)
      .eq("status", "pending");
    if (kind === "follow_up") {
      q = db
        .from("recipients")
        .update({
          last_sent_at: nowIso,
          next_follow_up_at: new Date(now.getTime() + IN_FLIGHT_HOLD_MS).toISOString(),
        })
        .eq("id", recipient.id)
        .eq("status", "sent")
        .eq("follow_up_count", recipient.follow_up_count);
    }
    // CAS on last_sent_at value
    q = prior === null ? q.is("last_sent_at", null) : q.eq("last_sent_at", prior);
    const { data: claim } = await q.select("id").maybeSingle();
    if (!claim) {
      return NextResponse.json({ status: "claim_lost", to: recipient.email, kind });
    }
  }

  // This attempt's send_log id, picked up front so the tracking pixel, click
  // links and unsubscribe link inside the email can point at this exact
  // email. Every outcome below writes at most one send_log row, with this id.
  const sendLogId = randomUUID();

  // ---- render ----
  const vars = { ...(recipient.vars ?? {}), Name: recipient.name, Company: recipient.company };

  // ---- A/B variant pick (initial / retry sends only) ----
  // Follow-ups inherit the recipient's pinned variant via recipients.variant_id;
  // they don't re-roll. If the campaign has variants and the recipient has
  // no pin yet, we pick now and persist on success.
  let effectiveSubject: string = campaign.subject;
  let effectiveTemplate: string = campaign.template;
  let pickedVariantId: string | null = recipient.variant_id ?? null;
  // A/B testing is plan-gated here too: variants can be written directly
  // through RLS, and a downgraded plan stops splitting (main copy is used).
  const abAllowed = !!planByUser.get(campaign.user_id) && hasFeature(planByUser.get(campaign.user_id)!, "a_b_testing");
  // Someone a prospect referred you to: a "referred" rule supplies their
  // first email (e.g. "{{Referred By}} suggested I reach out").
  let referralRule: { id: string; name: string } | null = null;
  if (
    !usesStep &&
    recipient.referred_by_recipient_id &&
    campaignPlan &&
    hasFeature(campaignPlan, "conditional_sequences")
  ) {
    const { data: ref } = await db
      .from("follow_up_rules")
      .select("id, name, emails:follow_up_rule_emails(subject, template, position)")
      .eq("campaign_id", campaign.id)
      .eq("enabled", true)
      .contains("situations", ["referred"])
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const first = (ref?.emails ?? []).sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0];
    if (ref && first) {
      effectiveSubject = first.subject || campaign.subject;
      effectiveTemplate = first.template;
      referralRule = { id: ref.id, name: ref.name };
    }
  }
  if (!usesStep && !referralRule && abAllowed && isVariantArray(campaign.variants)) {
    const variants = campaign.variants as Variant[];
    const sticky = pickedVariantId
      ? variants.find((v) => v.id === pickedVariantId) ?? null
      : null;
    const chosen = sticky ?? pickVariant(variants, campaign.ab_winner_id ?? null);
    if (chosen) {
      effectiveSubject = chosen.subject;
      effectiveTemplate = chosen.template;
      pickedVariantId = chosen.id;
    }
  }

  // Spintax is resolved first, seeded per recipient + step, so a retry or
  // a later preview produces the same wording that was actually sent.
  const spinSeed = `${recipient.id}:${usesStep ? step.step_number : 0}`;
  const rawSubjectPreAi = spin(
    usesStep && step.subject
      ? step.subject
      : nurture?.subjectBase ?? effectiveSubject,
    `${spinSeed}:subject`
  );
  const templateSrcPreAi = spin(usesStep ? step.template : effectiveTemplate, spinSeed);

  // ---- AI personalization ({{ai:...}} tags) ----
  // Plan-gated. Free / Starter users with AI tags in their template get
  // them silently expanded to empty string (the strict_merge gate above
  // doesn't see {{ai:...}} as a missing merge tag because the ai: prefix
  // is excluded from extractTags).
  const planForUser = planByUser.get(campaign.user_id);
  const aiEnabled = planForUser ? hasFeature(planForUser, "ai_personalization") : false;
  const personalizedBody = await personalizeTemplate(templateSrcPreAi, vars, {
    db,
    recipient_id: recipient.id,
    user_id: campaign.user_id,
    enabled: aiEnabled,
  });
  const personalizedSubject = await personalizeTemplate(rawSubjectPreAi, vars, {
    db,
    recipient_id: recipient.id,
    user_id: campaign.user_id,
    enabled: aiEnabled,
  });
  const rawSubject = personalizedSubject.rendered;
  const templateSrc = personalizedBody.rendered;

  // Threaded follow-ups always carry exactly one "Re:" on the subject that
  // actually goes out (step override or original).
  // A rule email can start a fresh thread (its own subject, no Re:).
  const threaded = usesStep && step?.thread_mode !== "new";
  const subject =
    threaded && (nurture ? !!nurture.inReplyTo : recipient.message_id)
      ? `Re: ${rawSubject.replace(/^re:\s*/i, "")}`
      : rawSubject;

  // Hard-fail merge validation. If strict_merge is on and the template
  // references a tag that resolves empty for this row, skip without
  // sending. Mailmeteor would mail "Hey ," — the #1 G2 complaint.
  if (campaign.strict_merge !== false) {
    const subjectMissing = missingMergeFields(rawSubject, vars);
    const bodyMissing = missingMergeFields(templateSrc, vars);
    const allMissing = Array.from(new Set([...subjectMissing, ...bodyMissing]));
    if (allMissing.length > 0) {
      const errMsg = `missing_merge_field:${allMissing.join(",")}`;
      // Initial sends → status='skipped' so the row doesn't loop. Follow-ups
      // → leave status='sent' but clear the next_follow_up_at so we don't
      // try the same step again. Nurture → only its scheduled row fails.
      if (nurture) {
        await setNurture({ status: "failed", error: errMsg });
      } else if (kind === "follow_up") {
        await db
          .from("recipients")
          .update({ next_follow_up_at: null, error: errMsg, stop_reason: "merge_failed" })
          .eq("id", recipient.id);
        await emitSequenceStopped(db, rcpt, "merge_failed", recipient.follow_up_count ?? 0);
      } else {
        await db
          .from("recipients")
          .update({ status: "skipped", error: errMsg })
          .eq("id", recipient.id);
      }
      // Audit row in send_log so admin metrics + the campaign timeline
      // record the skip without inflating success counts.
      await db.from("send_log").insert({
        id: sendLogId,
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        user_id: campaign.user_id,
        sender_id: chosenSenderId,
        kind,
        step_number: usesStep ? step.step_number : null,
        rule_id: usesStep ? step.rule_id ?? null : null,
        rule_email_id: usesStep ? step.rule_email_id ?? null : null,
        sent_at: nowIso,
        day: today,
        error_class: "missing_merge_field",
      });
      await recordEvent(db, {
        ...who,
        type: "skipped",
        send_log_id: sendLogId,
        step_number: stepNo,
        data: { reason: "missing_merge_field", missing: allMissing },
        dedupe_key: `send:${sendLogId}`,
      });
      return NextResponse.json({
        status: "skipped_missing_merge_fields",
        to: recipient.email,
        kind,
        missing: allMissing,
      });
    }
  }

  const body = render(templateSrc, vars);

  const base = appUrl();
  const unsubToken = campaign.unsubscribe_enabled ? signMessageToken("u", recipient.id, sendLogId) : null;
  // Footer link → human confirm page. Header → RFC 8058 one-click POST
  // endpoint (the page route can't accept POST).
  const unsubUrl = unsubToken ? `${base}/u/${unsubToken}` : undefined;
  const oneClickUnsubUrl = unsubToken ? `${base}/api/unsubscribe?token=${unsubToken}` : undefined;
  const openPixelUrl = campaign.tracking_enabled
    ? `${base}/api/t/o/${signMessageToken("o", recipient.id, sendLogId)}.gif`
    : undefined;
  const wrapUrl = campaign.tracking_enabled
    ? (url: string) => {
        const t = signMessageToken("c", recipient.id, sendLogId);
        return `${base}/api/t/c/${t}?u=${encodeURIComponent(url)}&s=${signClickUrl(t, url)}`;
      }
    : undefined;

  const html = toHtml(body, { wrapUrl, openPixelUrl, unsubscribeUrl: unsubUrl });
  const text = toPlain(body, { unsubscribeUrl: unsubUrl });

  // ---- attachments (up to 5 files per campaign) ----
  let attachments: { filename: string; content: Buffer }[] | undefined;
  const paths: string[] = campaign.attachment_paths ?? [];
  const names: string[] = campaign.attachment_filenames ?? [];
  if (paths.length > 0) {
    const loaded = await Promise.all(
      paths.map((p, i) => downloadAttachment(db, p, names[i] ?? "attachment"))
    );
    const ok = loaded.filter((x): x is { filename: string; content: Buffer } => !!x);
    if (ok.length > 0) attachments = ok;
  } else if (campaign.attachment_path && campaign.attachment_filename) {
    // legacy single-attachment fallback (for campaigns not yet migrated)
    const att = await downloadAttachment(db, campaign.attachment_path, campaign.attachment_filename);
    if (att) attachments = [att];
  }

  // ---- headers ----
  const headers: Record<string, string> = {};
  if (oneClickUnsubUrl) {
    headers["List-Unsubscribe"] = `<${oneClickUnsubUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  // Thread follow-ups as replies to the initial message so Gmail groups them.
  // RFC 5322 requires Message-IDs to be angle-bracket wrapped.
  if (threaded && nurture?.inReplyTo) {
    // Continue the conversation they replied in.
    headers["In-Reply-To"] = nurture.inReplyTo;
    headers["References"] = nurture.references.join(" ");
  } else if (threaded && !nurture && recipient.message_id) {
    const normalized = recipient.message_id.startsWith("<")
      ? recipient.message_id
      : `<${recipient.message_id}>`;
    headers["In-Reply-To"] = normalized;
    headers["References"] = normalized;
  }

  // ---- send ----
  let sentMessageId: string | null = null;
  let sentThreadId: string | null = null;
  let sentProviderId: string | null = null;
  let smtpResponse: string | null = null;
  // Gmail thread ids are per-mailbox, so only reuse it from the same sender.
  const threadId =
    threaded && recipient.gmail_thread_id && recipient.sender_id === chosenSenderId
      ? recipient.gmail_thread_id
      : null;
  try {
    const result = await sendMail({ to: recipient.email, subject, text, html, sender, attachments, headers, threadId });
    sentMessageId = result.messageId;
    sentThreadId = result.threadId ?? null;
    sentProviderId = result.providerMessageId ?? null;
    smtpResponse = result.response ?? null;
    // Persist any refreshed OAuth access token so the next tick doesn't have
    // to round-trip through Google again. Update the sender that actually
    // ran (chosenSenderId), which may differ from campaign.sender_id under
    // rotation.
    if (chosenSenderId && result.tokensRefreshed) {
      await db
        .from("senders")
        .update({
          oauth_access_token: encryptSecret(result.tokensRefreshed.accessToken),
          oauth_expires_at: result.tokensRefreshed.expiresAt.toISOString(),
        })
        .eq("id", chosenSenderId);
    }
  } catch (e: unknown) {
    // invalid_grant means Google revoked our refresh token. Mark the sender
    // so the tick gate above starts skipping it instead of retrying every
    // minute, and surface it in the UI.
    const msg = e instanceof Error ? e.message : String(e);
    const errorClass = classifyError(e);
    if (chosenSenderId && errorClass === "auth_revoked") {
      await markSenderRevoked(db, {
        sender_id: chosenSenderId,
        sender_email: sender?.email ?? "",
        user_id: campaign.user_id,
      });
    }
    // Send to Sentry with structured tags so the dashboard can group by
    // error_class / sender / campaign without the message string carrying
    // all the cardinality.
    Sentry.captureException(e, {
      tags: { route: "tick", kind, error_class: errorClass },
      contexts: {
        campaign: { id: campaign.id, name: campaign.name, user_id: campaign.user_id },
        recipient: { id: recipient.id, email: recipient.email },
      },
    });
    // The receiving server rejected the sender's domain authentication
    // (SPF/DKIM/DMARC). Every further send would bounce the same way and burn
    // reputation, so pause the campaign and leave the recipient untouched;
    // the user fixes DNS (Senders → Check DNS) and resumes.
    if (errorClass === "sender_auth") {
      await db
        .from("campaigns")
        .update({ status: "paused", paused_reason: "sender_auth" })
        .eq("id", campaign.id)
        .eq("status", "running");
      await emitCampaignPaused(db, campaign as { id: string; user_id: string; name: string }, "sender_auth");
      if (nurture) await setNurture({ status: "scheduled", due_at: nowIso, error: msg.slice(0, 500) });
      else await db
        .from("recipients")
        .update(
          kind === "follow_up"
            ? { error: `Paused: receiver rejected sender authentication. ${msg}`.slice(0, 500), next_follow_up_at: nowIso }
            : { error: `Paused: receiver rejected sender authentication. ${msg}`.slice(0, 500), last_sent_at: null }
        )
        .eq("id", recipient.id);
      await db.from("send_log").insert({
        id: sendLogId,
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        user_id: campaign.user_id,
        sender_id: chosenSenderId,
        kind,
        step_number: usesStep ? step.step_number : null,
        rule_id: usesStep ? step.rule_id ?? null : null,
        rule_email_id: usesStep ? step.rule_email_id ?? null : null,
        sent_at: nowIso,
        day: today,
        error_class: errorClass,
      });
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        send_log_id: sendLogId,
        step_number: stepNo,
        data: { error_class: errorClass, error: msg.slice(0, 300), campaign_paused: true, will_retry: true },
        dedupe_key: `send:${sendLogId}`,
      });
      return NextResponse.json({
        status: "campaign_paused_sender_auth",
        campaign: campaign.name,
        to: recipient.email,
        error: msg,
      });
    }
    if (nurture) {
      const attempts = nurture.attempts + 1;
      const authProblem = errorClass === "auth_revoked" || errorClass === "auth_failed";
      const permanent = isHardBounce(e);
      const retry = !permanent && (authProblem || attempts < FOLLOW_UP_MAX_ATTEMPTS);
      const retryAt = new Date(now.getTime() + (authProblem ? 60 : 30 * attempts) * 60 * 1000).toISOString();
      await setNurture(
        retry
          ? { status: "scheduled", due_at: retryAt, attempts: authProblem ? nurture.attempts : attempts, error: msg.slice(0, 500) }
          : { status: "failed", attempts, error: msg.slice(0, 500) }
      );
      await db.from("send_log").insert({
        id: sendLogId,
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        user_id: campaign.user_id,
        sender_id: chosenSenderId,
        kind,
        step_number: step.step_number,
        rule_id: step.rule_id ?? null,
        rule_email_id: step.rule_email_id ?? null,
        sent_at: nowIso,
        day: today,
        error_class: errorClass,
      });
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        send_log_id: sendLogId,
        step_number: stepNo,
        data: { kind: "nurture", error_class: errorClass, error: msg.slice(0, 300), will_retry: retry, retry_at: retry ? retryAt : null },
        dedupe_key: `send:${sendLogId}`,
      });
      if (permanent) {
        await suppressEmail(db, campaign.user_id, recipient.email, "bounced", campaign.id);
        await emitBounced(db, rcpt, msg, { source: "smtp", send_log_id: sendLogId, step: stepNo });
      }
      return NextResponse.json({ status: retry ? "nurture_failed_will_retry" : "send_failed", to: recipient.email, kind, error: msg, error_class: errorClass });
    }
    // Follow-up failures: auth problems wait for the mailbox to be fixed
    // (the sequence isn't the recipient's fault); transient errors retry the
    // same step up to FOLLOW_UP_MAX_ATTEMPTS; a rejected address ends it.
    if (kind === "follow_up") {
      const attempts = (recipient.follow_up_attempts ?? 0) + 1;
      const authProblem = errorClass === "auth_revoked" || errorClass === "auth_failed";
      const permanent = isHardBounce(e);
      const retry = !permanent && (authProblem || attempts < FOLLOW_UP_MAX_ATTEMPTS);
      const retryAt = new Date(
        now.getTime() + (authProblem ? 60 : 30 * attempts) * 60 * 1000
      ).toISOString();
      await db
        .from("recipients")
        .update(
          retry
            ? {
                next_follow_up_at: retryAt,
                follow_up_attempts: authProblem ? recipient.follow_up_attempts ?? 0 : attempts,
                error: msg,
              }
            : {
                status: permanent ? "bounced" : recipient.status,
                next_follow_up_at: null,
                stop_reason: permanent ? "bounced" : "send_failed",
                error: msg,
              }
        )
        .eq("id", recipient.id);
      await db.from("send_log").insert({
        id: sendLogId,
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        user_id: campaign.user_id,
        sender_id: chosenSenderId,
        kind,
        step_number: step.step_number,
        rule_id: step.rule_id ?? null,
        rule_email_id: step.rule_email_id ?? null,
        sent_at: nowIso,
        day: today,
        error_class: errorClass,
      });
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        send_log_id: sendLogId,
        step_number: stepNo,
        data: { error_class: errorClass, error: msg.slice(0, 300), will_retry: retry, retry_at: retry ? retryAt : null },
        dedupe_key: `send:${sendLogId}`,
      });
      if (permanent) {
        await suppressEmail(db, campaign.user_id, recipient.email, "bounced", campaign.id);
        await emitBounced(db, rcpt, msg, { source: "smtp", send_log_id: sendLogId, step: stepNo });
        await maybePauseForBounces(db, campaign.id);
      }
      if (!retry) await emitSequenceStopped(db, rcpt, permanent ? "bounced" : "send_failed", recipient.follow_up_count ?? 0);
      return NextResponse.json({
        status: retry ? "follow_up_failed_will_retry" : "send_failed",
        to: recipient.email,
        kind,
        error: msg,
        error_class: errorClass,
        ...(retry ? { retry_at: retryAt } : {}),
      });
    }
    // retry logic for initial + retry kinds
    if (campaign.retry_enabled && !isHardBounce(e) && recipient.retry_count < campaign.max_retries) {
      const nextRetry = new Date(now.getTime() + 30 * 60 * 1000 * (recipient.retry_count + 1));
      await db
        .from("recipients")
        .update({
          retry_count: recipient.retry_count + 1,
          next_retry_at: nextRetry.toISOString(),
          error: msg,
          last_sent_at: null, // not in flight any more
        })
        .eq("id", recipient.id);
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        step_number: stepNo,
        data: { error_class: errorClass, error: msg.slice(0, 300), will_retry: true, retry_at: nextRetry.toISOString() },
        dedupe_key: `send:${sendLogId}`,
      });
      return NextResponse.json({
        status: "send_failed_will_retry",
        to: recipient.email,
        retry_count: recipient.retry_count + 1,
        next_retry_at: nextRetry.toISOString(),
        error_class: errorClass,
      }, { status: 200 });
    }
    // no retry — mark failed (bounced + suppressed when the address itself
    // was rejected, so no other campaign mails it again)
    const hard = isHardBounce(e);
    await db
      .from("recipients")
      .update(hard ? { status: "bounced", stop_reason: "bounced", error: msg } : { status: "failed", error: msg })
      .eq("id", recipient.id);
    // Log the failure into send_log so admin metrics group by error_class
    // can compute error rate without scanning recipients.
    await db.from("send_log").insert({
      id: sendLogId,
      campaign_id: campaign.id,
      recipient_id: recipient.id,
      user_id: campaign.user_id,
      sender_id: chosenSenderId,
      kind,
      step_number: null,
      sent_at: nowIso,
      day: today,
      error_class: errorClass,
    });
    if (hard) {
      await suppressEmail(db, campaign.user_id, recipient.email, "bounced", campaign.id);
      await emitBounced(db, rcpt, msg, { source: "smtp", send_log_id: sendLogId, step: stepNo });
      await maybePauseForBounces(db, campaign.id);
    } else {
      await recordEvent(db, {
        ...who,
        type: "send_failed",
        send_log_id: sendLogId,
        step_number: stepNo,
        data: { error_class: errorClass, error: msg.slice(0, 300), will_retry: false },
        dedupe_key: `send:${sendLogId}`,
      });
    }
    return NextResponse.json({ status: "send_failed", to: recipient.email, kind, error: msg, error_class: errorClass }, { status: 200 });
  }

  // ---- success updates ----
  if (nurture) {
    // Their sequence fields stay as they are; only note we wrote.
    await db.from("recipients").update({ last_sent_at: nowIso, error: null }).eq("id", recipient.id);
  } else if (kind === "initial" || kind === "retry") {
    const update: Record<string, unknown> = {
      status: "sent",
      sent_at: nowIso,
      last_sent_at: nowIso,
      error: null,
      next_retry_at: null,
    };
    // Capture Message-ID so follow-ups can thread to it (store angle-bracketed)
    if (sentMessageId && !recipient.message_id) {
      update.message_id = sentMessageId.startsWith("<") ? sentMessageId : `<${sentMessageId}>`;
    }
    if (sentThreadId && !recipient.gmail_thread_id) {
      update.gmail_thread_id = sentThreadId;
    }
    // Sticky-sender pin: record which sender delivered the first email
    // (first try or a retry) so follow-ups come from the same from-line and
    // Gmail thread. Never overwritten once set.
    if (chosenSenderId && !recipient.sender_id) {
      update.sender_id = chosenSenderId;
    }
    // A/B variant pin — same logic. If the campaign uses variants and
    // this is the first send, record which variant the recipient saw
    // so follow-ups (and stats) can attribute correctly.
    if (pickedVariantId && !recipient.variant_id) {
      update.variant_id = pickedVariantId;
    }
    // Schedule the first follow-up. Its condition is checked when it
    // comes due, not now.
    const first = followUpsActive ? stepAfter(steps, 0) : null;
    if (engine) {
      // Rules mode: first check when whichever rule matches a fresh
      // recipient (usually "didn't open") is due. A later open/click
      // re-decides through reeval_pending.
      const after = { ...recipient, follow_up_count: 0, sent_at: nowIso, last_sent_at: nowIso, next_step_number: first?.step_number ?? null, sent_rule_email_ids: [] };
      const next = decide(engine, await engineRecipient(db, engine, after, now), { hasReplied: false, lastIntent: null }, now);
      update.next_step_number = first?.step_number ?? null;
      if (next.kind !== "end") {
        update.next_follow_up_at = withJitter(next.due).toISOString();
        update.current_rule_id = choiceLabel(next.choice).rule_id;
      }
    } else if (first) {
      update.next_follow_up_at = withJitter(addDelay(now, first.delay_days, first.delay_unit, tz)).toISOString();
      update.next_step_number = first.step_number;
    }
    await db.from("recipients").update(update).eq("id", recipient.id);
  } else if (kind === "follow_up" && engine && decision) {
    // Rules mode: record progress, then ask the engine when to look again.
    const choice = decision.choice;
    const nextStepNumber =
      choice.source === "fallback"
        ? stepAfter(steps, choice.step.step_number)?.step_number ?? null
        : recipient.next_step_number ?? null;
    const sentRuleEmailIds: string[] =
      choice.source === "rule"
        ? [...(recipient.sent_rule_email_ids ?? []), choice.email.id]
        : recipient.sent_rule_email_ids ?? [];
    const after = {
      ...recipient,
      follow_up_count: recipient.follow_up_count + 1,
      last_sent_at: nowIso,
      next_step_number: nextStepNumber,
      sent_rule_email_ids: sentRuleEmailIds,
    };
    const next = decide(engine, await engineRecipient(db, engine, after, now), await replyContextFor(db, engine, recipient.id), now);
    await db
      .from("recipients")
      .update({
        follow_up_count: recipient.follow_up_count + 1,
        last_sent_at: nowIso,
        next_step_number: nextStepNumber,
        sent_rule_email_ids: sentRuleEmailIds,
        current_rule_id: choiceLabel(choice).rule_id,
        next_follow_up_at: next.kind === "end" ? null : withJitter(next.due).toISOString(),
        ...(next.kind === "end" ? { stop_reason: "completed" } : {}),
        reeval_pending: false,
        follow_up_attempts: 0,
        error: null,
      })
      .eq("id", recipient.id);
    if (next.kind === "end") {
      await emitSequenceStopped(db, rcpt, "completed", recipient.follow_up_count ?? 0, { why: next.why });
    }
  } else if (kind === "follow_up") {
    const next = stepAfter(steps, step.step_number);
    await db
      .from("recipients")
      .update({
        follow_up_count: recipient.follow_up_count + 1,
        last_sent_at: nowIso,
        next_follow_up_at: next
          ? withJitter(addDelay(now, next.delay_days, next.delay_unit, tz)).toISOString()
          : null,
        next_step_number: next?.step_number ?? null,
        ...(next ? {} : { stop_reason: "completed" }),
        follow_up_attempts: 0,
        error: null,
      })
      .eq("id", recipient.id);
    if (!next) await emitSequenceStopped(db, rcpt, "completed", recipient.follow_up_count ?? 0);
  }

  const normalizedMessageId = sentMessageId
    ? sentMessageId.startsWith("<") ? sentMessageId : `<${sentMessageId}>`
    : null;
  // send_log first: the activity-log entry references it.
  await db.from("send_log").insert({
    id: sendLogId,
    campaign_id: campaign.id,
    recipient_id: recipient.id,
    user_id: campaign.user_id,
    sender_id: chosenSenderId,
    kind,
    step_number: usesStep ? step.step_number : null,
    rule_id: usesStep ? step.rule_id ?? null : null,
    rule_email_id: usesStep ? step.rule_email_id ?? null : null,
    sent_at: nowIso,
    day: today,
    message_id: normalizedMessageId,
    provider_message_id: sentProviderId,
    smtp_response: smtpResponse?.slice(0, 500) ?? null,
  });

  await emitEmailSent(db, rcpt, {
    kind,
    step: stepNo,
    sender_email: sender.email,
    message_id: sentMessageId,
    send_log_id: sendLogId,
    subject,
    thread_id: sentThreadId ?? (usesStep ? recipient.gmail_thread_id ?? null : null),
    variant_id: pickedVariantId,
    smtp_response: smtpResponse,
    detail: referralRule
      ? { rule_id: referralRule.id, rule_name: referralRule.name, because: ["referred"] }
      : nurture
      ? { rule_id: nurture.rule_id, rule_name: step?.rule_name ?? null, because: [nurture.kind === "not_now" ? "replied_not_now" : "thread_stalled"], thread_mode: step?.thread_mode ?? "same" }
      : decision
      ? (() => {
          const l = choiceLabel(decision.choice);
          return { rule_id: l.rule_id, rule_name: l.rule_name, because: l.matched, thread_mode: step?.thread_mode ?? "same" };
        })()
      : undefined,
  });

  if (nurture) {
    await setNurture({ status: "sent", sent_at: nowIso, send_log_id: sendLogId, error: null });
    await scheduleNextNurture(db, nurture, now, tz);
  }

  // A/B auto-pick: re-evaluate every 20 first sends once a threshold is set.
  if (
    !usesStep &&
    pickedVariantId &&
    !campaign.ab_winner_id &&
    campaign.ab_winner_threshold &&
    (todayCount + 1) % 20 === 0
  ) {
    await maybeAutoPromoteWinner(db, campaign as Parameters<typeof maybeAutoPromoteWinner>[1]);
  }

  // Per-user daily usage counter (gated against plan.daily_cap on the next
  // tick). Off by ±1 under heavy contention is fine — send_log is the
  // authoritative audit and Phase 4's advisory lock removes the race.
  await incrementUsage(db, campaign.user_id, today);

  return NextResponse.json({
    status: "sent",
    kind,
    to: recipient.email,
    campaign: campaign.name,
    sent_today: (todayCount ?? 0) + 1,
  });
}

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail, type SenderCreds } from "@/lib/mail";
import { render, toHtml, toPlain, missingMergeFields } from "@/lib/template";
import { inWindow, dayKey } from "@/lib/time";
import { signToken, appUrl, cronBearerOk } from "@/lib/tokens";
import { downloadAttachment } from "@/lib/attachment";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { warmupCapForSender } from "@/lib/warmup";
import { assertCanSend, incrementUsage, hasFeature, type Plan } from "@/lib/billing";
import { classifyError } from "@/lib/errors";
import { markSenderRevoked } from "@/lib/sender-revoke";
import { isVariantArray, pickVariant, type Variant } from "@/lib/variants";
import { personalizeTemplate } from "@/lib/personalize";
import {
  fetchReplyContext,
  nextEligibleStep,
  type Condition,
  type FollowUpStep as ConditionalStep,
} from "@/lib/follow-up-condition";
import { dispatch as fireWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// Tick can run for up to ~50s (one send + bookkeeping). The lease covers a
// generous 75s so a slow but completing run never lets a parallel tick in,
// while a crashed run frees automatically after 75s.
const TICK_LOCK_KEY = "emailsvia:tick";
const TICK_LOCK_TTL_SECONDS = 75;

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
    .select("campaign_id, sent_at")
    .in("campaign_id", campaignIds)
    .is("error_class", null)
    .order("sent_at", { ascending: false });
  const lastSendMs = new Map<string, number>();
  for (const row of recentLogs ?? []) {
    if (!lastSendMs.has(row.campaign_id)) {
      lastSendMs.set(row.campaign_id, new Date(row.sent_at).getTime());
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

  // Walk the sorted list — first campaign that passes ALL gates (window,
  // start_at, gap, daily cap incl. warmup) wins the tick.
  let campaign: typeof running[0] | null = null;
  let todayCount = 0;
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  // Plan cache so two campaigns owned by the same user only hit the DB once.
  const planByUser = new Map<string, Plan>();

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
    const lastTs = lastSendMs.get(c.id);
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
      skipped.push({ id: c.id, name: c.name, reason: "plan_daily_cap_reached" });
      continue;
    }
    planByUser.set(c.user_id, quota.plan);

    const today = dayKey(now, tz);
    const { count } = await db
      .from("send_log")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("day", today)
      .is("error_class", null);
    // Warmup-aware effective cap: min(campaign cap, today's warmup allowance).
    const warmupInfo = c.sender_id ? warmupMap.get(c.sender_id) : undefined;
    const warmupCap = warmupInfo ? warmupCapForSender(warmupInfo, now) : Infinity;
    const effectiveCap = Math.min(c.daily_cap, warmupCap);
    if ((count ?? 0) >= effectiveCap) {
      skipped.push({
        id: c.id,
        name: c.name,
        reason: warmupCap < c.daily_cap ? "warmup_cap_reached" : "daily_cap_reached",
      });
      continue;
    }

    campaign = c;
    todayCount = count ?? 0;
    break;
  }

  if (!campaign) {
    return NextResponse.json({ status: "all_throttled", skipped });
  }

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
  // Note: rotation applies to follow-ups + retries too. Recipients may
  // therefore see a follow-up come from a different address than the
  // original — Gmail threading still works (it's Message-ID based) but
  // the from-line will differ. Sticky-sender per recipient is a future
  // improvement (would need recipients.sender_id).
  type SenderRow = {
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
      };
    }
    if (s.app_password) {
      return {
        authMethod: "app_password",
        email: s.email,
        fromName: s.from_name,
        appPassword: decryptSecret(s.app_password),
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
        "id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, warmup_enabled, warmup_started_at"
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

    // Filter eligible: OAuth status ok, under warmup cap.
    type Eligible = { row: SenderRow; sentToday: number; cap: number };
    const eligible: Eligible[] = [];
    for (const s of (senderDetails ?? []) as SenderRow[]) {
      if (s.auth_method === "oauth" && s.oauth_status !== "ok") continue;
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
    const picked = eligible[0];
    sender = toSenderCreds(picked.row);
    chosenSenderId = picked.row.id;
  } else if (campaign.sender_id) {
    const { data: s } = await db
      .from("senders")
      .select(
        "id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, warmup_enabled, warmup_started_at"
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
      sender = toSenderCreds(row);
      chosenSenderId = row.id;
      eligiblePool.set(row.id, row);
    }
  }

  // ----- pick next thing to send: follow-up > retry > fresh -----
  const nowIso = now.toISOString();
  let kind: "initial" | "follow_up" | "retry" = "initial";
  let recipient: any = null;
  let step: any = null;

  if (campaign.follow_ups_enabled) {
    const { data: due } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", nowIso)
      .order("next_follow_up_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (due) {
      recipient = due;
      kind = "follow_up";
      const { data: s } = await db
        .from("follow_up_steps")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("step_number", due.follow_up_count + 1)
        .maybeSingle();
      if (!s) {
        // no step defined → clear schedule, move on
        await db.from("recipients").update({ next_follow_up_at: null }).eq("id", due.id);
        return NextResponse.json({ status: "follow_up_step_missing", recipient: due.email });
      }
      step = s;
    }
  }

  if (!recipient) {
    const { data: retryR } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .gt("retry_count", 0)
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", nowIso)
      .order("next_retry_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (retryR) { recipient = retryR; kind = "retry"; }
  }

  if (!recipient) {
    const { data: fresh } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .eq("retry_count", 0)
      .order("row_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fresh) { recipient = fresh; kind = "initial"; }
  }

  if (!recipient) {
    // Check if any follow-ups are still pending in the future — if so, keep running
    const { count: upcoming } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null);
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
      });
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
      const candidate = toSenderCreds(sticky);
      if (candidate) {
        sender = candidate;
        chosenSenderId = sticky.id;
      }
    }
  }

  // skip if this user has unsubscribed this address (per-user list)
  const { data: unsub } = await db
    .from("unsubscribes")
    .select("email")
    .eq("user_id", campaign.user_id)
    .eq("email", recipient.email)
    .maybeSingle();
  if (unsub) {
    await db.from("recipients").update({ status: "unsubscribed", next_follow_up_at: null }).eq("id", recipient.id);
    return NextResponse.json({ status: "skipped_unsubscribed", to: recipient.email });
  }

  // ATOMIC CLAIM — optimistic compare-and-set on last_sent_at so only one
  // concurrent tick wins and sends this recipient. Prevents duplicate-sends
  // if pg_cron + manual curl fire close together or SMTP is slow.
  {
    const prior = recipient.last_sent_at;
    let q = db
      .from("recipients")
      .update({ last_sent_at: nowIso })
      .eq("id", recipient.id)
      .eq("status", "pending");
    if (kind === "follow_up") {
      q = db
        .from("recipients")
        .update({ last_sent_at: nowIso })
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

  // ---- render ----
  const vars = { ...(recipient.vars ?? {}), Name: recipient.name, Company: recipient.company };
  // For the "Re:" prefix decision, look at the original campaign subject (the
  // one the thread was opened with). A step-level subject override doesn't
  // change whether this is a reply to the original thread.
  const threadSubject = campaign.subject;

  // ---- A/B variant pick (initial / retry sends only) ----
  // Follow-ups inherit the recipient's pinned variant via recipients.variant_id;
  // they don't re-roll. If the campaign has variants and the recipient has
  // no pin yet, we pick now and persist on success.
  let effectiveSubject: string = campaign.subject;
  let effectiveTemplate: string = campaign.template;
  let pickedVariantId: string | null = recipient.variant_id ?? null;
  if (kind !== "follow_up" && isVariantArray(campaign.variants)) {
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

  const rawSubjectPreAi = kind === "follow_up" && step.subject ? step.subject : effectiveSubject;
  const templateSrcPreAi = kind === "follow_up" ? step.template : effectiveTemplate;

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

  const subject =
    kind === "follow_up" && recipient.message_id && !/^re:\s/i.test(threadSubject)
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
      // try the same step again.
      if (kind === "follow_up") {
        await db
          .from("recipients")
          .update({ next_follow_up_at: null, error: errMsg })
          .eq("id", recipient.id);
      } else {
        await db
          .from("recipients")
          .update({ status: "skipped", error: errMsg })
          .eq("id", recipient.id);
      }
      // Audit row in send_log so admin metrics + the campaign timeline
      // record the skip without inflating success counts.
      await db.from("send_log").insert({
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        user_id: campaign.user_id,
        sender_id: chosenSenderId,
        kind,
        step_number: kind === "follow_up" ? step.step_number : null,
        sent_at: nowIso,
        day: today,
        error_class: "missing_merge_field",
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
  const unsubUrl = campaign.unsubscribe_enabled ? `${base}/u/${signToken("u", recipient.id)}` : undefined;
  const openPixelUrl = campaign.tracking_enabled
    ? `${base}/api/t/o/${signToken("o", recipient.id)}.gif`
    : undefined;
  const wrapUrl = campaign.tracking_enabled
    ? (url: string) => `${base}/api/t/c/${signToken("c", recipient.id)}?u=${encodeURIComponent(url)}`
    : undefined;

  // Free-tier watermark: appended to body (HTML + plain) at the same site
  // as the unsubscribe footer / tracking pixel. Plan was already resolved
  // in the AI-personalization step above (planForUser).
  const watermark = !!planForUser?.watermark;
  const html = toHtml(body, { wrapUrl, openPixelUrl, unsubscribeUrl: unsubUrl, watermark });
  const text = toPlain(body, { unsubscribeUrl: unsubUrl, watermark });

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
  if (unsubUrl) {
    headers["List-Unsubscribe"] = `<${unsubUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  // Thread follow-ups as replies to the initial message so Gmail groups them.
  // RFC 5322 requires Message-IDs to be angle-bracket wrapped.
  if (kind === "follow_up" && recipient.message_id) {
    const normalized = recipient.message_id.startsWith("<")
      ? recipient.message_id
      : `<${recipient.message_id}>`;
    headers["In-Reply-To"] = normalized;
    headers["References"] = normalized;
  }

  // ---- send ----
  // sender is null only if the campaign has no sender_id AND no rotation.
  // We bail with a status the operator can act on, rather than mailing
  // from anywhere unexpected.
  if (!sender) {
    return NextResponse.json({
      status: "no_sender_configured",
      campaign: campaign.name,
      message: "Campaign has no sender attached. Pick one on /app/senders or in the campaign editor.",
    });
  }
  let sentMessageId: string | null = null;
  try {
    const result = await sendMail({ to: recipient.email, subject, text, html, sender, attachments, headers });
    sentMessageId = result.messageId;
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
    // retry logic (applies to initial + retry kinds; follow-up failures just log and move on)
    if (kind !== "follow_up" && campaign.retry_enabled && recipient.retry_count < campaign.max_retries) {
      const nextRetry = new Date(now.getTime() + 30 * 60 * 1000 * (recipient.retry_count + 1));
      await db
        .from("recipients")
        .update({
          retry_count: recipient.retry_count + 1,
          next_retry_at: nextRetry.toISOString(),
          error: msg,
        })
        .eq("id", recipient.id);
      return NextResponse.json({
        status: "send_failed_will_retry",
        to: recipient.email,
        retry_count: recipient.retry_count + 1,
        next_retry_at: nextRetry.toISOString(),
        error_class: errorClass,
      }, { status: 200 });
    }
    // no retry — mark failed
    await db
      .from("recipients")
      .update({
        status: kind === "follow_up" ? recipient.status : "failed",
        next_follow_up_at: kind === "follow_up" ? null : recipient.next_follow_up_at,
        error: msg,
      })
      .eq("id", recipient.id);
    // Log the failure into send_log so admin metrics group by error_class
    // can compute error rate without scanning recipients.
    await db.from("send_log").insert({
      campaign_id: campaign.id,
      recipient_id: recipient.id,
      user_id: campaign.user_id,
      sender_id: chosenSenderId,
      kind,
      step_number: kind === "follow_up" ? step.step_number : null,
      sent_at: nowIso,
      day: today,
      error_class: errorClass,
    });
    return NextResponse.json({ status: "send_failed", to: recipient.email, kind, error: msg, error_class: errorClass }, { status: 200 });
  }

  // ---- success updates ----
  if (kind === "initial" || kind === "retry") {
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
    // Sticky-sender pin: record which sender ran the initial so future
    // follow-ups land from the same from-line. Only set on initial; if
    // the row already has a sender_id we don't overwrite (a later
    // rotation re-pin would confuse the recipient).
    if (kind === "initial" && chosenSenderId && !recipient.sender_id) {
      update.sender_id = chosenSenderId;
    }
    // A/B variant pin — same logic. If the campaign uses variants and
    // this is the first send, record which variant the recipient saw
    // so follow-ups (and stats) can attribute correctly.
    if (kind === "initial" && pickedVariantId && !recipient.variant_id) {
      update.variant_id = pickedVariantId;
    }
    // Schedule first follow-up if enabled, honouring per-step conditions.
    // Conditional steps may skip ahead (eg "only if no_reply") — we walk
    // the sequence and pick the first eligible step.
    if (campaign.follow_ups_enabled) {
      const nextTs = await scheduleNextFollowUp(db, campaign.id, recipient.id, 1, now);
      if (nextTs) update.next_follow_up_at = nextTs;
    }
    await db.from("recipients").update(update).eq("id", recipient.id);
  } else if (kind === "follow_up") {
    const nextTs = await scheduleNextFollowUp(
      db,
      campaign.id,
      recipient.id,
      recipient.follow_up_count + 2,
      now
    );
    await db
      .from("recipients")
      .update({
        follow_up_count: recipient.follow_up_count + 1,
        last_sent_at: nowIso,
        next_follow_up_at: nextTs,
        error: null,
      })
      .eq("id", recipient.id);
  }

  await db.from("send_log").insert({
    campaign_id: campaign.id,
    recipient_id: recipient.id,
    user_id: campaign.user_id,
    sender_id: chosenSenderId,
    kind,
    step_number: kind === "follow_up" ? step.step_number : null,
    sent_at: nowIso,
    day: today,
  });

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

// Schedule the next eligible follow-up for `recipient_id`, starting from
// `fromStep`. Walks the user's full sequence and picks the first step
// whose `condition` matches the recipient's current reply state. Returns
// the ISO timestamp to set on `next_follow_up_at`, or null when no
// remaining step applies (e.g. all gated by "no_reply" but they replied).
async function scheduleNextFollowUp(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string,
  recipientId: string,
  fromStep: number,
  now: Date
): Promise<string | null> {
  const { data: stepsRaw } = await db
    .from("follow_up_steps")
    .select("step_number, delay_days, subject, template, condition")
    .eq("campaign_id", campaignId)
    .order("step_number", { ascending: true });
  const steps = (stepsRaw ?? []) as ConditionalStep[];
  if (steps.length === 0) return null;
  const ctx = await fetchReplyContext(db, recipientId);
  const next = nextEligibleStep(steps, fromStep, ctx);
  if (!next) return null;
  return new Date(now.getTime() + next.delayDays * 86_400_000).toISOString();
}

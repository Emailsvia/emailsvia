import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchIncomingMessages } from "@/lib/replies";
import { serversFromRow, SENDER_SERVER_COLUMNS } from "@/lib/mail";
import { listInboxSince } from "@/lib/gmail";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { cronBearerOk } from "@/lib/tokens";
import { classifyError, classifyDsn } from "@/lib/errors";
import { classifyReply } from "@/lib/triage";
import { mapWithLimit } from "@/lib/email-validator";
import { markSenderRevoked } from "@/lib/sender-revoke";
import { dispatch as fireWebhook } from "@/lib/webhooks";
import { loadReplyPollUserIds } from "@/lib/user-settings";
import { OOO_PAUSE_DAYS } from "@/lib/followup-guard";
import { emitBounced, emitSequenceStopped, emitCampaignPaused } from "@/lib/events";
import { getAiProvider } from "@/lib/ai-provider";
import { applyIntentActions } from "@/lib/reply-actions";
import { stopDomainAfterReply, suppressEmail, maybePauseForBounces } from "@/lib/sequence-stop";
import type { IncomingMessage } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeMsgId(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  return t.startsWith("<") ? t : `<${t.replace(/^[<\s]+|[>\s]+$/g, "")}>`;
}

// Same lease-based lock pattern as /api/tick. Two cron deliveries that
// overlap (manual curl + pg_cron) would otherwise both poll Gmail, race
// on senders.oauth_access_token, and double-charge Anthropic for the
// classification calls.
const CHECK_REPLIES_LOCK_KEY = "emailsvia:check-replies";
const CHECK_REPLIES_LOCK_TTL_SECONDS = 55;

export async function GET(req: NextRequest) {
  if (!cronBearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: gotLock, error: lockErr } = await db.rpc("try_tick_lock", {
    lock_key: CHECK_REPLIES_LOCK_KEY,
    ttl_seconds: CHECK_REPLIES_LOCK_TTL_SECONDS,
  });
  if (!lockErr && gotLock !== true) {
    return NextResponse.json({ status: "lock_held" });
  }

  try {
    return await runCheckReplies(db);
  } finally {
    if (!lockErr) {
      await db.rpc("release_tick_lock", { lock_key: CHECK_REPLIES_LOCK_KEY });
    }
  }
}

async function runCheckReplies(db: ReturnType<typeof supabaseAdmin>): Promise<NextResponse> {
  const { data: allSenders } = await db
    .from("senders")
    .select(
      `id, email, app_password, user_id, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, ${SENDER_SERVER_COLUMNS}`
    );
  if (!allSenders || allSenders.length === 0) return NextResponse.json({ status: "no_senders" });

  // Reply polling is opt-in per user (user_settings.poll_replies). Anyone
  // who hasn't flipped it on is skipped here so we don't hit Gmail or
  // burn AI triage budget on inboxes nobody asked us to watch.
  const enabledUsers = await loadReplyPollUserIds(
    allSenders.map((s) => s.user_id).filter((id): id is string => !!id)
  );
  const senders = allSenders.filter((s) => s.user_id && enabledUsers.has(s.user_id));
  if (senders.length === 0) return NextResponse.json({ status: "no_opted_in_users" });

  const since = new Date(Date.now() - 7 * 86400 * 1000);
  const results: Array<{
    sender: string;
    checked: number;
    matched_by_thread: number;
    matched_by_from: number;
    skipped_auto: number;
    skipped_bounce: number;
    saved: number;
    marked_replied: number;
  }> = [];

  // Replies saved this run that don't yet have an AI intent label.
  // Function-scoped so the post-loop triage pass can see them.
  const pendingClassify: Array<{
    reply_id: string;
    user_id: string;
    subject: string | null;
    body: string | null;
  }> = [];

  for (const s of senders) {
    let messages;
    try {
      if (s.auth_method === "oauth") {
        if (s.oauth_status !== "ok" || !s.oauth_refresh_token) {
          // Skip revoked senders entirely — counts as 0 checked.
          results.push({
            sender: s.email, checked: 0,
            matched_by_thread: 0, matched_by_from: 0,
            skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: 0,
          });
          continue;
        }
        const out = await listInboxSince(
          {
            email: s.email,
            refreshToken: decryptSecret(s.oauth_refresh_token),
            accessToken: s.oauth_access_token ? decryptSecret(s.oauth_access_token) : null,
            expiresAt: s.oauth_expires_at ? new Date(s.oauth_expires_at) : null,
          },
          since
        );
        messages = out.messages;
        if (out.tokensRefreshed) {
          await db
            .from("senders")
            .update({
              oauth_access_token: encryptSecret(out.tokensRefreshed.accessToken),
              oauth_expires_at: out.tokensRefreshed.expiresAt.toISOString(),
            })
            .eq("id", s.id);
        }
      } else if (s.app_password) {
        messages = await fetchIncomingMessages(
          {
            email: s.email,
            appPassword: decryptSecret(s.app_password),
            imap: serversFromRow(s).imap,
          },
          since
        );
      } else {
        // Sender has neither app password nor refresh token — misconfigured row.
        results.push({
          sender: s.email, checked: 0,
          matched_by_thread: 0, matched_by_from: 0,
          skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: 0,
        });
        continue;
      }
    } catch (e) {
      const errorClass = classifyError(e);
      if (s.auth_method === "oauth" && errorClass === "auth_revoked") {
        await markSenderRevoked(db, {
          sender_id: s.id,
          sender_email: s.email,
          user_id: s.user_id,
        });
      }
      Sentry.captureException(e, {
        tags: { route: "check_replies", auth_method: s.auth_method, error_class: errorClass },
        contexts: { sender: { id: s.id, email: s.email } },
      });
      results.push({
        sender: s.email, checked: 0,
        matched_by_thread: 0, matched_by_from: 0,
        skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: -1,
      });
      continue;
    }
    if (messages.length === 0) {
      results.push({
        sender: s.email, checked: 0,
        matched_by_thread: 0, matched_by_from: 0,
        skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: 0,
      });
      continue;
    }

    // Campaigns this sender sends for: its own single-sender campaigns plus
    // any where it's in the rotation pool (replies land in whichever inbox
    // sent the first email).
    const [{ data: campaignRows }, { data: rotationRows }] = await Promise.all([
      db.from("campaigns").select("id, stop_on_domain_reply").eq("sender_id", s.id),
      db.from("campaign_senders").select("campaign_id").eq("sender_id", s.id),
    ]);
    const campaignIds = Array.from(
      new Set([
        ...(campaignRows ?? []).map((c) => c.id as string),
        ...(rotationRows ?? []).map((r) => r.campaign_id as string),
      ])
    );
    // Recipients this inbox could hear back from:
    //   - everyone it actually emailed (recipients.sender_id pinned to it),
    //     in any campaign, even if the campaign has since switched sender
    //   - legacy rows with no pin, in campaigns it's attached to
    // Only sent/replied rows can plausibly get a reply. Newest first so the
    // email fallback maps an address to the most recent campaign.
    const recipientCols = "id, email, campaign_id, status, message_id, sender_id, sent_at, follow_up_count";
    const [{ data: pinnedRows }, { data: legacyRows }] = await Promise.all([
      db
        .from("recipients")
        .select(recipientCols)
        .eq("sender_id", s.id)
        .in("status", ["sent", "replied"])
        .order("sent_at", { ascending: false, nullsFirst: false })
        .range(0, 99999),
      campaignIds.length > 0
        ? db
            .from("recipients")
            .select(recipientCols)
            .in("campaign_id", campaignIds)
            .is("sender_id", null)
            .in("status", ["sent", "replied"])
            .order("sent_at", { ascending: false, nullsFirst: false })
            .range(0, 99999)
        : Promise.resolve({ data: [] as Array<{ id: string; email: string; campaign_id: string; status: string; message_id: string | null; sender_id: string | null; sent_at: string | null; follow_up_count: number }> }),
    ]);
    const recipientsRows = [...(pinnedRows ?? []), ...(legacyRows ?? [])].sort(
      (x, y) => new Date(y.sent_at ?? 0).getTime() - new Date(x.sent_at ?? 0).getTime()
    );
    if (recipientsRows.length === 0) {
      results.push({
        sender: s.email, checked: messages.length,
        matched_by_thread: 0, matched_by_from: 0,
        skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: 0,
      });
      continue;
    }

    // Company-level stop flag for every campaign those recipients belong to.
    const domainStopByCampaign = new Map<string, boolean>();
    for (const c of campaignRows ?? []) domainStopByCampaign.set(c.id, c.stop_on_domain_reply !== false);
    const missingFlags = Array.from(new Set(recipientsRows.map((r) => r.campaign_id))).filter(
      (id) => !domainStopByCampaign.has(id)
    );
    if (missingFlags.length > 0) {
      const { data: extra } = await db
        .from("campaigns")
        .select("id, stop_on_domain_reply")
        .in("id", missingFlags);
      for (const c of extra ?? []) domainStopByCampaign.set(c.id, c.stop_on_domain_reply !== false);
    }

    // Two indexes: by message_id (authoritative — this is a genuine thread reply)
    // and by email (fallback — used only when the reply also carries SOME
    // In-Reply-To/References, which rules out unrelated mail from that address).
    type Hit = { id: string; email: string; campaign_id: string; status: string; follow_up_count: number };
    const byMsgId = new Map<string, Hit>();
    const byEmail = new Map<string, Hit>();
    const byId = new Map<string, Hit>();
    for (const r of recipientsRows) {
      const entry: Hit = { id: r.id, email: r.email, campaign_id: r.campaign_id, status: r.status, follow_up_count: r.follow_up_count ?? 0 };
      byId.set(r.id, entry);
      const mid = normalizeMsgId(r.message_id);
      if (mid && !byMsgId.has(mid)) byMsgId.set(mid, entry);
      const lo = r.email.toLowerCase();
      if (!byEmail.has(lo)) byEmail.set(lo, entry);
    }

    let savedCount = 0;
    let matchedByThread = 0;
    let matchedByFrom = 0;
    let skippedAuto = 0;
    let skippedBounce = 0;
    const repliedRecipientIds = new Set<string>();
    const bouncedRecipientIds = new Set<string>();
    // Campaigns whose mail a receiver rejected for failed SPF/DKIM/DMARC.
    const senderAuthCampaigns = new Set<string>();
    // recipient id → latest out-of-office date seen this run.
    const oooByRecipient = new Map<string, Date>();

    for (const msg of messages) {
      // Skip bounces (mailer-daemon / DSNs) — those aren't from the recipient
      // at all, so counting them as a "reply" is factually wrong. Everything
      // else is kept, including auto-replies / OOO / vacation responders —
      // the owner wants to see every inbound signal, not just "active" ones.
      if (msg.is_bounce) {
        // Auto-Submitted: auto-generated from the recipient's own address is
        // an auto-responder, not a DSN — fall through and treat it as one.
        if (!byEmail.has(msg.from)) {
          skippedBounce++;
          const target = matchBounce(msg, byMsgId, byEmail);
          if (target) {
            const dsn = classifyDsn(msg.subject, msg.body_text);
            if (dsn === "hard" && target.status === "sent") bouncedRecipientIds.add(target.id);
            if (dsn === "sender_auth") senderAuthCampaigns.add(target.campaign_id);
            // "soft" (delays, quota, unrecognised): ignore.
          }
          continue;
        }
        msg.is_auto_reply = true;
      }

      // 1) Authoritative match: In-Reply-To / References contains one of our
      //    outbound Message-IDs. Guaranteed genuine reply to our campaign.
      let hit: Hit | undefined;
      const candidateMsgIds = [
        ...(msg.in_reply_to ? [msg.in_reply_to] : []),
        ...msg.references,
      ];
      for (const mid of candidateMsgIds) {
        const found = byMsgId.get(mid);
        if (found) { hit = found; break; }
      }
      if (hit) matchedByThread++;

      // 2) Fallback: from-address matches a recipient we sent to. Auto-replies
      //    and bounces are already filtered above, so any remaining mail from
      //    a recipient address is treated as a genuine reply. Not every email
      //    client sets In-Reply-To/References reliably, and requiring threading
      //    headers drops real replies from some webmail clients.
      if (!hit) {
        hit = byEmail.get(msg.from);
        if (hit) matchedByFrom++;
      }
      if (!hit) continue;

      const { data: savedRow, error } = await db
        .from("replies")
        .upsert(
          {
            recipient_id: hit.id,
            campaign_id: hit.campaign_id,
            user_id: s.user_id,
            from_email: msg.from,
            subject: msg.subject,
            snippet: msg.snippet,
            body_text: msg.body_text,
            body_html: msg.body_html,
            received_at: msg.date?.toISOString() ?? null,
            is_auto_reply: msg.is_auto_reply,
            message_id: msg.message_id,
          },
          { onConflict: "recipient_id,received_at" }
        )
        .select("id, intent")
        .maybeSingle();
      if (!error) savedCount++;

      // Queue for triage iff the row has no intent yet. onConflict means
      // re-runs don't double-classify; we also skip rows already labelled
      // by a previous tick.
      if (savedRow && !savedRow.intent) {
        pendingClassify.push({
          reply_id: savedRow.id,
          user_id: s.user_id,
          subject: msg.subject,
          body: msg.body_text,
        });
      }
      // Fire reply.received webhook (idempotent on reply.id — webhooks
      // table has UNIQUE(webhook_id, event_id), so retry-safe).
      if (savedRow) {
        await fireWebhook(db, {
          user_id: s.user_id,
          event_type: "reply.received",
          event_id: savedRow.id,
          payload: {
            reply_id: savedRow.id,
            campaign_id: hit.campaign_id,
            recipient_id: hit.id,
            from_email: msg.from,
            subject: msg.subject,
            snippet: msg.snippet,
            received_at: msg.date?.toISOString() ?? null,
          },
        }, { queueOnly: true });
      }

      // Out-of-office replies are saved (the owner sees them) but don't
      // end the sequence — they push the next follow-up out instead.
      if (msg.is_auto_reply) {
        skippedAuto++;
        const d = msg.date ?? new Date();
        const prev = oooByRecipient.get(hit.id);
        if (hit.status === "sent" && (!prev || d > prev)) oooByRecipient.set(hit.id, d);
        continue;
      }
      if (hit.status === "sent" || hit.status === "pending") {
        repliedRecipientIds.add(hit.id);
      }
    }

    let markedReplied = 0;
    if (repliedRecipientIds.size > 0) {
      const { data: updated, error: upErr } = await db
        .from("recipients")
        .update({
          status: "replied",
          replied_at: new Date().toISOString(),
          next_follow_up_at: null,
          stop_reason: "replied",
        })
        .in("id", Array.from(repliedRecipientIds))
        .select("id");
      if (upErr) {
        Sentry.captureException(new Error(upErr.message), {
          tags: { route: "check_replies", op: "mark_replied" },
        });
      }
      markedReplied = updated?.length ?? 0;
      // Company-level stop: one reply from acme.com ends the sequence for
      // everyone else at acme.com in that campaign.
      for (const rid of repliedRecipientIds) {
        const r = byId.get(rid);
        if (r && updated?.some((u) => u.id === rid)) {
          await emitSequenceStopped(db, { ...r, user_id: s.user_id }, "replied", r.follow_up_count);
        }
        if (r && domainStopByCampaign.get(r.campaign_id)) {
          await stopDomainAfterReply(db, r.campaign_id, { id: r.id, email: r.email });
        }
      }
    }

    // Hard bounces reported by delivery-failure notices: stop the sequence
    // and add the address to the user's do-not-contact list.
    for (const rid of bouncedRecipientIds) {
      if (repliedRecipientIds.has(rid)) continue;
      const r = byId.get(rid);
      if (!r) continue;
      await db
        .from("recipients")
        .update({ status: "bounced", next_follow_up_at: null, stop_reason: "bounced" })
        .eq("id", rid)
        .eq("status", "sent");
      await suppressEmail(db, s.user_id, r.email, "bounced", r.campaign_id);
      await emitBounced(db, { ...r, user_id: s.user_id }, null);
      await emitSequenceStopped(db, { ...r, user_id: s.user_id }, "bounced", r.follow_up_count);
    }
    const bouncedCampaigns = new Set(
      Array.from(bouncedRecipientIds).map((rid) => byId.get(rid)?.campaign_id).filter((x): x is string => !!x)
    );
    for (const cid of bouncedCampaigns) await maybePauseForBounces(db, cid);
    for (const cid of senderAuthCampaigns) {
      const { data: paused } = await db
        .from("campaigns")
        .update({ status: "paused", paused_reason: "sender_auth" })
        .eq("id", cid)
        .eq("status", "running")
        .select("id, user_id, name");
      if (paused?.[0]) await emitCampaignPaused(db, paused[0], "sender_auth");
    }

    // Pause sequences for out-of-office recipients: next follow-up no earlier
    // than OOO_PAUSE_DAYS after the auto-reply. Keyed on the message date, so
    // re-reading the same OOO on later polls is a no-op.
    for (const [recipientId, d] of oooByRecipient) {
      if (repliedRecipientIds.has(recipientId)) continue;
      const resumeAt = new Date(d.getTime() + OOO_PAUSE_DAYS * 86_400_000);
      if (resumeAt <= new Date()) continue;
      await db
        .from("recipients")
        .update({ next_follow_up_at: resumeAt.toISOString() })
        .eq("id", recipientId)
        .eq("status", "sent")
        .not("next_follow_up_at", "is", null)
        .lt("next_follow_up_at", resumeAt.toISOString());
    }

    results.push({
      sender: s.email,
      checked: messages.length,
      matched_by_thread: matchedByThread,
      matched_by_from: matchedByFrom,
      skipped_auto: skippedAuto,
      skipped_bounce: skippedBounce,
      saved: savedCount,
      marked_replied: markedReplied,
    });
  }

  // ---- AI reply triage (Phase 3.3) ----
  // Filter pendingClassify to users whose effective plan is growth or scale.
  // Capped per tick so a backlog can't blow the 60s Vercel budget.
  const TRIAGE_CAP_PER_TICK = 25;
  const TRIAGE_CONCURRENCY = 4;
  let triageRan = 0;

  // Any configured provider (Groq / Gemini / Anthropic) — this used to
  // require ANTHROPIC_API_KEY even when triage itself ran on Groq or Gemini.
  if (pendingClassify.length > 0 && getAiProvider()) {
    const userIds = Array.from(new Set(pendingClassify.map((p) => p.user_id)));
    const { data: subs } = await db
      .from("subscriptions")
      .select("user_id, plan_id, status")
      .in("user_id", userIds);
    const eligible = new Set<string>();
    for (const s of subs ?? []) {
      if (
        (s.plan_id === "growth" || s.plan_id === "scale") &&
        ["active", "trialing", "past_due"].includes(s.status)
      ) {
        eligible.add(s.user_id);
      }
    }
    const eligiblePending = pendingClassify
      .filter((p) => eligible.has(p.user_id))
      .slice(0, TRIAGE_CAP_PER_TICK);

    if (eligiblePending.length > 0) {
      const outcomes = await mapWithLimit(eligiblePending, TRIAGE_CONCURRENCY, async (p) => {
        const out = await classifyReply({ subject: p.subject, body: p.body });
        if (!out) return { id: p.reply_id, written: false };
        // Only label rows still unlabelled: if the user set a label by hand
        // while this ran, that one wins and no AI actions fire.
        const { data: labelled, error } = await db
          .from("replies")
          .update({ intent: out.intent, intent_confidence: out.confidence, intent_source: "ai" })
          .eq("id", p.reply_id)
          .is("intent", null)
          .select("id");
        if (!error && labelled?.length) {
          await applyIntentActions(db, p.reply_id, out.intent);
          // Fire reply.classified webhook with the same event_id pattern
          // ("classified:<reply_id>") so it's distinct from the earlier
          // reply.received delivery.
          await fireWebhook(db, {
            user_id: p.user_id,
            event_type: "reply.classified",
            event_id: `classified:${p.reply_id}`,
            payload: {
              reply_id: p.reply_id,
              intent: out.intent,
              confidence: out.confidence,
            },
          }, { queueOnly: true });
        }
        return { id: p.reply_id, written: !error };
      });
      triageRan = outcomes.filter((o) => o.written).length;
    }
  }

  return NextResponse.json({
    status: "ok",
    results,
    triage: {
      pending: pendingClassify.length,
      classified: triageRan,
    },
  });
}

// Tie a delivery-failure notice back to the recipient it's about. DSNs
// usually quote the original Message-ID (threading headers or the attached
// original); otherwise fall back to the single recipient address the body
// mentions. Ambiguous notices (several of our recipients named) are ignored.
function matchBounce<T extends { id: string }>(
  msg: IncomingMessage,
  byMsgId: Map<string, T>,
  byEmail: Map<string, T>
): T | null {
  const text = `${msg.body_text ?? ""}\n${msg.body_html ?? ""}`;
  const ids = [
    ...(msg.in_reply_to ? [msg.in_reply_to] : []),
    ...msg.references,
    ...(text.match(/<[^<>\s@]+@[^<>\s]+>/g) ?? []),
  ];
  for (const id of ids) {
    const hit = byMsgId.get(id);
    if (hit) return hit;
  }
  const found = new Map<string, T>();
  for (const addr of text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) {
    const hit = byEmail.get(addr.toLowerCase());
    if (hit) found.set(hit.id, hit);
  }
  return found.size === 1 ? Array.from(found.values())[0] : null;
}

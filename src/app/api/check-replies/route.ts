import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchIncomingMessages } from "@/lib/replies";
import { listInboxSince } from "@/lib/gmail";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { cronBearerOk } from "@/lib/tokens";
import { classifyError } from "@/lib/errors";
import { classifyReply } from "@/lib/triage";
import { mapWithLimit } from "@/lib/email-validator";
import { markSenderRevoked } from "@/lib/sender-revoke";

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
  const { data: senders } = await db
    .from("senders")
    .select(
      "id, email, app_password, user_id, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status"
    );
  if (!senders || senders.length === 0) return NextResponse.json({ status: "no_senders" });

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
          { email: s.email, appPassword: decryptSecret(s.app_password) },
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

    // Campaigns for this sender
    const { data: campaignRows } = await db
      .from("campaigns")
      .select("id")
      .eq("sender_id", s.id);
    const campaignIds = (campaignRows ?? []).map((c) => c.id);
    if (campaignIds.length === 0) {
      results.push({
        sender: s.email, checked: messages.length,
        matched_by_thread: 0, matched_by_from: 0,
        skipped_auto: 0, skipped_bounce: 0, saved: 0, marked_replied: 0,
      });
      continue;
    }

    // Fetch recipients in this sender's campaigns (email + message_id both matter).
    // Only recipients whose initial mail actually went out can plausibly
    // receive a reply (sent or replied — the latter still receives
    // follow-up replies on the same thread). Skip pending / unsubscribed
    // / failed / bounced. Matters once a sender has 100K+ historical
    // recipients across many campaigns.
    const { data: recipientsRows } = await db
      .from("recipients")
      .select("id, email, campaign_id, status, message_id")
      .in("campaign_id", campaignIds)
      .in("status", ["sent", "replied"])
      .range(0, 99999);

    // Two indexes: by message_id (authoritative — this is a genuine thread reply)
    // and by email (fallback — used only when the reply also carries SOME
    // In-Reply-To/References, which rules out unrelated mail from that address).
    const byMsgId = new Map<string, { id: string; campaign_id: string; status: string }>();
    const byEmail = new Map<string, { id: string; campaign_id: string; status: string }>();
    for (const r of recipientsRows ?? []) {
      const mid = normalizeMsgId(r.message_id);
      if (mid && !byMsgId.has(mid)) {
        byMsgId.set(mid, { id: r.id, campaign_id: r.campaign_id, status: r.status });
      }
      const lo = r.email.toLowerCase();
      if (!byEmail.has(lo)) {
        byEmail.set(lo, { id: r.id, campaign_id: r.campaign_id, status: r.status });
      }
    }

    let savedCount = 0;
    let matchedByThread = 0;
    let matchedByFrom = 0;
    let skippedAuto = 0;
    let skippedBounce = 0;
    const repliedRecipientIds = new Set<string>();

    for (const msg of messages) {
      // Skip bounces (mailer-daemon / DSNs) — those aren't from the recipient
      // at all, so counting them as a "reply" is factually wrong. Everything
      // else is kept, including auto-replies / OOO / vacation responders —
      // the owner wants to see every inbound signal, not just "active" ones.
      if (msg.is_bounce) { skippedBounce++; continue; }

      // 1) Authoritative match: In-Reply-To / References contains one of our
      //    outbound Message-IDs. Guaranteed genuine reply to our campaign.
      let hit: { id: string; campaign_id: string; status: string } | undefined;
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
        })
        .in("id", Array.from(repliedRecipientIds))
        .select("id");
      if (upErr) {
        Sentry.captureException(new Error(upErr.message), {
          tags: { route: "check_replies", op: "mark_replied" },
        });
      }
      markedReplied = updated?.length ?? 0;
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

  if (pendingClassify.length > 0 && process.env.ANTHROPIC_API_KEY) {
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
        const { error } = await db
          .from("replies")
          .update({ intent: out.intent, intent_confidence: out.confidence })
          .eq("id", p.reply_id);
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

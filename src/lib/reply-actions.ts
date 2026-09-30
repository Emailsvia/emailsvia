import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyIntent } from "./triage";
import { oooResumeAt } from "./followup-guard";
import { suppressEmail, maybePauseForBounces } from "./sequence-stop";
import { sendInterestedReplyNotice } from "./transactional";
import { dispatch as fireWebhook } from "./webhooks";
import { appUrl } from "./tokens";
import { classifyDsn } from "./errors";
import { syncReplyToIntegrations } from "./integrations";
import { recordEvent, recordEvents } from "./activity";
import { emitBounced } from "./events";
import { scheduleNotNow, cancelPending } from "./nurture";

// What EmailsVia does automatically once a reply has a label (from AI
// triage or a manual relabel). Every action is idempotent: triage re-runs,
// relabels back and forth, and the poller re-reading the same message must
// not double-unsubscribe, double-notify or re-resume a sequence.
//
//   unsubscribe  → a real unsubscribe: suppressed for all this user's
//                  campaigns, webhook fired (they asked in words instead of
//                  clicking the link, same legal weight)
//   bounce       → recipient bounced + suppressed (+ Bounce Shield check)
//   ooo          → header detection missed an auto-responder and the
//                  sequence was stopped as "replied": undo that and resume
//                  OOO_PAUSE_DAYS after the auto-reply
//   interested   → email the owner (once per reply) so they answer fast
//
// Needs the service-role client: it reads the owner's email for the notice.
export async function applyIntentActions(
  admin: SupabaseClient,
  replyId: string,
  intent: ReplyIntent,
  // "ai" labels are double-checked before destructive actions; a label the
  // user chose by hand is trusted.
  source: "ai" | "manual" = "ai"
): Promise<string[]> {
  const done: string[] = [];
  const { data: reply } = await admin
    .from("replies")
    .select(`
      id, user_id, from_email, subject, snippet, body_text, received_at, notified_at, campaign_id, is_auto_reply,
      intent_confidence,
      recipient:recipients(id, email, name, company, status, stop_reason, next_step_number, campaign_id),
      campaign:campaigns(id, name)
    `)
    .eq("id", replyId)
    .maybeSingle();
  if (!reply) return done;
  const recipient = (Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient) as {
    id: string; email: string; name: string | null; company: string | null; status: string;
    stop_reason: string | null; next_step_number: number | null; campaign_id: string;
  } | null;
  const campaign = (Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign) as
    | { id: string; name: string }
    | null;

  if (recipient) {
    await recordEvent(admin, {
      user_id: reply.user_id,
      campaign_id: recipient.campaign_id,
      recipient_id: recipient.id,
      type: "intent_labeled",
      data: {
        reply_id: reply.id,
        intent,
        source,
        confidence: source === "ai" ? reply.intent_confidence : null,
      },
      // AI labels a reply once; manual relabels can repeat, keep each one.
      dedupe_key: source === "ai" ? `intent:${reply.id}:ai` : null,
    });
  }

  if (intent === "unsubscribe" && recipient) {
    const { data: existing } = await admin
      .from("unsubscribes")
      .select("email")
      .eq("user_id", reply.user_id)
      .eq("email", recipient.email)
      .maybeSingle();
    if (!existing) {
      await admin
        .from("unsubscribes")
        .upsert(
          { user_id: reply.user_id, email: recipient.email, campaign_id: recipient.campaign_id },
          { onConflict: "user_id,email" }
        );
      await fireWebhook(admin, {
        user_id: reply.user_id,
        event_type: "recipient.unsubscribed",
        event_id: `unsub:${reply.user_id}:${recipient.email}`,
        payload: { email: recipient.email, campaign_id: recipient.campaign_id, via: "reply" },
      }, { queueOnly: true });
      done.push("unsubscribed");
    }
    // Stop any other campaign still scheduled to mail them. The replied row
    // itself keeps status 'replied' so reply stats stay truthful.
    const { data: stopped } = await admin
      .from("recipients")
      .update({ status: "unsubscribed", next_follow_up_at: null })
      .eq("user_id", reply.user_id)
      .eq("email", recipient.email)
      .in("status", ["pending", "sent"])
      .select("id, campaign_id, stop_reason");
    const unstopped = (stopped ?? []).filter((r) => !r.stop_reason).map((r) => r.id);
    if (unstopped.length > 0) {
      await admin.from("recipients").update({ stop_reason: "unsubscribed" }).in("id", unstopped);
    }
    // The replying row keeps status 'replied', but it's unsubscribed too.
    const rows = [
      { id: recipient.id, campaign_id: recipient.campaign_id },
      ...(stopped ?? []).filter((r) => r.id !== recipient.id),
    ];
    await recordEvents(
      admin,
      rows.map((r) => ({
        user_id: reply.user_id,
        campaign_id: r.campaign_id,
        recipient_id: r.id,
        type: "unsubscribed" as const,
        data: { method: "reply", reply_id: reply.id, source },
        dedupe_key: "unsubscribed",
      }))
    );
  }

  // An AI "bounce" label on a delay or a DMARC rejection must not suppress a
  // good address; require a real hard-bounce notice unless the user said so.
  const hardBounce =
    source === "manual" || classifyDsn(reply.subject ?? null, reply.body_text ?? reply.snippet ?? null) === "hard";
  if (intent === "bounce" && hardBounce && recipient && recipient.status !== "bounced") {
    await admin
      .from("recipients")
      .update({ status: "bounced", next_follow_up_at: null, stop_reason: "bounced" })
      .eq("id", recipient.id)
      .in("status", ["sent", "replied"]);
    await suppressEmail(admin, reply.user_id, recipient.email, "bounced", recipient.campaign_id);
    await emitBounced(
      admin,
      { id: recipient.id, email: recipient.email, campaign_id: recipient.campaign_id, user_id: reply.user_id },
      [reply.subject, reply.snippet].filter(Boolean).join(" · ") || null,
      { source: "reply_label" }
    );
    await maybePauseForBounces(admin, recipient.campaign_id);
    done.push("bounced");
  }

  // They've left: the address is dead weight (and may start bouncing). Stop
  // every campaign mailing it; the reply stays visible (and any replacement
  // it names can be added as a lead from the inbox).
  if (intent === "left_company" && recipient) {
    await suppressEmail(admin, reply.user_id, recipient.email, "manual", recipient.campaign_id);
    const { data: stopped } = await admin
      .from("recipients")
      .update({ next_follow_up_at: null, stop_reason: "suppressed" })
      .eq("user_id", reply.user_id)
      .eq("email", recipient.email)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null)
      .select("id, campaign_id");
    await recordEvents(
      admin,
      (stopped ?? []).map((r) => ({
        user_id: reply.user_id,
        campaign_id: r.campaign_id,
        recipient_id: r.id,
        type: "sequence_stopped" as const,
        data: { reason: "suppressed", why: "left the company", reply_id: reply.id },
      }))
    );
    done.push("left_company_suppressed");
  }

  if (intent === "ooo" && recipient) {
    await admin.from("replies").update({ is_auto_reply: true }).eq("id", reply.id);
    // Only undo the stop if nobody from this recipient ever sent a human reply
    // (an OOO that follows a real "yes, interested" must not restart it).
    const { count: humanReplies } = await admin
      .from("replies")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", recipient.id)
      .eq("is_auto_reply", false)
      .neq("id", reply.id);
    if (recipient.status === "replied" && recipient.next_step_number != null && (humanReplies ?? 0) === 0) {
      const parsed = oooResumeAt(
        {
          subject: reply.subject ?? null,
          body_text: reply.body_text ?? reply.snippet ?? null,
          date: reply.received_at ? new Date(reply.received_at) : null,
        },
        new Date()
      );
      const resumeAt = new Date(Math.max(parsed.getTime(), Date.now() + 3_600_000));
      // Only undo a stop that was caused by this kind of reply; a stop for any
      // other reason (unsubscribe, bounce, colleague replied) stays.
      const { data: resumed } = await admin
        .from("recipients")
        .update({ status: "sent", stop_reason: null, replied_at: null, next_follow_up_at: resumeAt.toISOString() })
        .eq("id", recipient.id)
        .eq("status", "replied")
        .or("stop_reason.is.null,stop_reason.eq.replied")
        .select("id");
      if (resumed?.length) {
        done.push("sequence_resumed_after_ooo");
        await recordEvents(admin, [
          {
            user_id: reply.user_id,
            campaign_id: recipient.campaign_id,
            recipient_id: recipient.id,
            type: "sequence_resumed",
            data: { reason: "reply_was_out_of_office", reply_id: reply.id, source },
          },
          {
            user_id: reply.user_id,
            campaign_id: recipient.campaign_id,
            recipient_id: recipient.id,
            type: "sequence_paused",
            data: { reason: "out_of_office", until: resumeAt.toISOString(), step: recipient.next_step_number },
            dedupe_key: `paused:ooo:${resumeAt.toISOString().slice(0, 10)}`,
          },
        ]);
      }
    }
  }

  // "Not now": re-engage later if the campaign has a rule for it. A label
  // changed away from not_now drops the re-engagement it scheduled.
  if (recipient) {
    if (intent === "not_now" && recipient.status === "replied" && reply.campaign_id) {
      const scheduled = await scheduleNotNow(admin, {
        id: reply.id,
        user_id: reply.user_id,
        recipient_id: recipient.id,
        campaign_id: reply.campaign_id,
        body_text: reply.body_text ?? null,
        snippet: reply.snippet ?? null,
        received_at: reply.received_at ?? null,
      });
      if (scheduled) done.push("not_now_follow_up_scheduled");
    } else if (intent !== "not_now") {
      await cancelPending(admin, recipient.id, { kinds: ["not_now"], anchorReplyId: reply.id, reason: "relabelled" });
    }
  }

  if (intent === "interested" && !reply.notified_at) {
    // Claim the notification first so two concurrent triage passes can't
    // both email.
    const { data: claimed } = await admin
      .from("replies")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", reply.id)
      .is("notified_at", null)
      .select("id");
    if (claimed?.length) {
      const { data: settings } = await admin
        .from("user_settings")
        .select("notify_interested")
        .eq("user_id", reply.user_id)
        .maybeSingle();
      if (settings?.notify_interested !== false) {
        const { data: owner } = await admin.auth.admin.getUserById(reply.user_id).catch(() => ({ data: null }));
        const to = owner?.user?.email;
        if (to) {
          const res = await sendInterestedReplyNotice({
            to,
            prospect: recipient?.name || reply.from_email,
            company: recipient?.company ?? null,
            campaign: campaign?.name ?? null,
            snippet: reply.snippet,
            appUrl: appUrl(),
          });
          if (res.ok) done.push("owner_notified");
        }
      }
    }
  }

  // CRM / Slack push for labels the user chose in Settings → Integrations.
  if (intent !== "bounce" && intent !== "ooo") {
    done.push(
      ...(await syncReplyToIntegrations(admin, {
        id: reply.id,
        user_id: reply.user_id,
        intent,
        from_email: reply.from_email,
        subject: reply.subject ?? null,
        snippet: reply.snippet ?? null,
        body_text: reply.body_text ?? null,
        received_at: reply.received_at ?? null,
        prospect_name: recipient?.name ?? null,
        company: recipient?.company ?? null,
        campaign_name: campaign?.name ?? null,
      }))
    );
  }

  return done;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyIntent } from "./triage";
import { OOO_PAUSE_DAYS } from "./followup-guard";
import { suppressEmail, maybePauseForBounces } from "./sequence-stop";
import { sendInterestedReplyNotice } from "./transactional";
import { dispatch as fireWebhook } from "./webhooks";
import { appUrl } from "./tokens";
import { classifyDsn } from "./errors";
import { syncReplyToIntegrations } from "./integrations";

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
    await admin
      .from("recipients")
      .update({ status: "unsubscribed", next_follow_up_at: null })
      .eq("user_id", reply.user_id)
      .eq("email", recipient.email)
      .in("status", ["pending", "sent"]);
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
    await maybePauseForBounces(admin, recipient.campaign_id);
    done.push("bounced");
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
      const base = reply.received_at ? new Date(reply.received_at) : new Date();
      const resumeAt = new Date(
        Math.max(base.getTime() + OOO_PAUSE_DAYS * 86_400_000, Date.now() + 3_600_000)
      );
      // Only undo a stop that was caused by this kind of reply; a stop for any
      // other reason (unsubscribe, bounce, colleague replied) stays.
      const { data: resumed } = await admin
        .from("recipients")
        .update({ status: "sent", stop_reason: null, replied_at: null, next_follow_up_at: resumeAt.toISOString() })
        .eq("id", recipient.id)
        .eq("status", "replied")
        .or("stop_reason.is.null,stop_reason.eq.replied")
        .select("id");
      if (resumed?.length) done.push("sequence_resumed_after_ooo");
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

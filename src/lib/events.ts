import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatch } from "./webhooks";

// Webhook events raised from the send loop and reply poller. Always queued
// (delivered by /api/cron/webhooks) so a slow customer endpoint can never
// hold up sending. event_ids are stable, so re-raising is a no-op.

type Rcpt = { id: string; email: string; campaign_id: string; user_id: string };

export function emitEmailSent(
  db: SupabaseClient,
  r: Rcpt,
  info: { kind: "initial" | "retry" | "follow_up"; step: number; sender_email: string | null; message_id: string | null }
) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "email.sent",
      event_id: `sent:${r.id}:${info.step}`,
      payload: {
        campaign_id: r.campaign_id,
        recipient_id: r.id,
        email: r.email,
        step: info.step, // 0 = first email
        kind: info.kind,
        sender: info.sender_email,
        message_id: info.message_id,
        sent_at: new Date().toISOString(),
      },
    },
    { queueOnly: true }
  );
}

export function emitBounced(db: SupabaseClient, r: Rcpt, detail: string | null) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "email.bounced",
      event_id: `bounced:${r.id}`,
      payload: { campaign_id: r.campaign_id, recipient_id: r.id, email: r.email, detail: detail?.slice(0, 300) ?? null },
    },
    { queueOnly: true }
  );
}

export type StopReason =
  | "replied"
  | "domain_replied"
  | "bounced"
  | "unsubscribed"
  | "suppressed"
  | "merge_failed"
  | "send_failed"
  | "guard_failed"
  | "completed";

// `episode` separates stops of the same recipient (e.g. after an
// out-of-office resume): pass how many follow-ups they had received.
export function emitSequenceStopped(db: SupabaseClient, r: Rcpt, reason: StopReason, episode: number | string = 0) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "sequence.stopped",
      event_id: `stopped:${r.id}:${reason}:${episode}`,
      payload: { campaign_id: r.campaign_id, recipient_id: r.id, email: r.email, reason },
    },
    { queueOnly: true }
  );
}

export function emitCampaignPaused(
  db: SupabaseClient,
  c: { id: string; user_id: string; name?: string | null },
  reason: "bounce_rate" | "sender_auth"
) {
  return dispatch(
    db,
    {
      user_id: c.user_id,
      event_type: "campaign.paused",
      // One event per pause (same-minute duplicates from parallel paths collapse).
      event_id: `paused:${c.id}:${reason}:${new Date().toISOString().slice(0, 16)}`,
      payload: { campaign_id: c.id, name: c.name ?? null, reason, paused_at: new Date().toISOString() },
    },
    { queueOnly: true }
  );
}

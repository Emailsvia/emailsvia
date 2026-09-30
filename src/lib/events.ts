import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatch } from "./webhooks";
import { recordEvent } from "./activity";

// Webhook events raised from the send loop and reply poller. Always queued
// (delivered by /api/cron/webhooks) so a slow customer endpoint can never
// hold up sending. event_ids are stable, so re-raising is a no-op.
//
// Each emitter also writes the matching entry to the recipient's activity
// log (recipient_events), with a dedupe key derived from the same id.

type Rcpt = { id: string; email: string; campaign_id: string; user_id: string };

export async function emitEmailSent(
  db: SupabaseClient,
  r: Rcpt,
  info: {
    kind: "initial" | "retry" | "follow_up" | "nurture";
    step: number;
    sender_email: string | null;
    message_id: string | null;
    // Activity-log extras (not part of the webhook payload).
    send_log_id: string;
    subject?: string | null;
    thread_id?: string | null;
    variant_id?: string | null;
    smtp_response?: string | null;
    // Why this email (rules engine): rule, matched situations…
    detail?: Record<string, unknown>;
  }
) {
  await recordEvent(db, {
    user_id: r.user_id,
    campaign_id: r.campaign_id,
    recipient_id: r.id,
    type: "sent",
    send_log_id: info.send_log_id,
    step_number: info.step,
    data: {
      kind: info.kind,
      subject: info.subject?.slice(0, 300),
      sender: info.sender_email,
      message_id: info.message_id,
      thread_id: info.thread_id,
      variant_id: info.variant_id,
      smtp_response: info.smtp_response?.slice(0, 300),
      ...info.detail,
    },
    dedupe_key: `send:${info.send_log_id}`,
  });
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "email.sent",
      // Follow-ups after a reply can repeat a step number; key those by email.
      event_id: info.kind === "nurture" ? `sent:${r.id}:nurture:${info.send_log_id}` : `sent:${r.id}:${info.step}`,
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

export async function emitBounced(
  db: SupabaseClient,
  r: Rcpt,
  detail: string | null,
  // smtp = rejected while sending; dsn = delivery-failure notice later.
  extra: { source: "smtp" | "dsn" | "reply_label"; send_log_id?: string | null; step?: number | null }
) {
  await recordEvent(db, {
    user_id: r.user_id,
    campaign_id: r.campaign_id,
    recipient_id: r.id,
    type: "bounced",
    send_log_id: extra.send_log_id ?? null,
    step_number: extra.step ?? null,
    data: { kind: "hard", source: extra.source, detail: detail?.slice(0, 300) },
    dedupe_key: "bounced",
  });
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
  | "meeting_booked"
  | "completed";

// `episode` separates stops of the same recipient (e.g. after an
// out-of-office resume): pass how many follow-ups they had received.
export async function emitSequenceStopped(
  db: SupabaseClient,
  r: Rcpt,
  reason: StopReason,
  episode: number | string = 0,
  detail?: Record<string, unknown>
) {
  await recordEvent(db, {
    user_id: r.user_id,
    campaign_id: r.campaign_id,
    recipient_id: r.id,
    type: "sequence_stopped",
    data: { reason, ...detail },
    dedupe_key: `stopped:${reason}:${episode}`,
  });
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

// First human open of an email (machine opens never fire).
export function emitOpened(
  db: SupabaseClient,
  r: Rcpt,
  info: { send_log_id: string | null; step: number | null; opened_at: string }
) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "email.opened",
      event_id: `opened:${info.send_log_id ?? r.id}`,
      payload: { campaign_id: r.campaign_id, recipient_id: r.id, email: r.email, step: info.step, opened_at: info.opened_at },
    },
    { queueOnly: true }
  );
}

// A human click (scanner/preview clicks never fire).
export function emitClicked(
  db: SupabaseClient,
  r: Rcpt,
  info: { click_id: string; url: string; link_key: string | null; step: number | null; clicked_at: string }
) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "email.clicked",
      event_id: `clicked:${info.click_id}`,
      payload: {
        campaign_id: r.campaign_id, recipient_id: r.id, email: r.email,
        url: info.url, link_key: info.link_key, step: info.step, clicked_at: info.clicked_at,
      },
    },
    { queueOnly: true }
  );
}

export function emitNeedsApproval(
  db: SupabaseClient,
  r: { id: string; campaign_id: string; user_id: string; email?: string | null },
  info: { scheduled_id: string; kind: string }
) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "followup.needs_approval",
      event_id: `approval:${info.scheduled_id}`,
      payload: { campaign_id: r.campaign_id, recipient_id: r.id, email: r.email ?? null, kind: info.kind, scheduled_id: info.scheduled_id },
    },
    { queueOnly: true }
  );
}

export function emitMeetingBooked(
  db: SupabaseClient,
  r: Rcpt,
  info: { provider: string; start_time: string | null; event_name: string | null; booking_id: string | null }
) {
  return dispatch(
    db,
    {
      user_id: r.user_id,
      event_type: "meeting.booked",
      event_id: `meeting:${r.id}:${info.booking_id ?? info.start_time ?? "booked"}`,
      payload: { campaign_id: r.campaign_id, recipient_id: r.id, email: r.email, ...info },
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

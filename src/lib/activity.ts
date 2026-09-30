import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

// Per-recipient activity log (recipient_events, migration 0025). One entry
// point for every place that learns something about a recipient: the send
// loop, the tracking pixel/redirect, unsubscribe, the reply poller, reply
// labels and manual actions. The DB trigger on insert keeps the engagement
// rollup on `recipients` (open_count, click_count, last_activity_at…) in step.
//
// Writes need the service-role client: the table is read-only for users so
// the log can't be forged. User-facing routes may call this with
// supabaseAdmin() only after they've confirmed (through RLS) that the
// recipient belongs to the caller.
//
// Recording is best-effort: a failed log write is reported to Sentry and
// never breaks a send or a redirect.

export type RecipientEventType =
  | "sent"
  | "send_failed"
  | "skipped"
  | "bounced"
  | "opened"
  | "clicked"
  | "replied"
  | "auto_replied"
  | "intent_labeled"
  | "unsubscribed"
  | "sequence_paused"
  | "sequence_resumed"
  | "sequence_stopped"
  | "followup_decided"
  | "you_replied"
  | "referral_added"
  | "meeting_booked";

export type RecipientEventInput = {
  user_id: string;
  campaign_id: string;
  recipient_id: string;
  type: RecipientEventType;
  occurred_at?: Date | string | null;
  // Which email this is about; 0 = first email, n = follow-up step n.
  send_log_id?: string | null;
  step_number?: number | null;
  is_machine?: boolean;
  machine_reason?: string | null;
  data?: Record<string, unknown>;
  // Same fact recorded twice lands once. Omit for facts that can repeat.
  dedupe_key?: string | null;
};

function toRow(e: RecipientEventInput) {
  const at = e.occurred_at ? new Date(e.occurred_at) : new Date();
  return {
    user_id: e.user_id,
    campaign_id: e.campaign_id,
    recipient_id: e.recipient_id,
    type: e.type,
    occurred_at: (isNaN(at.getTime()) ? new Date() : at).toISOString(),
    send_log_id: e.send_log_id ?? null,
    step_number: e.step_number ?? null,
    is_machine: e.is_machine ?? false,
    machine_reason: e.machine_reason ?? null,
    data: stripNullish(e.data ?? {}),
    dedupe_key: e.dedupe_key ?? null,
  };
}

function stripNullish(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

export async function recordEvents(db: SupabaseClient, events: RecipientEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map(toRow);
  const keyed = rows.filter((r) => r.dedupe_key);
  const unkeyed = rows.filter((r) => !r.dedupe_key);
  try {
    for (let i = 0; i < keyed.length; i += 500) {
      const { error } = await db
        .from("recipient_events")
        .upsert(keyed.slice(i, i + 500), { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < unkeyed.length; i += 500) {
      const { error } = await db.from("recipient_events").insert(unkeyed.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { op: "record_recipient_event", type: rows[0].type },
      contexts: { event: { recipient_id: rows[0].recipient_id, count: rows.length } },
    });
  }
}

export function recordEvent(db: SupabaseClient, e: RecipientEventInput): Promise<void> {
  return recordEvents(db, [e]);
}

export { linkKey } from "./link-key";

// The step number an email represents, from its send_log row.
export function stepOf(row: { kind?: string | null; step_number?: number | null } | null | undefined): number | null {
  if (!row) return null;
  return row.kind === "follow_up" ? row.step_number ?? 1 : 0;
}

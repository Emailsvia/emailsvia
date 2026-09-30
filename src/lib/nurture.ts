import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanForUser, hasFeature } from "./billing";
import { addDelay } from "./sequence-schedule";
import { loadRules } from "./followup-rules";
import type { Rule, RuleEmail } from "./followup-engine";
import { notNowDate } from "./reply-dates";
import { recordEvent, recordEvents } from "./activity";

// Follow-ups for people who already replied (scheduled_followups, 0027):
//
//   not_now         their reply was labelled "not now": re-engage on the date
//                   they gave ("next quarter", "in March") or after the
//                   rule's delay. Sent automatically; the user opted in by
//                   creating the rule.
//   thread_stalled  you answered from EmailsVia and they went quiet: a nudge
//                   in the same thread that waits for your approval.
//
// Anything newer from them cancels what's pending (they're talking again).
// Tick sends these through the normal gates as send_log.kind = 'nurture'.

export type NurtureKind = "not_now" | "thread_stalled";

const SITUATION_FOR: Record<NurtureKind, string> = {
  not_now: "replied_not_now",
  thread_stalled: "thread_stalled",
};

function plus(from: Date, e: Pick<RuleEmail, "delay_value" | "delay_unit">, tz: string): Date {
  if (e.delay_unit === "hours") return new Date(from.getTime() + e.delay_value * 3_600_000);
  return addDelay(from, e.delay_value, e.delay_unit, tz);
}

// The campaign's enabled rule for this kind, if the owner's plan allows it.
async function ruleFor(
  db: SupabaseClient,
  campaignId: string,
  kind: NurtureKind
): Promise<{ rule: Rule; campaign: { id: string; user_id: string; status: string; timezone: string | null } } | null> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, user_id, status, timezone, follow_ups_enabled, archived_at")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || !campaign.follow_ups_enabled || campaign.archived_at) return null;
  const { plan } = await getPlanForUser(db, campaign.user_id);
  if (!hasFeature(plan, "follow_ups") || !hasFeature(plan, "conditional_sequences")) return null;
  const rule = (await loadRules(db, campaignId)).find(
    (r) => r.enabled && r.emails.length > 0 && r.situations.includes(SITUATION_FOR[kind])
  );
  return rule ? { rule, campaign } : null;
}

// A finished campaign isn't looked at by tick; reopen it so the scheduled
// follow-up can go out (it'll show as waiting until then).
async function reopen(db: SupabaseClient, campaign: { id: string; status: string }) {
  if (campaign.status === "done") {
    await db.from("campaigns").update({ status: "running" }).eq("id", campaign.id).eq("status", "done");
  }
}

// Called when a reply gets the "not_now" label (AI or manual).
export async function scheduleNotNow(
  db: SupabaseClient,
  reply: { id: string; user_id: string; recipient_id: string; campaign_id: string; body_text: string | null; snippet: string | null; received_at: string | null }
): Promise<boolean> {
  const found = await ruleFor(db, reply.campaign_id, "not_now");
  if (!found) return false;
  const { rule, campaign } = found;
  const email = rule.emails[0];
  const anchor = reply.received_at ? new Date(reply.received_at) : new Date();
  const tz = campaign.timezone || "Asia/Kolkata";
  const theirs = notNowDate(reply.body_text ?? reply.snippet, anchor);
  const due = new Date(Math.max((theirs ?? plus(anchor, email, tz)).getTime(), Date.now() + 3_600_000));
  const { data: inserted } = await db
    .from("scheduled_followups")
    .upsert(
      {
        user_id: reply.user_id,
        campaign_id: reply.campaign_id,
        recipient_id: reply.recipient_id,
        rule_id: rule.id,
        rule_email_id: email.id,
        kind: "not_now",
        anchor_reply_id: reply.id,
        anchor_at: anchor.toISOString(),
        due_at: due.toISOString(),
        due_source: theirs ? "their_words" : "rule_delay",
        requires_approval: false,
      },
      { onConflict: "recipient_id,rule_email_id,anchor_at", ignoreDuplicates: true }
    )
    .select("id");
  if (!inserted?.length) return false;
  await reopen(db, campaign);
  await recordEvent(db, {
    user_id: reply.user_id,
    campaign_id: reply.campaign_id,
    recipient_id: reply.recipient_id,
    type: "followup_decided",
    data: {
      outcome: "scheduled",
      kind: "not_now",
      rule_id: rule.id,
      rule_name: rule.name,
      matched: ["replied_not_now"],
      next_at: due.toISOString(),
      due_source: theirs ? "their_words" : "rule_delay",
    },
  });
  return true;
}

// Called after the user answers from EmailsVia: supersedes any pending nudge
// for this person and schedules a new one (awaiting approval when due).
export async function scheduleStalledNudge(
  db: SupabaseClient,
  a: { user_id: string; campaign_id: string; recipient_id: string; reply_id: string; answered_at: Date }
): Promise<boolean> {
  await cancelPending(db, a.recipient_id, { kinds: ["thread_stalled"], reason: "you_replied_again" });
  const found = await ruleFor(db, a.campaign_id, "thread_stalled");
  if (!found) return false;
  const { rule, campaign } = found;
  const email = rule.emails[0];
  const due = plus(a.answered_at, email, campaign.timezone || "Asia/Kolkata");
  const { data: inserted } = await db
    .from("scheduled_followups")
    .upsert(
      {
        user_id: a.user_id,
        campaign_id: a.campaign_id,
        recipient_id: a.recipient_id,
        rule_id: rule.id,
        rule_email_id: email.id,
        kind: "thread_stalled",
        anchor_reply_id: a.reply_id,
        anchor_at: a.answered_at.toISOString(),
        due_at: due.toISOString(),
        requires_approval: true,
      },
      { onConflict: "recipient_id,rule_email_id,anchor_at", ignoreDuplicates: true }
    )
    .select("id");
  if (!inserted?.length) return false;
  await reopen(db, campaign);
  await recordEvent(db, {
    user_id: a.user_id,
    campaign_id: a.campaign_id,
    recipient_id: a.recipient_id,
    type: "followup_decided",
    data: {
      outcome: "scheduled",
      kind: "thread_stalled",
      rule_id: rule.id,
      rule_name: rule.name,
      matched: ["thread_stalled"],
      next_at: due.toISOString(),
      needs_approval: true,
    },
  });
  return true;
}

// After a nurture email goes out: queue the rule's next email, if any.
export async function scheduleNextNurture(
  db: SupabaseClient,
  item: { id: string; user_id: string; campaign_id: string; recipient_id: string; rule_id: string | null; rule_email_id: string | null; kind: NurtureKind; anchor_reply_id: string | null; anchor_at: string; requires_approval: boolean },
  sentAt: Date,
  tz: string
): Promise<void> {
  if (!item.rule_id) return;
  const rule = (await loadRules(db, item.campaign_id)).find((r) => r.id === item.rule_id && r.enabled);
  if (!rule) return;
  const idx = rule.emails.findIndex((e) => e.id === item.rule_email_id);
  const next = idx >= 0 ? rule.emails[idx + 1] : undefined;
  if (!next) return;
  await db.from("scheduled_followups").upsert(
    {
      user_id: item.user_id,
      campaign_id: item.campaign_id,
      recipient_id: item.recipient_id,
      rule_id: rule.id,
      rule_email_id: next.id,
      kind: item.kind,
      anchor_reply_id: item.anchor_reply_id,
      anchor_at: item.anchor_at,
      due_at: plus(sentAt, next, tz).toISOString(),
      requires_approval: item.requires_approval,
    },
    { onConflict: "recipient_id,rule_email_id,anchor_at", ignoreDuplicates: true }
  );
}

// They wrote again (or the label changed): drop what's pending.
export async function cancelPending(
  db: SupabaseClient,
  recipientId: string,
  opts: { reason: string; kinds?: NurtureKind[]; anchoredBefore?: Date; anchorReplyId?: string }
): Promise<number> {
  let q = db
    .from("scheduled_followups")
    .update({ status: "cancelled", cancel_reason: opts.reason })
    .eq("recipient_id", recipientId)
    .in("status", ["scheduled", "needs_approval"]);
  if (opts.kinds) q = q.in("kind", opts.kinds);
  if (opts.anchoredBefore) q = q.lt("anchor_at", opts.anchoredBefore.toISOString());
  if (opts.anchorReplyId) q = q.eq("anchor_reply_id", opts.anchorReplyId);
  const { data } = await q.select("id, user_id, campaign_id, recipient_id, kind");
  await recordEvents(
    db,
    (data ?? []).map((c) => ({
      user_id: c.user_id,
      campaign_id: c.campaign_id,
      recipient_id: c.recipient_id,
      type: "followup_decided" as const,
      data: { outcome: "cancelled", kind: c.kind, why: opts.reason },
    }))
  );
  return data?.length ?? 0;
}

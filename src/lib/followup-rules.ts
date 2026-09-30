import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchReplyContext, type FollowUpStep, type RecipientReplyContext } from "./follow-up-condition";
import { decide, choiceLabel, type EngineConfig, type EngineRecipient, type Rule } from "./followup-engine";
import { isAfterReply, isAvailableSituation, type Profile } from "./situations";
import { linkKey } from "./link-key";
import { recordEvents, type RecipientEventInput } from "./activity";

// DB side of the follow-up rules engine: validation for saves, loading a
// campaign's rules into an EngineConfig, building a recipient's Profile from
// the activity rollup (migration 0025), and the re-evaluation pass that
// reacts to new opens/clicks between scheduled checks.

// ---------- validation (PUT /api/campaigns/[id]/follow-up-rules) ----------

export const RuleEmailSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    delay_value: z.number().positive().max(90),
    delay_unit: z.enum(["hours", "days", "business_days"]),
    anchor: z.enum(["last_email", "activity"]),
    thread_mode: z.enum(["same", "new"]),
    subject: z.string().max(500).nullable().optional(),
    template: z.string().trim().min(1, "Every rule email needs a body."),
  })
  .refine((e) => e.thread_mode === "same" || !!e.subject?.trim(), {
    message: "An email sent as a new thread needs its own subject.",
  })
  .refine((e) => e.delay_unit !== "hours" || e.delay_value >= 1, {
    message: "Hour delays must be at least 1 hour.",
  });

export const RuleSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().max(120).default(""),
  enabled: z.boolean().default(true),
  situations: z
    .array(z.string())
    .min(1, "Pick at least one situation for each rule.")
    .max(20)
    .refine((xs) => xs.every(isAvailableSituation), { message: "Unknown or unavailable situation." })
    .refine((xs) => !xs.some(isAfterReply) || xs.length === 1, {
      message: '"Not now", "went quiet", "finished the sequence" and "referred" each need a rule of their own.',
    }),
  params: z
    .object({
      min_opens: z.number().int().min(2).max(50).optional(),
      link_keys: z.array(z.string().max(300)).max(20).optional(),
      quiet_after: z.number().int().min(1).max(10).optional(),
    })
    .default({}),
  then_action: z.enum(["end", "next_rule"]).default("end"),
  emails: z.array(RuleEmailSchema).min(1, "Each rule needs at least one email.").max(5),
});

export const SaveRulesSchema = z.object({
  rules: z.array(RuleSchema).max(12),
  send_time_optimization: z.boolean().optional(),
  max_follow_ups: z.number().int().min(1).max(10).default(5),
  min_gap_days: z.number().min(0).max(30).default(2),
});

export type SaveRulesInput = z.infer<typeof SaveRulesSchema>;

// Normalise what the user typed for "clicked a specific link".
export function normaliseRuleParams<T extends { situations: string[]; params: { link_keys?: string[] } }>(r: T): T {
  const keys = (r.params.link_keys ?? []).map((k) => linkKey(k)).filter((k): k is string => !!k);
  return { ...r, params: { ...r.params, link_keys: r.situations.includes("clicked_link") ? Array.from(new Set(keys)) : undefined } };
}

// ---------- loading ----------

type RuleRow = {
  id: string; position: number; name: string; enabled: boolean; situations: string[];
  params: Record<string, unknown> | null; then_action: string;
  emails: Array<{
    id: string; position: number; delay_value: number | string; delay_unit: string; anchor: string;
    thread_mode: string; subject: string | null; template: string;
  }> | null;
};

export async function loadRules(db: SupabaseClient, campaignId: string): Promise<Rule[]> {
  const { data } = await db
    .from("follow_up_rules")
    .select("id, position, name, enabled, situations, params, then_action, emails:follow_up_rule_emails(id, position, delay_value, delay_unit, anchor, thread_mode, subject, template)")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });
  return ((data ?? []) as RuleRow[]).map((r) => ({
    id: r.id,
    position: r.position,
    name: r.name,
    enabled: r.enabled,
    situations: r.situations,
    params: (r.params ?? {}) as Rule["params"],
    then_action: r.then_action === "next_rule" ? "next_rule" : "end",
    emails: (r.emails ?? [])
      .map((e) => ({
        id: e.id,
        position: e.position,
        delay_value: Number(e.delay_value),
        delay_unit: e.delay_unit as Rule["emails"][number]["delay_unit"],
        anchor: e.anchor as Rule["emails"][number]["anchor"],
        thread_mode: e.thread_mode as Rule["emails"][number]["thread_mode"],
        subject: e.subject,
        template: e.template,
      }))
      .sort((a, b) => a.position - b.position),
  }));
}

// Null when the campaign has no usable rules: tick then runs the plain
// step sequence exactly as before rules existed.
export async function loadEngineConfig(
  db: SupabaseClient,
  campaign: { id: string; user_id: string; timezone?: string | null; tracking_enabled?: boolean | null; max_follow_ups?: number | null; min_gap_days?: number | string | null; send_time_optimization?: boolean | null },
  fallback: FollowUpStep[]
): Promise<EngineConfig | null> {
  const rules = await loadRules(db, campaign.id);
  // Only rules that act on the running sequence switch it to the engine;
  // "not now" / "went quiet" / "referred" rules work from replies and leads.
  const SEQUENCE_OUTSIDE = new Set(["replied_not_now", "thread_stalled", "referred"]);
  const sto = !!campaign.send_time_optimization && !!campaign.tracking_enabled;
  const sequenceRules = rules.some((r) => r.enabled && r.emails.length > 0 && r.situations.some((k) => !SEQUENCE_OUTSIDE.has(k)));
  // Send-time optimisation also runs the plain step list through the engine.
  if (!sequenceRules && !sto) return null;
  const { data: settings } = await db
    .from("user_settings")
    .select("meeting_link")
    .eq("user_id", campaign.user_id)
    .maybeSingle();
  return {
    tz: campaign.timezone || "Asia/Kolkata",
    maxFollowUps: campaign.max_follow_ups ?? 5,
    minGapDays: Number(campaign.min_gap_days ?? 2),
    rules,
    fallback,
    situationCtx: {
      tracking: !!campaign.tracking_enabled,
      meetingLinkKey: linkKey(settings?.meeting_link ?? null),
    },
    sendTimeOptimization: sto,
  };
}

const d = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);

// Emails we sent after their last human open/click. Only queried when a
// rule actually looks at "went quiet".
async function quietEmails(db: SupabaseClient, rec: Record<string, any>): Promise<number> {
  const opened = d(rec.last_opened_at)?.getTime() ?? 0;
  const clicked = d(rec.last_clicked_at)?.getTime() ?? 0;
  const lastEngaged = Math.max(opened, clicked);
  if (!lastEngaged) return 0;
  const { count } = await db
    .from("send_log")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", rec.id)
    .is("error_class", null)
    .gt("sent_at", new Date(lastEngaged).toISOString());
  return count ?? 0;
}

export function profileFrom(rec: Record<string, any>, now: Date, quiet: number): Profile {
  const ooo = d(rec.ooo_until);
  const lastSent = d(rec.last_sent_at) ?? d(rec.sent_at);
  return {
    opens: rec.open_count ?? 0,
    clicks: rec.click_count ?? 0,
    machineOpens: rec.machine_open_count ?? 0,
    linkKeys: rec.clicked_link_keys ?? [],
    quietEmails: quiet,
    backFromOoo: !!ooo && ooo.getTime() <= now.getTime() && (!lastSent || lastSent.getTime() < ooo.getTime()),
  };
}

// The local hour they most often open mail (human opens), if it's clear:
// at least two opens in the same hour.
async function preferredHour(db: SupabaseClient, recipientId: string, tz: string): Promise<number | null> {
  const { data } = await db
    .from("recipient_events")
    .select("occurred_at")
    .eq("recipient_id", recipientId)
    .eq("type", "opened")
    .eq("is_machine", false)
    .order("occurred_at", { ascending: false })
    .limit(20);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
  const byHour = new Map<number, number>();
  for (const e of data ?? []) {
    const h = Number(fmt.format(new Date(e.occurred_at)));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 1;
  for (const [h, c] of byHour) if (c > bestCount) { best = h; bestCount = c; }
  return best;
}

export async function engineRecipient(
  db: SupabaseClient,
  cfg: EngineConfig,
  rec: Record<string, any>,
  now: Date
): Promise<EngineRecipient> {
  const needsQuiet = cfg.rules.some((r) => r.enabled && r.situations.includes("went_quiet"));
  const quiet = needsQuiet ? await quietEmails(db, rec) : 0;
  return {
    followUpsSent: rec.follow_up_count ?? 0,
    lastSentAt: d(rec.last_sent_at) ?? d(rec.sent_at) ?? now,
    nextStepNumber: rec.next_step_number ?? null,
    sentRuleEmailIds: rec.sent_rule_email_ids ?? [],
    profile: profileFrom(rec, now, quiet),
    lastOpenedAt: d(rec.last_opened_at),
    lastClickedAt: d(rec.last_clicked_at),
    oooUntil: d(rec.ooo_until),
    preferredHour:
      cfg.sendTimeOptimization && (rec.open_count ?? 0) >= 2 ? await preferredHour(db, rec.id, cfg.tz) : null,
  };
}

export async function replyContextFor(
  db: SupabaseClient,
  cfg: EngineConfig,
  recipientId: string
): Promise<RecipientReplyContext> {
  return cfg.fallback.some((s) => s.condition)
    ? fetchReplyContext(db, recipientId)
    : { hasReplied: false, lastIntent: null };
}

// ---------- re-evaluation on new activity ----------

// A human open/click (or a rules edit) sets recipients.reeval_pending. Here
// we re-decide those recipients and pull their next check earlier when the
// matching rule is due sooner than what's scheduled (e.g. "1 day after they
// click"). Never pushes a check later: the picker re-decides at that time
// anyway. A sequence that ended as "completed" is reopened when new activity
// makes a rule match (within 60 days of our last email). Bounded per tick.
export async function reevaluatePending(
  db: SupabaseClient,
  campaign: { id: string; user_id: string },
  cfg: EngineConfig,
  now: Date,
  limit = 25
): Promise<number> {
  const { data: rows } = await db
    .from("recipients")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("status", "sent")
    .eq("reeval_pending", true)
    .limit(limit);
  const events: RecipientEventInput[] = [];
  let moved = 0;
  for (const rec of rows ?? []) {
    const clear = { reeval_pending: false };
    const lastSent = d(rec.last_sent_at) ?? d(rec.sent_at);
    const revivable =
      rec.stop_reason === "completed" && !!lastSent && now.getTime() - lastSent.getTime() < 60 * 86_400_000;
    if (rec.stop_reason && !revivable) {
      await db.from("recipients").update(clear).eq("id", rec.id);
      continue;
    }
    const er = await engineRecipient(db, cfg, rec, now);
    const decision = decide(cfg, er, await replyContextFor(db, cfg, rec.id), now);
    const current = d(rec.next_follow_up_at);
    if (decision.kind === "end" || (current && decision.due.getTime() >= current.getTime())) {
      await db.from("recipients").update(clear).eq("id", rec.id);
      continue;
    }
    const due = decision.due.getTime() < now.getTime() ? now : decision.due;
    const label = choiceLabel(decision.choice);
    const patch: Record<string, unknown> = {
      ...clear,
      next_follow_up_at: due.toISOString(),
      current_rule_id: label.rule_id,
    };
    if (decision.choice.source === "fallback") patch.next_step_number = decision.choice.step.step_number;
    if (revivable) patch.stop_reason = null;
    // Compare-and-set on follow_up_count: a send that landed meanwhile wins.
    const { data: updated } = await db
      .from("recipients")
      .update(patch)
      .eq("id", rec.id)
      .eq("follow_up_count", rec.follow_up_count ?? 0)
      .eq("status", "sent")
      .select("id");
    if (!updated?.length) continue;
    moved++;
    events.push({
      user_id: campaign.user_id,
      campaign_id: campaign.id,
      recipient_id: rec.id,
      type: revivable ? "sequence_resumed" : "followup_decided",
      data: {
        outcome: revivable ? "reopened" : "rescheduled",
        reason: "new_activity",
        rule_id: label.rule_id,
        rule_name: label.rule_name,
        matched: label.matched,
        next_at: due.toISOString(),
      },
    });
  }
  await recordEvents(db, events);
  return moved;
}

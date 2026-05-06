import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyIntent } from "./triage";

// Conditional follow-up steps. Each follow_up_steps row may carry a
// `condition` JSON describing when it should fire. Tick evaluates this
// against the recipient's most recent reply (if any) before scheduling
// next_follow_up_at. Steps whose condition fails are skipped over —
// we look forward for the next eligible step.

export type Condition =
  | { type: "always" }
  | { type: "no_reply" }
  | { type: "intent_in"; intents: ReplyIntent[] }
  | { type: "intent_not_in"; intents: ReplyIntent[] };

export function isCondition(v: unknown): v is Condition {
  if (!v || typeof v !== "object") return false;
  const c = v as { type?: unknown; intents?: unknown };
  if (typeof c.type !== "string") return false;
  if (c.type === "always" || c.type === "no_reply") return true;
  if (c.type === "intent_in" || c.type === "intent_not_in") {
    return Array.isArray(c.intents) && c.intents.every((x) => typeof x === "string");
  }
  return false;
}

export type RecipientReplyContext = {
  // Pulled once before evaluation; if the recipient has no replies the
  // values are null. We pull only the most recent reply — earlier ones
  // would only matter for compound conditions which aren't supported in v1.
  hasReplied: boolean;
  lastIntent: ReplyIntent | null;
};

// Cheap per-recipient reply lookup. Caller passes this into evaluate()
// so a tick that needs to evaluate several upcoming steps doesn't re-
// query the same row N times.
export async function fetchReplyContext(
  db: SupabaseClient,
  recipientId: string
): Promise<RecipientReplyContext> {
  const { data } = await db
    .from("replies")
    .select("intent")
    .eq("recipient_id", recipientId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return {
    hasReplied: !!data,
    lastIntent: (data?.intent as ReplyIntent | null) ?? null,
  };
}

export function evaluate(
  condition: Condition | null | undefined,
  ctx: RecipientReplyContext
): boolean {
  if (!condition) return true; // null/missing = legacy step, always fire
  if (!isCondition(condition)) return true; // garbage in DB → fail-open
  switch (condition.type) {
    case "always":
      return true;
    case "no_reply":
      return !ctx.hasReplied;
    case "intent_in":
      return ctx.lastIntent !== null && condition.intents.includes(ctx.lastIntent);
    case "intent_not_in":
      // Includes "never replied" — caller can combine with `no_reply`
      // in two steps if they want strict not_in for replied recipients.
      return ctx.lastIntent === null || !condition.intents.includes(ctx.lastIntent);
    default:
      return true;
  }
}

export type FollowUpStep = {
  step_number: number;
  delay_days: number;
  subject: string | null;
  template: string;
  condition: Condition | null;
};

// Given the user's full follow-up sequence, find the next step that
// passes its condition starting from `fromStep` (inclusive). Returns
// the step + the cumulative delay_days from `fromStep` to it. Returns
// null if every remaining step is skipped — caller sets next_follow_up_at
// to null.
export function nextEligibleStep(
  steps: FollowUpStep[],
  fromStep: number,
  ctx: RecipientReplyContext
): { step: FollowUpStep; delayDays: number } | null {
  let delayDays = 0;
  for (const s of steps) {
    if (s.step_number < fromStep) continue;
    delayDays += s.delay_days;
    if (evaluate(s.condition, ctx)) {
      return { step: s, delayDays };
    }
  }
  return null;
}

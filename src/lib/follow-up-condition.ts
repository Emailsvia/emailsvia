import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyIntent } from "./triage";

// Conditional follow-up steps. Each follow_up_steps row may carry a
// `condition` JSON describing when it should fire. Tick evaluates this
// against the recipient's reply state at SEND time (when the step is due),
// not when the previous email went out. Steps whose condition fails are
// skipped over — we look forward for the next eligible step.

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
  // Pulled once before evaluation. `hasReplied` ignores auto-replies (an
  // out-of-office isn't a human answer); `lastIntent` is the most recent
  // labelled reply of any kind, so `intent_in: ["ooo"]` can match.
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
    .select("intent, is_auto_reply")
    .eq("recipient_id", recipientId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(20);
  const rows = data ?? [];
  const labelled = rows.find((r) => r.intent);
  return {
    hasReplied: rows.some((r) => !r.is_auto_reply),
    lastIntent: (labelled?.intent as ReplyIntent | undefined) ?? null,
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
  delay_unit?: "days" | "business_days" | null;
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

// Resolve which step to send for a recipient whose follow-up is due.
// `dueStep` is recipients.next_step_number (or follow_up_count+1 for legacy
// rows). If that step's condition fails now, walk forward:
//   - { kind: "send", step }                 send this step now
//   - { kind: "defer", step, delaySteps }    a later step is eligible; it is
//     due after the delays of `delaySteps` (the steps after the skipped one,
//     up to and including the eligible step) have elapsed from now
//   - { kind: "end" }                        nothing left to send
export function resolveDueStep(
  steps: FollowUpStep[],
  dueStep: number,
  ctx: RecipientReplyContext
):
  | { kind: "send"; step: FollowUpStep }
  | { kind: "defer"; step: FollowUpStep; delaySteps: FollowUpStep[] }
  | { kind: "end" } {
  const remaining = steps
    .filter((s) => s.step_number >= dueStep)
    .sort((a, b) => a.step_number - b.step_number);
  if (remaining.length === 0) return { kind: "end" };
  for (let i = 0; i < remaining.length; i++) {
    const s = remaining[i];
    if (evaluate(s.condition, ctx)) {
      // The first remaining step's delay has already elapsed.
      return i === 0
        ? { kind: "send", step: s }
        : { kind: "defer", step: s, delaySteps: remaining.slice(1, i + 1) };
    }
  }
  return { kind: "end" };
}

// The step that follows `stepNumber` in sequence order, or null at the end.
// Conditions are NOT checked here — they're evaluated when it comes due.
export function stepAfter(steps: FollowUpStep[], stepNumber: number): FollowUpStep | null {
  return (
    steps
      .filter((s) => s.step_number > stepNumber)
      .sort((a, b) => a.step_number - b.step_number)[0] ?? null
  );
}

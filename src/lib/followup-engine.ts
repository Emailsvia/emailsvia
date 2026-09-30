import "server-only";
import { addDelay } from "./sequence-schedule";
import { evaluate, type FollowUpStep, type RecipientReplyContext } from "./follow-up-condition";
import {
  activityKind,
  matchedSituations,
  type Profile,
  type RuleParams,
  type SituationContext,
  type SituationKey,
} from "./situations";

// The follow-up decision: given what a recipient has done, which email is
// next and when. Pure (no DB) so it's deterministic and easy to reason about;
// src/lib/followup-rules.ts builds the inputs and tick/route.ts acts on it.
//
// Safety comes first and lives outside this function: a reply, bounce,
// unsubscribe or suppression takes the recipient out of status 'sent' (or
// is caught by tick's pre-send checks) before any rule is consulted.
//
// Order:
//   1. campaign cap on follow-ups per person
//   2. the campaign's rules, top to bottom: the first rule whose situations
//      include one the recipient is in, and that still has an unsent email,
//      wins. A matching rule with nothing left either ends the sequence or
//      falls through to the next rule (its then_action).
//   3. the default step list (follow_up_steps), as the built-in last rule.
//   4. when all of that says "done", a "finished the sequence, no reply" rule
//      can re-engage later (its emails don't count toward the cap).

export type RuleEmail = {
  id: string;
  position: number;
  delay_value: number;
  delay_unit: "hours" | "days" | "business_days";
  anchor: "last_email" | "activity";
  thread_mode: "same" | "new";
  subject: string | null;
  template: string;
};

export type Rule = {
  id: string;
  position: number;
  name: string;
  enabled: boolean;
  situations: string[];
  params: RuleParams;
  then_action: "end" | "next_rule";
  emails: RuleEmail[];
};

export type EngineConfig = {
  tz: string;
  maxFollowUps: number;
  minGapDays: number; // business days between any two emails to one person
  rules: Rule[];
  fallback: FollowUpStep[];
  situationCtx: SituationContext;
  // Move each email (not the click/open-triggered ones) to the hour this
  // person usually opens mail, when we know it.
  sendTimeOptimization?: boolean;
};

export type EngineRecipient = {
  followUpsSent: number;
  lastSentAt: Date;
  nextStepNumber: number | null; // pointer into the default step list
  sentRuleEmailIds: string[];
  profile: Profile;
  lastOpenedAt: Date | null;
  lastClickedAt: Date | null;
  oooUntil: Date | null;
  // Local hour (campaign tz) they usually open mail; null = unknown.
  preferredHour?: number | null;
};

export type Choice =
  | { source: "rule"; rule: Rule; email: RuleEmail; matched: SituationKey[] }
  | { source: "fallback"; step: FollowUpStep; skippedSteps: number[] };

export type Decision =
  | { kind: "send"; due: Date; choice: Choice }
  | { kind: "wait"; due: Date; choice: Choice }
  | { kind: "end"; why: string };

// An email anchored to the recipient's activity ("1 day after they clicked")
// still never goes sooner than this after our previous email.
export const ACTIVITY_FLOOR_HOURS = 4;

function plus(from: Date, value: number, unit: RuleEmail["delay_unit"], tz: string): Date {
  if (unit === "hours") return new Date(from.getTime() + value * 3_600_000);
  return addDelay(from, value, unit, tz);
}

function localHour(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d));
}
function isWeekend(d: Date, tz: string): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return wd === "Sat" || wd === "Sun";
}

// Send-time optimisation: the first top-of-hour at or after `due` whose
// local hour is the one they usually open mail at. Only ever later, by
// under a day; business-day emails don't slide onto a weekend.
export function atPreferredHour(
  due: Date,
  hour: number | null | undefined,
  tz: string,
  businessDays: boolean
): Date {
  if (hour == null) return due;
  const start = new Date(Math.ceil(due.getTime() / 3_600_000) * 3_600_000);
  for (let i = 0; i < 25; i++) {
    let t = new Date(start.getTime() + i * 3_600_000);
    if (localHour(t, tz) !== hour) continue;
    for (let k = 0; businessDays && k < 3 && isWeekend(t, tz); k++) t = new Date(t.getTime() + 86_400_000);
    return t;
  }
  return due;
}

function tuned(cfg: EngineConfig, r: EngineRecipient, due: Date, unit: string | null | undefined): Date {
  return cfg.sendTimeOptimization ? atPreferredHour(due, r.preferredHour, cfg.tz, unit === "business_days") : due;
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function gapFloor(cfg: EngineConfig, r: EngineRecipient): Date {
  return cfg.minGapDays > 0 ? addDelay(r.lastSentAt, cfg.minGapDays, "business_days", cfg.tz) : r.lastSentAt;
}

function ruleEmailDue(cfg: EngineConfig, r: EngineRecipient, email: RuleEmail, matched: SituationKey[]): Date {
  if (email.anchor === "activity") {
    const kind = activityKind(matched);
    const at =
      kind === "click" ? r.lastClickedAt : kind === "open" ? r.lastOpenedAt : kind === "ooo" ? r.oooUntil : null;
    const due = plus(at ?? r.lastSentAt, email.delay_value, email.delay_unit, cfg.tz);
    return later(due, new Date(r.lastSentAt.getTime() + ACTIVITY_FLOOR_HOURS * 3_600_000));
  }
  return tuned(cfg, r, later(plus(r.lastSentAt, email.delay_value, email.delay_unit, cfg.tz), gapFloor(cfg, r)), email.delay_unit);
}

// Next default step whose (legacy) condition passes, with its due time.
// Delays chain from our last email through any skipped steps.
function fallbackChoice(
  cfg: EngineConfig,
  r: EngineRecipient,
  replyCtx: RecipientReplyContext
): { step: FollowUpStep; skipped: number[]; due: Date } | null {
  if (r.nextStepNumber == null || cfg.fallback.length === 0) return null;
  const remaining = cfg.fallback
    .filter((s) => s.step_number >= r.nextStepNumber!)
    .sort((a, b) => a.step_number - b.step_number);
  let at = r.lastSentAt;
  const skipped: number[] = [];
  for (const s of remaining) {
    at = addDelay(at, s.delay_days, s.delay_unit ?? "days", cfg.tz);
    if (evaluate(s.condition, replyCtx)) {
      return { step: s, skipped, due: tuned(cfg, r, later(at, gapFloor(cfg, r)), s.delay_unit) };
    }
    skipped.push(s.step_number);
  }
  return null;
}

// "Finished the sequence, no reply": its next unsent email, timed from our
// last email (min gap applies). Null when there's no such rule or it's used up.
function finishedChoice(cfg: EngineConfig, r: EngineRecipient, now: Date): Decision | null {
  const rule = cfg.rules
    .filter((x) => x.enabled && x.emails.length > 0 && x.situations.includes("sequence_finished"))
    .sort((a, b) => a.position - b.position)[0];
  if (!rule) return null;
  const sent = new Set(r.sentRuleEmailIds);
  const email = [...rule.emails].sort((a, b) => a.position - b.position).find((e) => !sent.has(e.id));
  if (!email) return null;
  const due = tuned(cfg, r, later(plus(r.lastSentAt, email.delay_value, email.delay_unit, cfg.tz), gapFloor(cfg, r)), email.delay_unit);
  const choice: Choice = { source: "rule", rule, email, matched: ["sequence_finished"] };
  return { kind: due.getTime() <= now.getTime() ? "send" : "wait", due, choice };
}

export function decide(
  cfg: EngineConfig,
  r: EngineRecipient,
  replyCtx: RecipientReplyContext,
  now: Date
): Decision {
  const d = decideSequence(cfg, r, replyCtx, now);
  return d.kind === "end" ? finishedChoice(cfg, r, now) ?? d : d;
}

function decideSequence(
  cfg: EngineConfig,
  r: EngineRecipient,
  replyCtx: RecipientReplyContext,
  now: Date
): Decision {
  if (r.followUpsSent >= cfg.maxFollowUps) {
    return { kind: "end", why: `Reached the limit of ${cfg.maxFollowUps} follow-ups per person` };
  }
  const rules = cfg.rules
    .filter((x) => x.enabled && x.emails.length > 0)
    .sort((a, b) => a.position - b.position);
  const sent = new Set(r.sentRuleEmailIds);
  for (const rule of rules) {
    const matched = matchedSituations(rule.situations, r.profile, rule.params, cfg.situationCtx);
    if (matched.length === 0) continue;
    const email = [...rule.emails].sort((a, b) => a.position - b.position).find((e) => !sent.has(e.id));
    if (!email) {
      if (rule.then_action === "end") {
        return { kind: "end", why: `Sent every email in "${rule.name || "rule"}"` };
      }
      continue;
    }
    const due = ruleEmailDue(cfg, r, email, matched);
    const choice: Choice = { source: "rule", rule, email, matched };
    return { kind: due.getTime() <= now.getTime() ? "send" : "wait", due, choice };
  }
  const fb = fallbackChoice(cfg, r, replyCtx);
  if (fb) {
    const choice: Choice = { source: "fallback", step: fb.step, skippedSteps: fb.skipped };
    return { kind: fb.due.getTime() <= now.getTime() ? "send" : "wait", due: fb.due, choice };
  }
  return {
    kind: "end",
    why: rules.length > 0 ? "No rule matches and the default sequence is finished" : "Sequence complete",
  };
}

export function choiceLabel(c: Choice): { rule_id: string | null; rule_name: string; matched: string[] } {
  return c.source === "rule"
    ? { rule_id: c.rule.id, rule_name: c.rule.name || "Rule", matched: c.matched }
    : { rule_id: null, rule_name: "Default sequence", matched: ["no_reply"] };
}

// Recipient situations: what a recipient's activity means, as named states a
// follow-up rule can target ("didn't open", "clicked a link", …). Pure and
// client-safe: the campaign editor uses the same functions to show how many
// people each rule matches right now, so the preview and the send loop
// can't disagree. See docs/MASTER_FOLLOW_UP_SYSTEM.md §4.
//
// Only human activity counts (machine opens/clicks are flagged at capture,
// src/lib/bot-detect.ts). Replies, bounces and unsubscribes never reach the
// rules: they stop the sequence before any rule is looked at.

import { linkKey } from "./link-key";

export type SituationKey =
  // engagement, no reply yet (rules can target these today)
  | "not_opened"
  | "opened_no_click"
  | "opened_repeatedly"
  | "clicked"
  | "clicked_link"
  | "clicked_meeting_link"
  | "went_quiet"
  | "back_from_ooo"
  | "no_reply"
  // after a reply / after the sequence: each is a rule on its own, handled
  // outside the per-email matching (see AFTER_REPLY)
  | "replied_not_now"
  | "thread_stalled"
  | "sequence_finished"
  | "referred";

export type SituationGroup = "engagement" | "after_reply";

export type SituationDef = {
  key: SituationKey;
  label: string;
  // What it probably means, shown under the chip.
  meaning: string;
  group: SituationGroup;
  // Needs open/click tracking on the campaign to ever match.
  needsTracking: boolean;
  // false = listed in the picker but not selectable yet.
  available: boolean;
  // Default ordering when rules are auto-placed: stronger signals first.
  strength: number;
};

export const SITUATIONS: SituationDef[] = [
  { key: "clicked_meeting_link", label: "Clicked your meeting link", meaning: "Nearly booked, then dropped off", group: "engagement", needsTracking: true, available: true, strength: 90 },
  { key: "clicked_link", label: "Clicked a specific link", meaning: "Interested in that exact thing (pricing, a case study…)", group: "engagement", needsTracking: true, available: true, strength: 85 },
  { key: "clicked", label: "Clicked any link", meaning: "Actively curious", group: "engagement", needsTracking: true, available: true, strength: 80 },
  { key: "opened_repeatedly", label: "Opened several times", meaning: "Considering it, or forwarded it internally", group: "engagement", needsTracking: true, available: true, strength: 70 },
  { key: "opened_no_click", label: "Opened, didn't click", meaning: "Saw it, wasn't compelled", group: "engagement", needsTracking: true, available: true, strength: 60 },
  { key: "went_quiet", label: "Engaged, then went quiet", meaning: "Interest faded", group: "engagement", needsTracking: true, available: true, strength: 55 },
  { key: "not_opened", label: "Didn't open", meaning: "Didn't see it: buried, filtered, or the subject didn't land", group: "engagement", needsTracking: true, available: true, strength: 40 },
  { key: "back_from_ooo", label: "Back from out-of-office", meaning: "Their auto-reply pause just ended", group: "engagement", needsTracking: false, available: true, strength: 95 },
  { key: "no_reply", label: "Hasn't replied (anyone)", meaning: "Catch-all: everyone still in the sequence", group: "engagement", needsTracking: false, available: true, strength: 0 },
  { key: "replied_not_now", label: 'Replied "not now"', meaning: "Timing objection: re-engage on the date they gave, or later", group: "after_reply", needsTracking: false, available: true, strength: 0 },
  { key: "thread_stalled", label: "You replied, they went quiet", meaning: "Conversation stalled: nudge (waits for your approval)", group: "after_reply", needsTracking: false, available: true, strength: 0 },
  { key: "sequence_finished", label: "Finished the sequence, no reply", meaning: "Re-engage later with a new angle", group: "after_reply", needsTracking: false, available: true, strength: 0 },
  { key: "referred", label: "Was referred to you", meaning: "First email to someone a prospect pointed you to", group: "after_reply", needsTracking: false, available: true, strength: 0 },
];

export const SITUATION_BY_KEY = new Map(SITUATIONS.map((s) => [s.key, s]));

export function isAvailableSituation(k: string): k is SituationKey {
  return !!SITUATION_BY_KEY.get(k as SituationKey)?.available;
}

// Situations that are rules of their own: never mixed with others in one
// rule, never matched per email. not_now / thread_stalled schedule a
// follow-up from the reply (src/lib/nurture.ts); sequence_finished runs when
// the sequence would otherwise end; referred supplies a referral's first email.
export const AFTER_REPLY: ReadonlySet<SituationKey> = new Set([
  "replied_not_now",
  "thread_stalled",
  "sequence_finished",
  "referred",
]);

export function isAfterReply(k: string): boolean {
  return AFTER_REPLY.has(k as SituationKey);
}

// Per-rule tuning for the situations that take a parameter.
export type RuleParams = {
  min_opens?: number;       // opened_repeatedly (default 3)
  link_keys?: string[];     // clicked_link: normalised with linkKey()
  quiet_after?: number;     // went_quiet: emails with no activity (default 2)
};

export const DEFAULT_MIN_OPENS = 3;
export const DEFAULT_QUIET_AFTER = 2;

// What we know about a recipient, reduced to what situations look at.
export type Profile = {
  opens: number;         // human opens
  clicks: number;        // human clicks
  machineOpens: number;  // Apple MPP / prefetch: "can't tell"
  linkKeys: string[];    // links they (a human) clicked
  // Emails we sent after their last human open/click (0 if never engaged).
  quietEmails: number;
  // Their out-of-office pause ended and nothing was sent since.
  backFromOoo: boolean;
};

export type SituationContext = {
  tracking: boolean;              // campaign has open/click tracking on
  meetingLinkKey: string | null;  // user_settings.meeting_link, normalised
};

// "acme.com/pricing" matches a click on acme.com/pricing and anything under
// it (acme.com/pricing/teams), never acme.com/pricing-old.
function clickedAny(profile: Profile, keys: string[]): boolean {
  return keys.some((k) => profile.linkKeys.some((c) => c === k || c.startsWith(`${k}/`)));
}

export function matches(key: SituationKey, p: Profile, params: RuleParams, ctx: SituationContext): boolean {
  const t = ctx.tracking;
  switch (key) {
    case "no_reply":
      return true;
    case "not_opened":
      // Any machine open means "can't tell", not "didn't open".
      return t && p.opens === 0 && p.clicks === 0 && p.machineOpens === 0;
    case "opened_no_click":
      return t && p.opens > 0 && p.clicks === 0;
    case "opened_repeatedly":
      return t && p.opens >= Math.max(2, params.min_opens ?? DEFAULT_MIN_OPENS);
    case "clicked":
      return t && p.clicks > 0;
    case "clicked_link": {
      const keys = (params.link_keys ?? []).map((k) => linkKey(k)).filter((k): k is string => !!k);
      return t && keys.length > 0 && clickedAny(p, keys);
    }
    case "clicked_meeting_link":
      return t && !!ctx.meetingLinkKey && clickedAny(p, [ctx.meetingLinkKey]);
    case "went_quiet":
      return t && (p.opens > 0 || p.clicks > 0) && p.quietEmails >= Math.max(1, params.quiet_after ?? DEFAULT_QUIET_AFTER);
    case "back_from_ooo":
      return p.backFromOoo;
    default:
      return false; // not available yet
  }
}

// The subset of `keys` the recipient is in right now.
export function matchedSituations(
  keys: readonly string[],
  p: Profile,
  params: RuleParams,
  ctx: SituationContext
): SituationKey[] {
  return keys.filter((k): k is SituationKey => isAvailableSituation(k) && matches(k, p, params, ctx));
}

// Which activity a rule email anchored to "the activity" counts from.
export function activityKind(matched: SituationKey[]): "click" | "open" | "ooo" | null {
  if (matched.some((k) => k === "clicked" || k === "clicked_link" || k === "clicked_meeting_link")) return "click";
  if (matched.some((k) => k === "opened_no_click" || k === "opened_repeatedly")) return "open";
  if (matched.includes("back_from_ooo")) return "ooo";
  return null;
}

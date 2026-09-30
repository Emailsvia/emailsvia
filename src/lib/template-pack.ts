// EmailsVia's built-in follow-up templates: one slot per situation a rule
// can target (docs/MASTER_FOLLOW_UP_SYSTEM.md §8). Every account sees them in
// the campaign rule editor ("From templates…") and on /app/templates.
//
// The copy is supplied separately: a slot with an empty `body` shows as
// "coming soon" and can't be picked. To publish one, fill in `subject`
// (optional; used when sent as a new email) and `body` (Markdown; merge tags
// like {{First Name}}, {{Company}}, {{Referred By}}, fallbacks and spintax
// all work). Nothing else needs to change.
//
// Client-safe: plain data, no imports beyond types.

import type { SituationKey } from "./situations";

export type PackTemplate = {
  // Stable id: referenced by the editor and kept across copy edits.
  id: string;
  situation: SituationKey;
  name: string;
  // What the email should achieve (shown next to the slot).
  goal: string;
  // Suggested timing/threading, applied when the template is used in a rule.
  suggested: {
    delay_value: number;
    delay_unit: "hours" | "days" | "business_days";
    anchor: "last_email" | "activity";
    thread_mode: "same" | "new";
  };
  subject: string | null;
  body: string;
};

export const TEMPLATE_PACK: PackTemplate[] = [
  {
    id: "pack-not-opened",
    situation: "not_opened",
    name: "Didn't open: short re-send",
    goal: "Get it seen: new subject, 2–3 lines, same core ask.",
    suggested: { delay_value: 3, delay_unit: "business_days", anchor: "last_email", thread_mode: "new" },
    subject: null,
    body: "",
  },
  {
    id: "pack-opened-no-click",
    situation: "opened_no_click",
    name: "Opened, didn't click: new angle",
    goal: "A new angle or proof point, with a soft interest CTA.",
    suggested: { delay_value: 3, delay_unit: "business_days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-opened-repeatedly",
    situation: "opened_repeatedly",
    name: "Opened several times: loop someone in?",
    goal: "\"Should I loop in someone else?\", or a direct question.",
    suggested: { delay_value: 2, delay_unit: "business_days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-clicked",
    situation: "clicked",
    name: "Clicked a link: build on the interest",
    goal: "Build on what they looked at and offer a short call.",
    suggested: { delay_value: 1, delay_unit: "days", anchor: "activity", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-clicked-link",
    situation: "clicked_link",
    name: "Clicked a specific link",
    goal: "Speak to that exact interest (pricing, a case study…).",
    suggested: { delay_value: 1, delay_unit: "days", anchor: "activity", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-clicked-meeting-link",
    situation: "clicked_meeting_link",
    name: "Clicked the meeting link, didn't book",
    goal: "Offer two specific times, or resend the link.",
    suggested: { delay_value: 1, delay_unit: "days", anchor: "activity", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-went-quiet",
    situation: "went_quiet",
    name: "Engaged, then went quiet: break-up",
    goal: "A short, no-pressure break-up email.",
    suggested: { delay_value: 7, delay_unit: "business_days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-back-from-ooo",
    situation: "back_from_ooo",
    name: "Back from out-of-office",
    goal: "\"Welcome back, resurfacing this.\"",
    suggested: { delay_value: 1, delay_unit: "business_days", anchor: "activity", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-no-reply",
    situation: "no_reply",
    name: "Hasn't replied: gentle bump",
    goal: "A short bump for anyone no other rule covers.",
    suggested: { delay_value: 3, delay_unit: "business_days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-not-now",
    situation: "replied_not_now",
    name: "Said \"not now\": circling back",
    goal: "\"Circling back as promised\", on the date they gave.",
    suggested: { delay_value: 90, delay_unit: "days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-thread-stalled",
    situation: "thread_stalled",
    name: "You replied, they went quiet: nudge",
    goal: "A conversational nudge in the same thread (sent after your approval).",
    suggested: { delay_value: 3, delay_unit: "business_days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-referred",
    situation: "referred",
    name: "Referred: first email to the new contact",
    goal: "Name who referred you ({{Referred By}}) and make the ask.",
    suggested: { delay_value: 1, delay_unit: "days", anchor: "last_email", thread_mode: "same" },
    subject: null,
    body: "",
  },
  {
    id: "pack-sequence-finished",
    situation: "sequence_finished",
    name: "Finished the sequence: re-engage later",
    goal: "Re-engagement with a new angle, months later.",
    suggested: { delay_value: 60, delay_unit: "days", anchor: "last_email", thread_mode: "new" },
    subject: null,
    body: "",
  },
];

export const isPackReady = (t: PackTemplate) => t.body.trim() !== "";

export function packFor(situation: string): PackTemplate | null {
  return TEMPLATE_PACK.find((t) => t.situation === situation && isPackReady(t)) ?? null;
}

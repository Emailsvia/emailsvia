"use client";

import { useCallback, useEffect, useState } from "react";
import StatusPill from "@/components/app/StatusPill";
import IntentBadge, { type Intent } from "@/components/app/IntentBadge";
import { MACHINE_REASON_LABEL, type MachineReason } from "@/lib/bot-detect";
import { SITUATION_BY_KEY, type SituationKey } from "@/lib/situations";

// Engagement summary per recipient, used by the campaign's recipients table
// (from /api/campaigns/[id]/activity). Human activity only.
export type ActivityRecipient = {
  id: string;
  opens: number;
  clicks: number;
  machine_opens: number;
  replied: boolean;
  score: number;
  last_activity_at: string | null;
  last_activity_type: string | null;
};

export type DrawerPerson = { id: string; name: string; email: string; company: string };

type TimelineEvent = {
  id: string;
  type: string;
  occurred_at: string;
  step_number: number | null;
  send_log_id: string | null;
  is_machine: boolean;
  machine_reason: string | null;
  data: Record<string, unknown>;
};

type RecipientState = {
  id: string;
  status: string;
  stop_reason: string | null;
  error: string | null;
  created_at: string;
  next_follow_up_at: string | null;
  next_step_number: number | null;
  follow_up_count: number | null;
  open_count: number;
  machine_open_count: number;
  click_count: number;
  machine_click_count: number;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  clicked_link_keys: string[];
  last_activity_at: string | null;
  last_activity_type: string | null;
  ooo_until: string | null;
};

// Why a sequence ended (recipients.stop_reason / sequence_stopped.reason).
export const STOP_REASON_LABEL: Record<string, string> = {
  replied: "Replied, sequence stopped",
  domain_replied: "Colleague replied, stopped",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  suppressed: "On do-not-contact list",
  merge_failed: "Follow-up skipped: missing merge field",
  send_failed: "Follow-up failed",
  completed: "Sequence complete",
  meeting_booked: "Meeting booked, follow-ups stopped",
  guard_failed: "Follow-ups stopped: couldn't read the inbox to check for replies",
};

const SKIP_REASON_LABEL: Record<string, string> = {
  missing_merge_field: "missing merge field",
  suppressed: "on your do-not-contact list",
  unsubscribed: "unsubscribed earlier",
  invalid_address: "invalid address",
  domain_replied: "a colleague already replied",
};

const UNSUB_METHOD_LABEL: Record<string, string> = {
  one_click: "one-click unsubscribe in their inbox",
  confirm_page: "the unsubscribe link",
  reply: "asked in a reply",
  unknown: "",
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function ago(dt: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(dt).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function emailName(step: number | null | undefined) {
  if (step === null || step === undefined) return null;
  return step === 0 ? "first email" : `follow-up ${step}`;
}

function shortUA(ua: unknown): string {
  if (typeof ua !== "string" || !ua) return "";
  if (/iphone|ipad/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return "";
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

// "Rule: Clicked a link · because: clicked any link"
function because(d: Record<string, unknown>): string | null {
  const rule = str(d.rule_name);
  const matched = (Array.isArray(d.because) ? d.because : Array.isArray(d.matched) ? d.matched : []) as string[];
  const why = matched
    .filter((k) => k !== "no_reply")
    .map((k) => SITUATION_BY_KEY.get(k as SituationKey)?.label.toLowerCase() ?? k)
    .join(", ");
  if (!rule) return null;
  return why ? `${rule} · because they: ${why}` : rule;
}

type Tone = "neutral" | "good" | "warn" | "bad" | "muted";

function describe(e: TimelineEvent): { icon: string; label: string; detail?: string | null; tone: Tone; intent?: string } {
  const d = e.data ?? {};
  const email = emailName(e.step_number);
  const onEmail = email ? ` · ${email}` : "";
  switch (e.type) {
    case "sent": {
      const kind = str(d.kind);
      const label =
        kind === "nurture"
          ? "Follow-up after their reply sent"
          : e.step_number && e.step_number > 0 ? `Follow-up ${e.step_number} sent` : kind === "retry" ? "First email sent (retry)" : "First email sent";
      return {
        icon: ICON.mail,
        label,
        detail: [because(d), str(d.subject), str(d.sender) && `from ${d.sender}`, d.thread_mode === "new" ? "new email" : null]
          .filter(Boolean)
          .join(" · "),
        tone: "neutral",
      };
    }
    case "send_failed": {
      const retry = d.will_retry ? (str(d.retry_at) ? `retrying ${fmt(String(d.retry_at))}` : "will retry") : "not retried";
      if (d.stage === "reply_check") {
        return { icon: ICON.warn, label: "Couldn't check the inbox before the follow-up", detail: [str(d.error), retry].filter(Boolean).join(" · "), tone: "warn" };
      }
      if (d.error_class === "sender_auth") {
        return { icon: ICON.warn, label: "Receiver rejected the sender's domain authentication", detail: "Campaign paused until DNS (SPF/DKIM/DMARC) is fixed", tone: "bad" };
      }
      return { icon: ICON.warn, label: `Send failed${onEmail}`, detail: [str(d.error), retry].filter(Boolean).join(" · "), tone: "warn" };
    }
    case "skipped": {
      const reason = str(d.reason) ?? "";
      let detail = str(d.detail);
      if (reason === "missing_merge_field" && Array.isArray(d.missing)) detail = `Empty: ${(d.missing as string[]).join(", ")}`;
      if (reason === "domain_replied" && str(d.colleague)) detail = `${d.colleague} replied`;
      return { icon: ICON.skip, label: `Not sent${onEmail}: ${SKIP_REASON_LABEL[reason] ?? reason}`, detail, tone: "warn" };
    }
    case "bounced":
      return {
        icon: ICON.bounce,
        label: "Bounced",
        detail: [str(d.detail), d.source === "dsn" ? "delivery-failure notice" : d.source === "smtp" ? "rejected while sending" : d.source === "reply_label" ? "labelled as a bounce" : null].filter(Boolean).join(" · "),
        tone: "bad",
      };
    case "opened":
      return e.is_machine
        ? { icon: ICON.eye, label: `Automated open${onEmail}`, detail: MACHINE_REASON_LABEL[e.machine_reason as MachineReason] ?? e.machine_reason, tone: "muted" }
        : { icon: ICON.eye, label: `Opened${onEmail}`, detail: shortUA(d.user_agent), tone: "neutral" };
    case "clicked":
      return e.is_machine
        ? { icon: ICON.link, label: `Automated click${onEmail}`, detail: [str(d.url), MACHINE_REASON_LABEL[e.machine_reason as MachineReason]].filter(Boolean).join(" · "), tone: "muted" }
        : { icon: ICON.link, label: `Clicked${onEmail}`, detail: str(d.url), tone: "good" };
    case "replied":
      return {
        icon: ICON.reply,
        label: `Replied${onEmail}`,
        detail: [str(d.subject), str(d.snippet)].filter(Boolean).join(" — "),
        tone: "good",
      };
    case "auto_replied":
      return { icon: ICON.clock, label: "Auto-reply (out of office)", detail: str(d.subject), tone: "muted" };
    case "intent_labeled": {
      const who = d.source === "manual" ? "by you" : typeof d.confidence === "number" ? `by AI · ${Math.round(Number(d.confidence) * 100)}%` : "by AI";
      return { icon: ICON.tag, label: "Reply labelled", detail: who, tone: "neutral", intent: str(d.intent) ?? undefined };
    }
    case "unsubscribed": {
      const how = UNSUB_METHOD_LABEL[str(d.method) ?? "unknown"] ?? "";
      const other = str(d.via_recipient_id) ? "from another campaign" : null;
      return { icon: ICON.stop, label: `Unsubscribed${onEmail}`, detail: [how, other].filter(Boolean).join(" · "), tone: "bad" };
    }
    case "sequence_paused":
      return {
        icon: ICON.pause,
        label: str(d.until) ? `Follow-ups paused until ${fmt(String(d.until))}` : "Follow-ups paused",
        detail: d.reason === "out_of_office" ? "Out of office" : str(d.reason),
        tone: "muted",
      };
    case "sequence_resumed":
      if (d.reason === "new_activity") {
        return {
          icon: ICON.play,
          label: "Follow-ups reopened by new activity",
          detail: [because(d), str(d.next_at) && `next ${fmt(String(d.next_at))}`].filter(Boolean).join(" · "),
          tone: "good",
        };
      }
      return { icon: ICON.play, label: "Follow-ups resumed", detail: d.reason === "reply_was_out_of_office" ? "Their reply was an out-of-office" : str(d.reason), tone: "neutral" };
    case "sequence_stopped": {
      const reason = str(d.reason) ?? "";
      return { icon: ICON.stop, label: STOP_REASON_LABEL[reason] ?? `Sequence stopped: ${reason}`, detail: str(d.colleague) ? `${d.colleague} replied` : str(d.why), tone: reason === "completed" ? "muted" : "warn" };
    }
    case "followup_decided":
      if (d.outcome === "scheduled") {
        const why = d.kind === "not_now" ? "They said “not now”" : d.kind === "thread_stalled" ? "In case they go quiet after your reply" : null;
        return {
          icon: ICON.clock,
          label: `Follow-up scheduled for ${str(d.next_at) ? fmt(String(d.next_at)) : "later"}`,
          detail: [why, d.due_source === "their_words" ? "the date they gave" : null, str(d.rule_name), d.needs_approval ? "needs your approval" : null].filter(Boolean).join(" · "),
          tone: "neutral",
        };
      }
      if (d.outcome === "needs_approval") {
        return { icon: ICON.warn, label: "Nudge ready: waiting for your approval", detail: "Approve or skip it on the campaign page", tone: "warn" };
      }
      if (d.outcome === "approved" || d.outcome === "skipped") {
        return { icon: d.outcome === "approved" ? ICON.play : ICON.skip, label: d.outcome === "approved" ? "You approved the follow-up" : "You skipped the follow-up", tone: "neutral" };
      }
      if (d.outcome === "cancelled") {
        const why = ({ they_replied: "they wrote again", relabelled: "the reply was relabelled", you_replied_again: "you replied again", unsubscribed: "unsubscribed", suppressed: "on your do-not-contact list", bounced: "bounced" } as Record<string, string>)[String(d.why)] ?? str(d.why);
        return { icon: ICON.stop, label: "Scheduled follow-up cancelled", detail: why, tone: "muted" };
      }
      if (d.outcome === "skip") {
        return {
          icon: ICON.skip,
          label: `Follow-up ${d.skipped_step} skipped`,
          detail: [str(d.why), d.next_step ? `follow-up ${d.next_step} due ${str(d.next_at) ? fmt(String(d.next_at)) : ""}` : null].filter(Boolean).join(" · "),
          tone: "muted",
        };
      }
      if (d.outcome === "wait" || d.outcome === "rescheduled") {
        return {
          icon: ICON.clock,
          label: d.outcome === "rescheduled" ? "Next follow-up moved up after new activity" : "Next follow-up chosen",
          detail: [because(d), str(d.next_at) && `due ${fmt(String(d.next_at))}`].filter(Boolean).join(" · "),
          tone: "neutral",
        };
      }
      return { icon: ICON.stop, label: "No follow-up left to send", detail: str(d.why), tone: "muted" };
    case "you_replied":
      return { icon: ICON.reply, label: "You replied", detail: [str(d.subject), str(d.snippet)].filter(Boolean).join(" — "), tone: "neutral" };
    case "meeting_booked":
      return {
        icon: ICON.play,
        label: "Meeting booked",
        detail: [str(d.event_name), str(d.start_time) && `for ${fmt(String(d.start_time))}`, str(d.provider) === "calcom" ? "via Cal.com" : str(d.provider) === "calendly" ? "via Calendly" : null].filter(Boolean).join(" · "),
        tone: "good",
      };
    case "referral_added":
      return { icon: ICON.plus, label: "Referral added as a lead", detail: [str(d.name), str(d.email)].filter(Boolean).join(" · "), tone: "good" };
    default:
      return { icon: ICON.dot, label: e.type, tone: "neutral" };
  }
}

const TONE_COLOR: Record<Tone, string | undefined> = {
  neutral: undefined,
  good: "rgb(110 231 183)",
  warn: "rgb(255 180 110)",
  bad: "rgb(252 165 165)",
  muted: undefined,
};

const ICON = {
  mail: "M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  reply: "M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2",
  warn: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  skip: "M5 4l10 8-10 8V4zM19 5v14",
  bounce: "M18 6L6 18M6 6l12 12",
  clock: "M12 6v6l4 2M12 22a10 10 0 100-20 10 10 0 000 20z",
  tag: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01",
  stop: "M6 6h12v12H6z",
  pause: "M10 4H6v16h4zM18 4h-4v16h4z",
  play: "M5 3l14 9-14 9V3z",
  plus: "M12 5v14M5 12h14",
  dot: "M5 12h14",
};

export default function ActivityDrawer({
  campaignId,
  person,
  onClose,
}: {
  campaignId: string;
  person: DrawerPerson | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<RecipientState | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMachine, setShowMachine] = useState(false);

  const load = useCallback(
    async (before: string | null) => {
      if (!person) return;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: "50" });
        if (before) qs.set("before", before);
        const r = await fetch(`/api/campaigns/${campaignId}/recipients/${person.id}/timeline?${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
        const body = (await r.json()) as { recipient: RecipientState; events: TimelineEvent[]; next_before: string | null };
        setState(body.recipient);
        setEvents((prev) => (before ? [...prev, ...body.events] : body.events));
        setNextBefore(body.next_before);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [campaignId, person]
  );

  useEffect(() => {
    setState(null);
    setEvents([]);
    setNextBefore(null);
    setShowMachine(false);
    if (person) load(null);
  }, [person, load]);

  useEffect(() => {
    if (!person) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [person, onClose]);

  if (!person) return null;

  const machineCount = events.filter((e) => e.is_machine).length;
  const visible = showMachine ? events : events.filter((e) => !e.is_machine);
  const upcoming = state ? upcomingNote(state) : null;

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <aside
        className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-paper border-l border-ink-200 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Activity for ${person.name}`}
      >
        <div className="sticky top-0 bg-paper border-b border-ink-200 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">Recipient activity</div>
            <div className="text-[16px] font-semibold mt-0.5 truncate">{person.name}</div>
            <div className="text-[13px] text-ink-600 truncate">{person.company}</div>
            <div className="text-[11px] font-mono text-ink-500 truncate mt-0.5">{person.email}</div>
            {state && <div className="mt-2"><StatusPill status={state.status} /></div>}
          </div>
          <button type="button" onClick={onClose} className="btn-quiet p-1.5 shrink-0" aria-label="Close">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-3 border-b border-ink-200">
          <Stat label="Opens" value={state?.open_count ?? "–"} sub={state && state.machine_open_count > 0 ? `+${state.machine_open_count} automated` : undefined} />
          <Stat label="Clicks" value={state?.click_count ?? "–"} sub={state && state.machine_click_count > 0 ? `+${state.machine_click_count} automated` : undefined} />
          <Stat label="Last activity" value={state?.last_activity_at ? ago(state.last_activity_at) : "–"} sub={state?.last_activity_type ?? undefined} small />
        </div>

        {upcoming && (
          <div className="px-5 py-3 border-b border-ink-200 text-[12.5px] text-ink-700 flex items-center gap-2">
            <Glyph path={upcoming.icon} />
            <span>{upcoming.text}</span>
          </div>
        )}

        {state && state.clicked_link_keys.length > 0 && (
          <div className="px-5 py-3 border-b border-ink-200">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider mb-2">Links they clicked</div>
            <div className="flex flex-wrap gap-1.5">
              {state.clicked_link_keys.map((k) => (
                <span key={k} className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-ink-200 text-ink-700 break-all">{k}</span>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">History</div>
            {machineCount > 0 && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-ink-500 cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 accent-accent" checked={showMachine} onChange={(e) => setShowMachine(e.target.checked)} />
                Show automated ({machineCount})
              </label>
            )}
          </div>
          {error && <div className="text-[13px] text-[rgb(252_165_165)] mb-3">Couldn&apos;t load history: {error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div className="text-[13px] text-ink-500">No activity yet.</div>
          )}
          <ol className="space-y-4 relative">
            {visible.map((e, i) => {
              const l = describe(e);
              const color = TONE_COLOR[l.tone];
              return (
                <li key={e.id} className={`relative pl-7 ${l.tone === "muted" ? "opacity-60" : ""}`}>
                  <div
                    className="absolute left-0 top-0.5 w-5 h-5 rounded-full border border-ink-200 bg-paper flex items-center justify-center text-ink-600"
                    style={color ? { color, borderColor: color } : undefined}
                  >
                    <Glyph path={l.icon} />
                  </div>
                  {i < visible.length - 1 && (
                    <div className="absolute left-[9.5px] top-5 bottom-[-16px] w-px bg-ink-200" />
                  )}
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[13px] font-medium flex items-center gap-2">
                      {l.label}
                      {l.intent && <IntentBadge intent={l.intent as Intent} size="xs" />}
                    </span>
                    <span className="text-[11px] font-mono text-ink-500">{fmt(e.occurred_at)}</span>
                  </div>
                  {l.detail && (
                    <div className="text-[12px] text-ink-600 mt-0.5 break-words">{l.detail}</div>
                  )}
                </li>
              );
            })}
            {state && !nextBefore && !loading && (
              <li className="relative pl-7 opacity-60">
                <div className="absolute left-0 top-0.5 w-5 h-5 rounded-full border border-ink-200 bg-paper flex items-center justify-center text-ink-600">
                  <Glyph path={ICON.plus} />
                </div>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[13px] font-medium">Added to campaign</span>
                  <span className="text-[11px] font-mono text-ink-500">{fmt(state.created_at)}</span>
                </div>
              </li>
            )}
          </ol>
          {loading && <div className="text-[12px] text-ink-500 mt-4">Loading…</div>}
          {nextBefore && !loading && (
            <button type="button" className="btn-ghost text-xs mt-5" onClick={() => load(nextBefore)}>
              Load older activity
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function upcomingNote(s: RecipientState): { icon: string; text: string } | null {
  if (s.status === "sent" && s.next_follow_up_at) {
    const step = s.next_step_number ?? (s.follow_up_count ?? 0) + 1;
    const paused = s.ooo_until && new Date(s.ooo_until) > new Date();
    return {
      icon: paused ? ICON.pause : ICON.clock,
      text: paused
        ? `Out of office. Follow-up ${step} waits until ${fmt(s.next_follow_up_at)}`
        : `Next: follow-up ${step} · ${fmt(s.next_follow_up_at)}`,
    };
  }
  if (s.stop_reason && s.stop_reason !== "replied") {
    return { icon: ICON.stop, text: STOP_REASON_LABEL[s.stop_reason] ?? s.stop_reason };
  }
  return null;
}

function Glyph({ path }: { path: string }) {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function Stat({ label, value, sub, small }: { label: string; value: number | string; sub?: string; small?: boolean }) {
  return (
    <div className="px-5 py-3 border-r last:border-r-0 border-ink-200 min-w-0">
      <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">{label}</div>
      <div className={`${small ? "text-[14px] mt-1.5" : "text-[20px]"} font-bold mt-0.5 text-ink-900 truncate`}>{value}</div>
      {sub && <div className="text-[10.5px] text-ink-500 truncate">{sub.replace("_", " ")}</div>}
    </div>
  );
}

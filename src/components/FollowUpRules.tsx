"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BodyEditor from "@/components/BodyEditor";
import {
  SITUATIONS,
  SITUATION_BY_KEY,
  DEFAULT_MIN_OPENS,
  DEFAULT_QUIET_AFTER,
  isAfterReply,
  matchedSituations,
  type Profile,
  type SituationKey,
} from "@/lib/situations";
import { TEMPLATE_PACK, isPackReady, packFor } from "@/lib/template-pack";

// "Smart follow-ups": rules that pick the next email from what each
// recipient actually did (didn't open, opened, clicked, went quiet…).
// Rules are checked top to bottom; the first one that matches and still has
// an unsent email wins. The campaign's plain step list (rendered by
// CampaignForm below this) is the built-in last rule for everyone else.
// Engine: src/lib/followup-engine.ts · situations: src/lib/situations.ts.

export type RuleEmailDraft = {
  id?: string;
  key: string;
  delay_value: number;
  delay_unit: "hours" | "days" | "business_days";
  anchor: "last_email" | "activity";
  thread_mode: "same" | "new";
  subject: string;
  template: string;
};

export type RuleDraft = {
  id?: string;
  key: string;
  name: string;
  enabled: boolean;
  situations: string[];
  params: { min_opens?: number; link_keys?: string[]; quiet_after?: number };
  then_action: "end" | "next_rule";
  emails: RuleEmailDraft[];
};

// Unedited starter copy; saving is blocked while any is left.
export const RULE_PLACEHOLDER = /\[(Write|New subject)[^\]]*\]/;

let seq = 0;
const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newEmailDraft(partial: Partial<RuleEmailDraft> = {}): RuleEmailDraft {
  return {
    key: newKey(),
    delay_value: 3,
    delay_unit: "business_days",
    anchor: "last_email",
    thread_mode: "same",
    subject: "",
    template: "",
    ...partial,
  };
}

export function newRuleDraft(partial: Partial<RuleDraft> = {}): RuleDraft {
  return {
    key: newKey(),
    name: "",
    enabled: true,
    situations: [],
    params: {},
    then_action: "end",
    emails: [newEmailDraft()],
    ...partial,
  };
}

// Rows from GET /api/campaigns/[id]/follow-up-rules → drafts.
export function rulesToDrafts(rows: Array<Record<string, any>>): RuleDraft[] {
  return rows.map((r) => ({
    id: r.id,
    key: newKey(),
    name: r.name ?? "",
    enabled: r.enabled !== false,
    situations: r.situations ?? [],
    params: r.params ?? {},
    then_action: r.then_action === "next_rule" ? "next_rule" : "end",
    emails: (r.emails ?? []).map((e: Record<string, any>) => ({
      id: e.id,
      key: newKey(),
      delay_value: Number(e.delay_value),
      delay_unit: e.delay_unit,
      anchor: e.anchor,
      thread_mode: e.thread_mode,
      subject: e.subject ?? "",
      template: e.template ?? "",
    })),
  }));
}

// Drafts → PUT body rules.
export function draftsToPayload(drafts: RuleDraft[]) {
  return drafts.map((r) => ({
    id: r.id ?? null,
    name: r.name.trim() || autoName(r),
    enabled: r.enabled,
    situations: r.situations,
    params: r.params,
    then_action: r.then_action,
    emails: r.emails.map((e) => ({
      id: e.id ?? null,
      delay_value: e.delay_value,
      delay_unit: e.delay_unit,
      anchor: e.anchor,
      thread_mode: e.thread_mode,
      subject: e.subject.trim() || null,
      template: e.template,
    })),
  }));
}

export function autoName(r: RuleDraft): string {
  const labels = r.situations.map((k) => SITUATION_BY_KEY.get(k as SituationKey)?.label).filter(Boolean);
  return labels.length ? labels.join(" / ") : "New rule";
}

// A sensible starting playbook. Copy is left as bracketed placeholders:
// the user writes (or uploads) their own before the campaign can be saved.
export function recommendedRules(): RuleDraft[] {
  return [
    newRuleDraft({
      name: "Clicked a link",
      situations: ["clicked"],
      emails: [
        newEmailDraft({
          delay_value: 1,
          delay_unit: "days",
          anchor: "activity",
          template: packFor("clicked")?.body ?? "[Write the follow-up for people who clicked: build on what they looked at, offer a short call]",
        }),
      ],
    }),
    newRuleDraft({
      name: "Opened, didn't click",
      situations: ["opened_no_click", "opened_repeatedly"],
      emails: [
        newEmailDraft({
          template: packFor("opened_no_click")?.body ?? "[Write the follow-up for people who opened but didn't click: a new angle or proof point]",
        }),
      ],
    }),
    newRuleDraft({
      name: "Didn't open",
      situations: ["not_opened"],
      emails: [
        newEmailDraft({
          thread_mode: "new",
          subject: packFor("not_opened")?.subject ?? "[New subject line]",
          template: packFor("not_opened")?.body ?? "[Write a short re-send for people who didn't open: same ask, 2–3 lines]",
        }),
      ],
    }),
  ];
}

type Coverage = {
  total: number;
  meeting_link_key: string | null;
  groups: Array<{ profile: Profile; count: number }>;
};

const UNIT_LABEL: Record<RuleEmailDraft["delay_unit"], string> = {
  hours: "hours",
  days: "days",
  business_days: "business days",
};

export type LibraryTemplate = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  situations: string[];
};

// What an after-reply rule does, and what its delay counts from.
const AFTER_REPLY_HELP: Record<string, { what: string; from: string }> = {
  replied_not_now: {
    what: "When a reply is labelled \"not now\", this is sent on the date they mention (\"next quarter\", \"in March\"), or after the wait below if they don't give one. Cancelled if they write again.",
    from: "their reply",
  },
  thread_stalled: {
    what: "After you answer a reply from EmailsVia and they go quiet, this nudge is prepared. It waits for your approval on the campaign page before it's sent. Cancelled if they write back.",
    from: "your answer",
  },
  sequence_finished: {
    what: "When the follow-ups above end without a reply, this re-engages later. It doesn't count toward the per-person limit.",
    from: "our last email",
  },
  referred: {
    what: "Used as the first email to someone a prospect pointed you to (added with \"+ add as lead\" in Replies). {{Referred By}} is the person who referred them.",
    from: "",
  },
};

export default function FollowUpRules({
  campaignId,
  rules,
  onChange,
  maxFollowUps,
  minGapDays,
  sendTimeOptimization,
  onLimitsChange,
  trackingEnabled,
  onEnableTracking,
  onTestRule,
  testBusy,
  onCoverage,
}: {
  campaignId?: string;
  rules: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
  maxFollowUps: number;
  minGapDays: number;
  sendTimeOptimization: boolean;
  onLimitsChange: (v: { maxFollowUps?: number; minGapDays?: number; sendTimeOptimization?: boolean }) => void;
  trackingEnabled: boolean;
  onEnableTracking: () => void;
  onTestRule: (emails: { subject: string | null; template: string }[]) => void;
  testBusy: boolean;
  // People not matched by any rule (they get the default step list).
  onCoverage?: (fallbackCount: number | null) => void;
}) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [library, setLibrary] = useState<LibraryTemplate[] | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/follow-up-rules/coverage`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (!cancelled && c) setCoverage(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setLibrary(d.templates ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function saveTemplate(t: { name: string; subject: string | null; body: string; situations: string[] }): Promise<string> {
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(t),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return d?.error ?? `HTTP ${r.status}`;
    setLibrary((prev) => [d.template, ...(prev ?? [])]);
    return "Saved to your templates";
  }

  // First-match counts for the rules as currently edited (unsaved too).
  const counts = useMemo(() => {
    if (!coverage) return null;
    const perRule = new Map<string, number>();
    let fallback = 0;
    const ctx = { tracking: trackingEnabled, meetingLinkKey: coverage.meeting_link_key };
    for (const g of coverage.groups) {
      const hit = rules.find((r) => r.enabled && matchedSituations(r.situations, g.profile, r.params, ctx).length > 0);
      if (hit) perRule.set(hit.key, (perRule.get(hit.key) ?? 0) + g.count);
      else fallback += g.count;
    }
    return { perRule, fallback };
  }, [coverage, rules, trackingEnabled]);

  const onCoverageRef = useRef(onCoverage);
  onCoverageRef.current = onCoverage;
  useEffect(() => {
    onCoverageRef.current?.(counts ? counts.fallback : null);
  }, [counts]);

  const needsTracking = rules.some((r) =>
    r.enabled && r.situations.some((k) => SITUATION_BY_KEY.get(k as SituationKey)?.needsTracking)
  );

  function update(i: number, patch: Partial<RuleDraft>) {
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold">Smart follow-ups</span>
          <span className="text-[12px] text-ink-500">send a different email based on what each person did</span>
        </div>
        <p className="text-[12px] text-ink-500 mt-1">
          Rules are checked top to bottom; the first one that matches and still has an email to send wins.
          Anyone no rule matches gets the default sequence below. Replies, bounces and unsubscribes always
          stop follow-ups first; rules for &quot;not now&quot;, stalled conversations and referrals pick up from there.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          At most
          <input
            type="number"
            min={1}
            max={10}
            className="field-boxed w-16 text-center"
            value={maxFollowUps}
            onChange={(e) => onLimitsChange({ maxFollowUps: clamp(Number(e.target.value) || 1, 1, 10), minGapDays })}
          />
          follow-ups per person
        </label>
        <label className="flex items-center gap-2">
          at least
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            className="field-boxed w-16 text-center"
            value={minGapDays}
            onChange={(e) => onLimitsChange({ maxFollowUps, minGapDays: clamp(Number(e.target.value) || 0, 0, 30) })}
          />
          business days apart
        </label>
        <label className="flex items-center gap-2 cursor-pointer" title="Needs tracking. Waits for a clear pattern: at least two opens in the same hour. Emails triggered by a click or open still go right away.">
          <input
            type="checkbox"
            className="w-4 h-4 accent-accent"
            checked={sendTimeOptimization}
            onChange={(e) => onLimitsChange({ sendTimeOptimization: e.target.checked })}
          />
          send at the hour each person usually opens mail
        </label>
      </div>
      {sendTimeOptimization && !trackingEnabled && (
        <p className="text-[12px] text-ink-500 -mt-2">Needs tracking to learn when people open; it does nothing while tracking is off.</p>
      )}

      {needsTracking && !trackingEnabled && (
        <Callout>
          Rules about opens and clicks need tracking, which is off for this campaign.{" "}
          <button type="button" className="btn-link text-[12.5px]" onClick={onEnableTracking}>Turn on tracking</button>
          <span className="block text-ink-500 mt-1">
            Until then those rules never match. Opens are unreliable for Apple Mail users (their mail app loads
            every image); those people count as &quot;can&apos;t tell&quot;, not &quot;didn&apos;t open&quot;.
          </span>
        </Callout>
      )}

      {rules.map((r, i) => (
        <RuleCard
          key={r.key}
          index={i}
          count={rules.length}
          rule={r}
          matchCount={counts && !r.situations.some(isAfterReply) ? counts.perRule.get(r.key) ?? 0 : null}
          trackingEnabled={trackingEnabled}
          library={library}
          onSaveTemplate={saveTemplate}
          onChange={(patch) => update(i, patch)}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))}
          onMove={(dir) => move(i, dir)}
          onTest={() => onTestRule(r.emails.map((e) => ({ subject: e.subject.trim() || null, template: e.template })))}
          testBusy={testBusy}
        />
      ))}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => onChange([...rules, newRuleDraft()])} className="btn-ghost text-xs">+ Add rule</button>
        {rules.length === 0 && (
          <button type="button" onClick={() => onChange(recommendedRules())} className="btn-quiet text-xs">
            Use recommended rules
          </button>
        )}
        {coverage && (
          <span className="text-[11.5px] text-ink-500">
            {coverage.total.toLocaleString()} people are in the sequence right now
          </span>
        )}
      </div>
    </div>
  );
}

function RuleCard({
  index,
  count,
  rule,
  matchCount,
  trackingEnabled,
  library,
  onSaveTemplate,
  onChange,
  onRemove,
  onMove,
  onTest,
  testBusy,
}: {
  index: number;
  count: number;
  rule: RuleDraft;
  matchCount: number | null;
  trackingEnabled: boolean;
  library: LibraryTemplate[] | null;
  onSaveTemplate: (t: { name: string; subject: string | null; body: string; situations: string[] }) => Promise<string>;
  onChange: (patch: Partial<RuleDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onTest: () => void;
  testBusy: boolean;
}) {
  const engagement = SITUATIONS.filter((s) => s.available && s.group === "engagement");
  const afterReply = SITUATIONS.filter((s) => s.available && s.group === "after_reply");
  const has = (k: string) => rule.situations.includes(k);
  // An after-reply situation is a rule of its own (see src/lib/situations.ts).
  const special = rule.situations.find(isAfterReply) ?? null;
  const help = special ? AFTER_REPLY_HELP[special] : null;
  const isReferral = special === "referred";

  function toggle(k: string) {
    if (isAfterReply(k)) {
      onChange({
        situations: has(k) ? [] : [k],
        // A referral gets one first email (threading doesn't apply to it).
        emails: k === "referred" ? rule.emails.slice(0, 1).map((e) => ({ ...e, thread_mode: "same" as const })) : rule.emails,
      });
      return;
    }
    const base = rule.situations.filter((x) => !isAfterReply(x));
    onChange({ situations: base.includes(k) ? base.filter((x) => x !== k) : [...base, k] });
  }
  function setEmail(j: number, patch: Partial<RuleEmailDraft>) {
    onChange({ emails: rule.emails.map((e, x) => (x === j ? { ...e, ...patch } : e)) });
  }

  const chip = (s: (typeof SITUATIONS)[number]) => {
    const on = has(s.key);
    const dim = s.needsTracking && !trackingEnabled;
    return (
      <button
        key={s.key}
        type="button"
        aria-pressed={on}
        title={s.meaning + (dim ? " · needs tracking" : "")}
        onClick={() => toggle(s.key)}
        className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
          on ? "bg-ink text-paper border-ink" : "bg-surface text-ink-700 border-ink-200 hover:border-ink-400"
        } ${dim && !on ? "opacity-60" : ""}`}
      >
        {s.label}
      </button>
    );
  };

  return (
    <div className={`border border-ink-200 p-5 space-y-4 ${rule.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-display text-2xl font-medium shrink-0">R{index + 1}</span>
          <input
            className="field-boxed text-[13px] flex-1 min-w-[160px]"
            placeholder={autoName(rule)}
            value={rule.name}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-label="Rule name"
          />
        </div>
        <div className="flex items-center gap-2 text-[12px] shrink-0">
          {matchCount !== null && (
            <span className="text-ink-500" title="People in the sequence who'd get this rule if it ran now">
              {matchCount.toLocaleString()} {matchCount === 1 ? "person" : "people"} now
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" className="w-3.5 h-3.5 accent-accent" checked={rule.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
            on
          </label>
          <button type="button" className="btn-quiet px-1.5" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move rule up">↑</button>
          <button type="button" className="btn-quiet px-1.5" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move rule down">↓</button>
          <button type="button" className="btn-quiet text-xs" onClick={onRemove}>Remove</button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="label-cap mb-2">When they…</div>
          <div className="flex flex-wrap gap-1.5">{engagement.map(chip)}</div>
        </div>
        <div>
          <div className="label-cap mb-2">…or after a reply / the sequence</div>
          <div className="flex flex-wrap gap-1.5">{afterReply.map(chip)}</div>
        </div>
        {rule.situations.length === 0 && (
          <p className="text-[12px] text-ink-500">
            Pick one or more from the first row (the rule applies if the person is in any of them), or one from the second row.
          </p>
        )}
        {help && <p className="text-[12px] text-ink-600">{help.what}</p>}
        <ParamFields rule={rule} onChange={onChange} />
      </div>

      <div className="space-y-4">
        {rule.emails.map((e, j) => (
          <div key={e.key} className="border-t border-ink-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{isReferral ? "First email" : `Email ${j + 1}`}</span>
              {!isReferral && (
                <>
                  <span className="text-ink-500">· wait</span>
                  <input
                    type="number"
                    min={e.delay_unit === "hours" ? 1 : 0.5}
                    max={90}
                    step={e.delay_unit === "hours" ? 1 : 0.5}
                    className="field-boxed w-16 text-center"
                    value={e.delay_value}
                    onChange={(ev) => setEmail(j, { delay_value: clamp(Number(ev.target.value) || 1, e.delay_unit === "hours" ? 1 : 0.5, 90) })}
                  />
                  <select className="field-boxed text-[13px]" value={e.delay_unit} onChange={(ev) => setEmail(j, { delay_unit: ev.target.value as RuleEmailDraft["delay_unit"] })}>
                    {(["business_days", "days", "hours"] as const).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                  </select>
                  <span className="text-ink-500">after</span>
                  {special ? (
                    <span className="text-ink-700">{j === 0 ? help?.from : "the previous email"}</span>
                  ) : (
                    <select className="field-boxed text-[13px]" value={e.anchor} onChange={(ev) => setEmail(j, { anchor: ev.target.value as RuleEmailDraft["anchor"] })}>
                      <option value="last_email">our last email</option>
                      <option value="activity">they did it (opened / clicked)</option>
                    </select>
                  )}
                </>
              )}
              {rule.emails.length > 1 && (
                <button type="button" className="btn-quiet text-xs ml-auto" onClick={() => onChange({ emails: rule.emails.filter((_, x) => x !== j) })}>
                  Remove email
                </button>
              )}
            </div>

            {!isReferral && (
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" className="accent-accent" checked={e.thread_mode === "same"} onChange={() => setEmail(j, { thread_mode: "same" })} />
                  Reply in the same thread
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" className="accent-accent" checked={e.thread_mode === "new"} onChange={() => setEmail(j, { thread_mode: "new" })} />
                  Send as a new email
                </label>
              </div>
            )}
            <input
              className="field-boxed w-full text-[13px]"
              placeholder={
                isReferral
                  ? "Subject (blank uses the campaign subject)"
                  : e.thread_mode === "new"
                    ? "Subject (required for a new email)"
                    : "Subject (optional; blank keeps “Re: original subject”)"
              }
              value={e.subject}
              onChange={(ev) => setEmail(j, { subject: ev.target.value })}
            />
            <TemplateTools
              library={library}
              situations={rule.situations}
              email={e}
              suggestedName={`${rule.name.trim() || autoName(rule)} · ${isReferral ? "first email" : `email ${j + 1}`}`}
              onLoad={(t) => setEmail(j, { template: t.body, ...(t.subject && !e.subject.trim() ? { subject: t.subject } : {}) })}
              onSave={onSaveTemplate}
            />
            <BodyEditor
              value={e.template}
              onChange={(v) => setEmail(j, { template: v })}
              placeholder="Write the email for this situation, upload one, or pick from your templates. Merge tags like {{First Name}} work."
              minHeight={140}
            />
            {RULE_PLACEHOLDER.test(e.template) || RULE_PLACEHOLDER.test(e.subject) ? (
              <p className="text-[12px]" style={{ color: "rgb(255 180 110)" }}>Replace the [bracketed] text with your own before saving.</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
        <div className="flex items-center gap-3">
          {rule.emails.length < 5 && !isReferral && (
            <button type="button" className="btn-ghost text-xs" onClick={() => onChange({ emails: [...rule.emails, newEmailDraft({ delay_value: 4 })] })}>
              + Add email to this rule
            </button>
          )}
          <button type="button" className="btn-quiet text-xs" disabled={testBusy} onClick={onTest}>
            Send test of this rule
          </button>
        </div>
        {!special && (
          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="text-ink-500">When these run out:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="accent-accent" checked={rule.then_action === "end"} onChange={() => onChange({ then_action: "end" })} />
              stop following up
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="accent-accent" checked={rule.then_action === "next_rule"} onChange={() => onChange({ then_action: "next_rule" })} />
              try the next rule
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function ParamFields({ rule, onChange }: { rule: RuleDraft; onChange: (patch: Partial<RuleDraft>) => void }) {
  const set = (p: RuleDraft["params"]) => onChange({ params: { ...rule.params, ...p } });
  const [linksText, setLinksText] = useState((rule.params.link_keys ?? []).join("\n"));
  return (
    <div className="space-y-2">
      {rule.situations.includes("opened_repeatedly") && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
          &quot;Opened several times&quot; means at least
          <input
            type="number"
            min={2}
            max={50}
            className="field-boxed w-14 text-center"
            value={rule.params.min_opens ?? DEFAULT_MIN_OPENS}
            onChange={(e) => set({ min_opens: clamp(Math.round(Number(e.target.value) || DEFAULT_MIN_OPENS), 2, 50) })}
          />
          opens
        </label>
      )}
      {rule.situations.includes("went_quiet") && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
          &quot;Went quiet&quot; means no opens or clicks on our last
          <input
            type="number"
            min={1}
            max={10}
            className="field-boxed w-14 text-center"
            value={rule.params.quiet_after ?? DEFAULT_QUIET_AFTER}
            onChange={(e) => set({ quiet_after: clamp(Math.round(Number(e.target.value) || DEFAULT_QUIET_AFTER), 1, 10) })}
          />
          emails
        </label>
      )}
      {rule.situations.includes("clicked_link") && (
        <div>
          <div className="text-[12.5px] text-ink-700 mb-1">Which links? One per line; a page also matches anything under it.</div>
          <textarea
            className="field-boxed w-full text-[12.5px] font-mono"
            rows={2}
            placeholder={"acme.com/pricing\nacme.com/case-studies"}
            value={linksText}
            onChange={(e) => {
              setLinksText(e.target.value);
              set({ link_keys: e.target.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) });
            }}
          />
        </div>
      )}
      {rule.situations.includes("clicked_meeting_link") && (
        <p className="text-[12px] text-ink-500">Uses the meeting link from Settings.</p>
      )}
    </div>
  );
}

// Upload a file (parsed on the server: .docx, .html, .md, .txt), pick from
// the template library, or save this email to it. Loading a template copies
// it; later edits to the library don't touch this campaign.
function TemplateTools({
  library,
  situations,
  email,
  suggestedName,
  onLoad,
  onSave,
}: {
  library: LibraryTemplate[] | null;
  situations: string[];
  email: RuleEmailDraft;
  suggestedName: string;
  onLoad: (t: { subject: string | null; body: string }) => void;
  onSave: (t: { name: string; subject: string | null; body: string; situations: string[] }) => Promise<string>;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    setMsg(null);
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/templates/parse", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d?.error ?? `HTTP ${r.status}`); return; }
      onLoad({ subject: d.subject ?? null, body: d.body });
      setMsg(`Loaded ${f.name}`);
    } finally {
      setBusy(false);
    }
  }

  // Templates written for this rule's situations first.
  const sorted = useMemo(() => {
    const score = (t: LibraryTemplate) => (t.situations.some((k) => situations.includes(k)) ? 0 : 1);
    return [...(library ?? [])].sort((a, b) => score(a) - score(b));
  }, [library, situations]);
  // Built-in EmailsVia templates (src/lib/template-pack.ts); empty slots
  // show as "coming soon".
  const pack = useMemo(
    () => [...TEMPLATE_PACK].sort((a, b) => Number(!situations.includes(a.situation)) - Number(!situations.includes(b.situation))),
    [situations]
  );

  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px]">
      <button type="button" className="btn-quiet text-xs" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Reading…" : "Upload template (.docx, .html, .md, .txt)"}
      </button>
      <select
        className="field-boxed text-[12px]"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          const p = v.startsWith("pack:") ? pack.find((x) => `pack:${x.id}` === v) : null;
          const t = p ? null : sorted.find((x) => x.id === v);
          if (p && isPackReady(p)) { onLoad({ subject: p.subject, body: p.body }); setMsg(`Loaded “${p.name}”`); }
          else if (t) { onLoad({ subject: t.subject, body: t.body }); setMsg(`Loaded “${t.name}”`); }
        }}
      >
        <option value="">From templates…</option>
        {sorted.length > 0 && (
          <optgroup label="Your templates">
            {sorted.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.situations.some((k) => situations.includes(k)) ? " ★" : ""}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="EmailsVia templates">
          {pack.map((t) => (
            <option key={t.id} value={`pack:${t.id}`} disabled={!isPackReady(t)}>
              {t.name}{situations.includes(t.situation) ? " ★" : ""}{isPackReady(t) ? "" : " (coming soon)"}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        type="button"
        className="btn-quiet text-xs"
        disabled={busy || !email.template.trim() || RULE_PLACEHOLDER.test(email.template)}
        onClick={async () => {
          setBusy(true);
          setMsg(await onSave({ name: suggestedName.slice(0, 120), subject: email.subject.trim() || null, body: email.template, situations }));
          setBusy(false);
        }}
      >
        Save as template
      </button>
      {msg && <span className="text-ink-500">{msg}</span>}
      <input
        ref={ref}
        type="file"
        accept=".docx,.txt,.md,.markdown,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html"
        className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border rounded-md px-3 py-2.5 text-[12.5px] text-ink-700"
      style={{ borderColor: "rgb(255 159 67 / 0.30)", background: "rgb(255 159 67 / 0.06)" }}
    >
      {children}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

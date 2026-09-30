"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { render, toHtml } from "@/lib/template";
import type { Schedule } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import ActivityDrawer, { type ActivityRecipient, type DrawerPerson, STOP_REASON_LABEL } from "@/components/ActivityDrawer";
import RotationPanel from "@/components/RotationPanel";
import ScheduledFollowups from "@/components/ScheduledFollowups";
import PageHeader from "@/components/app/PageHeader";
import KpiCard from "@/components/app/KpiCard";
import StatusPill from "@/components/app/StatusPill";
import { SITUATION_BY_KEY, type SituationKey } from "@/lib/situations";

type Sender = { id: string; label: string; email: string; from_name: string | null; is_default: boolean };
type FollowUpStep = {
  step_number: number;
  delay_days: number;
  delay_unit?: "days" | "business_days" | null;
  subject: string | null;
  template: string;
  condition?: { type: string; intents?: string[] } | null;
};

function conditionLabel(c: FollowUpStep["condition"]): string | null {
  if (!c || c.type === "always") return null;
  if (c.type === "no_reply") return "only if no reply";
  const list = (c.intents ?? []).map((x) => x.replace("_", " ")).join(", ");
  return c.type === "intent_in" ? `only if reply is: ${list}` : `unless reply is: ${list}`;
}

type CampaignRule = {
  id: string;
  name: string;
  enabled: boolean;
  situations: string[];
  then_action: "end" | "next_rule";
  emails: Array<{ id: string; delay_value: number; delay_unit: string; anchor: string; thread_mode: string }>;
};

type Stats = {
  total: number; sent: number; replied: number; failed: number; pending: number; unsubscribed: number;
  follow_ups_sent: number; retries_sent: number;
  opens: number; machine_opens?: number; meetings_booked?: number; unique_opens: number; clicks: number; unique_clicks: number;
  rates: { open_rate: number; click_rate: number; reply_rate: number; bounce_rate: number; unsubscribe_rate: number };
  opens_by_hour: number[];
  clicks_by_hour: number[];
  opens_by_weekday: number[];
  clicks_by_weekday: number[];
  timezone: string;
  variants?: Array<{ id: string; sent: number; replied: number; reply_rate: number }> | null;
  suggested_winner?: string | null;
  steps?: Array<{ step: number; sent: number; replies: number; reply_rate: number; share_of_replies: number }>;
  rules?: Array<{ rule_id: string; name: string; sent: number; people: number; replied: number; reply_rate: number }>;
  senders?: Array<{ sender_id: string; email: string; sent: number; contacted: number; reply_rate: number; bounce_rate: number }>;
  current_winner?: string | null;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  template: string;
  status: "draft" | "running" | "paused" | "done";
  daily_cap: number;
  gap_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  sender_id: string | null;
  schedule: Schedule | null;
  follow_ups_enabled: boolean;
  retry_enabled: boolean;
  max_retries: number;
  tracking_enabled: boolean;
  unsubscribe_enabled: boolean;
  attachment_filename: string | null;
  attachment_paths: string[];
  attachment_filenames: string[];
  known_vars: string[];
  created_at: string;
  updated_at: string;
  paused_reason?: "bounce_rate" | "sender_auth" | null;
};

type Recipient = {
  id: string;
  name: string;
  company: string;
  email: string;
  vars: Record<string, string>;
  status: "pending" | "sent" | "failed" | "skipped" | "replied" | "unsubscribed" | "bounced";
  sent_at: string | null;
  error: string | null;
  row_index: number;
  next_follow_up_at?: string | null;
  next_step_number?: number | null;
  follow_up_count?: number;
  stop_reason?: string | null;
};

// Status presentation now lives in <StatusPill> (src/components/app/StatusPill.tsx).

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
  const [rules, setRules] = useState<CampaignRule[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [filter, setFilter] = useState<"all" | Recipient["status"]>("all");
  const [activity, setActivity] = useState<{ recipients: ActivityRecipient[]; links: { url: string; total_clicks: number; unique_clickers: number }[] } | null>(null);
  const [activePerson, setActivePerson] = useState<DrawerPerson | null>(null);
  const [sortByScore, setSortByScore] = useState(false);
  const [ticking, setTicking] = useState(false);
  // Dev-mode flag (toggle "Run tick" button visibility). Source of truth
  // is the /api/billing GET — server side env check, doesn't leak in prod.
  const [devMode, setDevMode] = useState(false);
  const [preflight, setPreflight] = useState<{
    strict_merge: boolean;
    tags: string[];
    total_pending: number;
    affected_total: number;
    by_tag: { tag: string; count: number; sample: string[] }[];
  } | null>(null);

  async function load() {
    const r = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
    if (r.status === 404) { router.push("/app"); return; }
    const data = await r.json();
    setCampaign(data.campaign);
    setRecipients(data.recipients);
  }
  async function loadSteps() {
    const r = await fetch(`/api/campaigns/${id}/follow-ups`, { cache: "no-store" });
    const d = await r.json();
    setSteps(d.steps ?? []);
    const rr = await fetch(`/api/campaigns/${id}/follow-up-rules`, { cache: "no-store" });
    if (rr.ok) setRules(((await rr.json()).rules ?? []) as CampaignRule[]);
  }
  async function loadStats() {
    const r = await fetch(`/api/campaigns/${id}/stats`, { cache: "no-store" });
    if (r.ok) setStats(await r.json());
  }
  async function loadActivity() {
    const r = await fetch(`/api/campaigns/${id}/activity`, { cache: "no-store" });
    if (r.ok) setActivity(await r.json());
  }
  async function loadPreflight() {
    const r = await fetch(`/api/campaigns/${id}/merge-preflight`, { cache: "no-store" });
    if (r.ok) setPreflight(await r.json());
  }

  useEffect(() => {
    load();
    loadSteps();
    loadStats();
    loadActivity();
    loadPreflight();
    fetch("/api/senders", { cache: "no-store" }).then((r) => r.json()).then((d) => setSenders(d.senders ?? []));
    fetch("/api/billing", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDevMode(!!d.dev_mode))
      .catch(() => undefined);
    // Two-tier polling: light queries (campaign + stats) refresh fast for
    // live "sent N of M" feedback. Heavy queries (activity timeline,
    // pre-flight scan) refresh slowly — they fan out over thousands of
    // recipients/tracking events on big campaigns. Pause both when the
    // tab is hidden so a backgrounded user doesn't poll forever.
    const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const fastPoll = setInterval(() => {
      if (!isVisible()) return;
      load();
      loadStats();
    }, 10_000);
    const slowPoll = setInterval(() => {
      if (!isVisible()) return;
      loadActivity();
      loadPreflight();
    }, 60_000);
    return () => {
      clearInterval(fastPoll);
      clearInterval(slowPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(payload: Partial<Campaign>) {
    const r = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) await load();
  }

  async function destroy() {
    if (!confirm("Delete this campaign and all its recipients? This cannot be undone.")) return;
    const r = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/app");
  }

  async function duplicate() {
    const r = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
    if (!r.ok) { alert("Failed to duplicate"); return; }
    const { campaign: dup } = await r.json();
    router.push(`/app/campaigns/${dup.id}/edit`);
  }

  async function archive() {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    router.push("/app");
  }

  const [validating, setValidating] = useState(false);
  async function validateEmails() {
    setValidating(true);
    const r = await fetch(`/api/campaigns/${id}/validate`, { method: "POST" });
    setValidating(false);
    if (!r.ok) { alert("Validation failed"); return; }
    const d = await r.json();
    alert(
      `Checked ${d.checked}, ${d.invalid} invalid${d.invalid > 0 ? ` (${d.invalid_emails.slice(0, 5).join(", ")}${d.invalid > 5 ? "…" : ""})` : ""}.` +
        (d.invalid > 0 ? " Invalid addresses were skipped and won't be emailed." : "") +
        (d.role_addresses > 0 ? `\n${d.role_addresses} are shared inboxes (info@, sales@…): deliverable, but rarely reach a decision-maker.` : "") +
        (d.verification
          ? `\nMailbox check: ${d.verification.verified} verified` +
            (d.verification.catch_all > 0 ? `, ${d.verification.catch_all} catch-all (the domain accepts any address, so delivery can't be confirmed; kept)` : "") +
            (d.verification.errors > 0 ? `, ${d.verification.errors} couldn't be checked (run again)` : "")
          : "") +
        (d.complete === false ? "\nLarge list: run Validate again to check the rest." : "")
    );
    load();
  }

  const currentSender = useMemo(
    () => senders.find((s) => s.id === campaign?.sender_id),
    [senders, campaign?.sender_id]
  );

  if (!campaign) {
    return (
      <AppShell>
        <div className="page space-y-4">
          <div className="h-4 w-24 rounded bg-ink-100 animate-pulse" />
          <div className="h-9 w-2/3 rounded bg-ink-100 animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-ink-100 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  const total = recipients.length;
  const sent = recipients.filter((r) => r.status === "sent" || r.status === "replied").length;
  const replied = recipients.filter((r) => r.status === "replied").length;
  const failed = recipients.filter((r) => r.status === "failed" || r.status === "bounced").length;
  const pending = recipients.filter((r) => r.status === "pending").length;
  const pct = total ? Math.round((sent / total) * 100) : 0;
  const activeDays = campaign.schedule ? Object.values(campaign.schedule).filter((d) => d.enabled).length : 7;

  // Merge activity (scores/opens/clicks) into the recipients rows
  const activityById = new Map<string, ActivityRecipient>();
  for (const r of activity?.recipients ?? []) activityById.set(r.id, r);

  let filtered = filter === "all" ? recipients : recipients.filter((r) => r.status === filter);
  if (sortByScore) {
    filtered = [...filtered].sort((a, b) => {
      const sa = activityById.get(a.id)?.score ?? 0;
      const sb = activityById.get(b.id)?.score ?? 0;
      return sb - sa;
    });
  }
  const previewRecipient = recipients[previewIdx];

  const previewVars: Record<string, string> = previewRecipient
    ? { ...previewRecipient.vars, Name: previewRecipient.name, Company: previewRecipient.company }
    : { Name: "John", Company: "Acme Inc" };
  const previewHtml = toHtml(render(campaign.template, previewVars));

  return (
    <AppShell>
    <div className="page">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink transition-colors cursor-pointer mb-4"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 2L3 6l4 4" />
        </svg>
        Campaigns
      </Link>

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={campaign.status} />
            <span className="text-ink-500 normal-case font-sans tracking-normal">
              Updated {new Date(campaign.updated_at).toLocaleString()}
            </span>
          </span>
        }
        title={campaign.name}
        subtitle={campaign.subject}
        actions={
          <>
            {campaign.status !== "running" && pending > 0 && (
              <button className="btn-accent" onClick={() => patch({ status: "running" })}>
                Start sending
              </button>
            )}
            {campaign.status === "running" && (
              <button className="btn-ghost" onClick={() => patch({ status: "paused" })}>Pause</button>
            )}
            {devMode && campaign.status === "running" && pending > 0 && (
              <button
                className="btn-ghost"
                title="Dev mode: there's no scheduler hitting /api/tick locally — click to send the next batch immediately."
                disabled={ticking}
                onClick={async () => {
                  setTicking(true);
                  try {
                    const r = await fetch("/api/dev/tick", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ burst: 30 }),
                    });
                    const d = await r.json();
                    if (!r.ok) alert(`Tick failed: ${d.error ?? r.status}`);
                    await Promise.all([load(), loadStats(), loadActivity()]);
                  } finally {
                    setTicking(false);
                  }
                }}
              >
                {ticking ? "Sending…" : "Run tick"}
              </button>
            )}
            <Link href={`/app/campaigns/${id}/edit`} className="btn-ghost">Edit</Link>
            {pending > 0 && (
              <button className="btn-quiet" onClick={validateEmails} disabled={validating}>
                {validating ? "Validating…" : "Validate"}
              </button>
            )}
            <button className="btn-quiet" onClick={duplicate}>Duplicate</button>
            {campaign.status === "done" && <button className="btn-quiet" onClick={archive}>Archive</button>}
            <button className="btn-quiet text-red-600 hover:text-red-500" onClick={destroy}>Delete</button>
          </>
        }
      />

      {/* big stats row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        <KpiCard
          label="Sent"
          value={sent.toLocaleString()}
          unit={`of ${total.toLocaleString()}`}
        />
        <KpiCard
          label="Replied"
          value={(stats?.replied ?? replied).toLocaleString()}
          unit={[
            stats && stats.rates.reply_rate > 0 ? `${stats.rates.reply_rate}% rate` : null,
            stats?.meetings_booked ? `${stats.meetings_booked} meeting${stats.meetings_booked === 1 ? "" : "s"} booked` : null,
          ].filter(Boolean).join(" · ") || undefined}
          tone="hot"
        />
        <KpiCard
          label="Failed"
          value={failed.toLocaleString()}
          unit={failed > 0 ? "needs attention" : undefined}
        />
        <KpiCard
          label="Pending"
          value={pending.toLocaleString()}
          unit={`${pct}% complete`}
        />
      </section>

      {/* strict-merge pre-flight banner — only when there's something to fix */}
      {preflight && preflight.affected_total > 0 && preflight.total_pending > 0 && (
        <div
          className="rounded-xl border px-4 py-3 mb-3 flex items-start gap-3"
          style={{
            borderColor: "rgb(255 159 67 / 0.30)",
            background: "rgb(255 159 67 / 0.06)",
          }}
        >
          <span
            className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
            style={{ background: "rgb(255 159 67 / 0.18)", color: "rgb(255 180 110)" }}
            aria-hidden
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </span>
          <div className="flex-1 text-[13px] text-ink">
            <div className="font-semibold">
              {preflight.affected_total} of {preflight.total_pending} pending rows are missing merge fields
            </div>
            <ul className="mt-1.5 space-y-1 text-ink-700">
              {preflight.by_tag.map((b) => (
                <li key={b.tag}>
                  <code className="font-mono text-[11.5px] bg-[rgb(255_159_67/0.12)] text-[rgb(255_180_110)] px-1.5 py-0.5 rounded">
                    {`{{${b.tag}}}`}
                  </code>
                  {" "}— {b.count} row{b.count === 1 ? "" : "s"}
                  {b.sample.length > 0 && (
                    <span className="text-ink-500"> · {b.sample.slice(0, 3).join(", ")}{b.sample.length > 3 ? "…" : ""}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2.5 text-[12.5px] text-ink-600">
              {preflight.strict_merge ? (
                <>Strict merge is on — these rows will be <b className="text-ink">skipped</b> when the campaign runs. Fix the sheet or untick &ldquo;Strict merge fields&rdquo; in <Link href={`/app/campaigns/${id}/edit`} className="underline decoration-[rgb(255_180_110/0.6)] underline-offset-[3px] hover:text-[rgb(255_180_110)] transition-colors">Edit</Link> to send them anyway.</>
              ) : (
                <>Strict merge is <b className="text-ink">off</b> — these rows will send with empty placeholders. Turn it on in <Link href={`/app/campaigns/${id}/edit`} className="underline decoration-[rgb(255_180_110/0.6)] underline-offset-[3px] hover:text-[rgb(255_180_110)] transition-colors">Edit</Link> to skip them instead.</>
              )}
            </div>
          </div>
        </div>
      )}

      {/* empty-recipients banner */}
      {campaign.status === "paused" && campaign.paused_reason && (
        <div
          className="mb-6 rounded-xl border px-4 py-3 text-[13px]"
          style={{ borderColor: "rgb(255 159 67 / 0.35)", background: "rgb(255 159 67 / 0.06)" }}
        >
          <div className="font-semibold text-[rgb(255_180_110)]">
            {campaign.paused_reason === "bounce_rate"
              ? "Paused automatically: too many bounces"
              : "Paused automatically: your domain failed authentication"}
          </div>
          <div className="text-ink-600 mt-1">
            {campaign.paused_reason === "bounce_rate" ? (
              <>
                More than 5% of the people this campaign emailed bounced. Continuing would damage your
                domain&rsquo;s reputation. Remove or verify the bad addresses (bounced ones are already on
                your do-not-contact list), then resume.
              </>
            ) : (
              <>
                A receiving mail server rejected this sender&rsquo;s SPF/DKIM/DMARC setup, so every email would
                bounce. Open <Link href="/app/senders" className="underline">Senders</Link> → Check DNS, fix the
                records it flags, then resume.
              </>
            )}
          </div>
        </div>
      )}

      {campaign.status === "draft" && total === 0 && (
        <div
          className="rounded-xl border px-4 py-3 mb-8 flex items-start gap-3"
          style={{
            borderColor: "rgb(255 159 67 / 0.30)",
            background: "rgb(255 159 67 / 0.06)",
          }}
        >
          <span
            className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
            style={{ background: "rgb(255 159 67 / 0.18)", color: "rgb(255 180 110)" }}
            aria-hidden
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </span>
          <div className="flex-1 text-[13px] text-ink">
            <div className="font-semibold">No recipients on this campaign yet.</div>
            <div className="mt-0.5 text-ink-600">
              Click{" "}
              <Link
                href={`/app/campaigns/${id}/edit`}
                className="underline decoration-[rgb(255_180_110/0.6)] underline-offset-[3px] hover:text-[rgb(255_180_110)] transition-colors"
              >
                Edit
              </Link>{" "}
              to add a Google Sheet or upload an Excel/CSV file. The &ldquo;Start sending&rdquo; button shows up once at least one recipient is loaded.
            </div>
          </div>
        </div>
      )}

      {/* analytics row */}
      {campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <KpiCard label="Unique opens"     value={stats.unique_opens.toLocaleString()}  unit={`${stats.rates.open_rate}% of sent · ${stats.opens} total${stats.machine_opens ? ` · ${stats.machine_opens} automated excluded` : ""}`} />
          <KpiCard label="Unique clicks"    value={stats.unique_clicks.toLocaleString()} unit={`${stats.rates.click_rate}% · ${stats.clicks} total`} />
          <KpiCard label="Follow-ups sent"  value={stats.follow_ups_sent.toLocaleString()} unit={stats.follow_ups_sent > 0 ? "sequence active" : undefined} />
          <KpiCard label="Unsubscribed"     value={stats.unsubscribed.toLocaleString()}   unit={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : undefined} />
        </section>
      )}
      {!campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <KpiCard label="Follow-ups sent" value={stats.follow_ups_sent.toLocaleString()} unit={stats.follow_ups_sent > 0 ? "sequence active" : undefined} />
          <KpiCard label="Retries used"    value={stats.retries_sent.toLocaleString()}    unit={stats.retries_sent > 0 ? "auto-retried" : undefined} />
          <KpiCard label="Unsubscribed"    value={stats.unsubscribed.toLocaleString()}    unit={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : undefined} />
          <KpiCard label="Tracking"        value="off"                                    unit="enable in Edit for open/click stats" />
        </section>
      )}

      {/* Overall progress bar */}
      <div className="h-1.5 w-full rounded-full bg-ink-100 overflow-hidden mt-6 mb-10">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: pct >= 100
              ? "rgb(16 185 129)"
              : "linear-gradient(90deg, rgb(255 99 99), rgb(255 159 67))",
          }}
        />
      </div>

      {campaign.tracking_enabled && stats && stats.opens > 0 && (
        <EngagementSection stats={stats} />
      )}

      {stats && stats.sent > 0 && <PerformancePanel stats={stats} />}

      {stats && stats.variants && stats.variants.length > 0 && (
        <VariantPanel
          campaignId={id}
          variants={stats.variants}
          currentWinner={stats.current_winner ?? null}
          suggestedWinner={stats.suggested_winner ?? null}
          onChange={() => loadStats()}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-10">
        {/* main column */}
        <div className="space-y-10">
          {/* preview */}
          <section className="sheet p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold">Preview</h2>
              {previewRecipient && recipients.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                    disabled={previewIdx === 0}
                    className="w-7 h-7 flex items-center justify-center rounded text-ink-600 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span className="text-[11px] text-ink-500 px-2 font-mono tabular-nums whitespace-nowrap">{previewIdx + 1} / {recipients.length}</span>
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(Math.min(recipients.length - 1, previewIdx + 1))}
                    disabled={previewIdx >= recipients.length - 1}
                    className="w-7 h-7 flex items-center justify-center rounded text-ink-600 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
              )}
            </div>
            {previewRecipient && (
              <div className="mb-4 pb-3 border-b border-ink-200">
                <div className="text-[13px] font-medium text-ink truncate">
                  {previewRecipient.name}
                  <span className="text-ink-400 font-normal"> · </span>
                  {previewRecipient.company}
                </div>
                <div className="text-[11px] font-mono text-ink-500 truncate">{previewRecipient.email}</div>
              </div>
            )}
            <article className="email-preview rounded-md border border-ink-200 p-6 bg-paper text-ink">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              {(() => {
                const names = campaign.attachment_filenames && campaign.attachment_filenames.length > 0
                  ? campaign.attachment_filenames
                  : campaign.attachment_filename ? [campaign.attachment_filename] : [];
                if (names.length === 0) return null;
                return (
                  <div className="mt-6 pt-4 border-t border-ink-200">
                    <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider mb-2">
                      {names.length} attachment{names.length !== 1 ? "s" : ""}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {names.map((n, i) => (
                        <div key={i} className="inline-flex items-center gap-2 pl-2.5 pr-3 py-1.5 border border-ink-200 rounded-md bg-surface max-w-full">
                          <svg className="w-4 h-4 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l8.57-8.57A4 4 0 0117.98 8.6l-8.07 8.07a2 2 0 11-2.83-2.83l7.77-7.77" />
                          </svg>
                          <span className="text-[12px] font-medium truncate max-w-[220px]" title={n}>{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </article>
            <details className="mt-6 pt-4 border-t border-ink-200">
              <summary className="text-[12px] font-medium text-ink-500 hover:text-ink cursor-pointer">Show raw template</summary>
              <pre className="whitespace-pre-wrap font-mono text-[12px] bg-surface border border-ink-200 rounded-md p-3 mt-3 max-h-80 overflow-auto">{campaign.template}</pre>
            </details>
          </section>

          {/* follow-ups to people who replied (not now / stalled threads) */}
          {rules.some((r) => r.situations.includes("replied_not_now") || r.situations.includes("thread_stalled")) && (
            <ScheduledFollowups campaignId={id} onOpenPerson={setActivePerson} />
          )}

          {/* activity-based rules */}
          {campaign.follow_ups_enabled && rules.length > 0 && (
            <section className="sheet p-6">
              <h2 className="text-[15px] font-semibold">Smart follow-ups</h2>
              <p className="text-[12px] text-ink-500 mt-1 mb-4">
                Checked top to bottom before the default sequence; the first rule that matches what a person did sends next.
              </p>
              <div className="space-y-4">
                {rules.map((r, i) => {
                  const st = stats?.rules?.find((x) => x.rule_id === r.id);
                  return (
                    <div key={r.id} className={`grid grid-cols-[70px,1fr] gap-4 ${r.enabled ? "" : "opacity-50"}`}>
                      <div>
                        <div className="text-[12px] font-semibold text-ink">Rule {i + 1}</div>
                        <div className="text-[11px] text-ink-500 mt-0.5">{r.enabled ? `${r.emails.length} email${r.emails.length === 1 ? "" : "s"}` : "off"}</div>
                      </div>
                      <div className="border-l border-ink-200 pl-4">
                        <div className="text-[13px] font-medium">{r.name}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {r.situations.map((k) => (
                            <span key={k} className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] text-ink-700">
                              {SITUATION_BY_KEY.get(k as SituationKey)?.label ?? k}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11.5px] text-ink-500 mt-2">
                          {r.emails
                            .map((e) => `+${e.delay_value} ${e.delay_unit === "business_days" ? "business days" : e.delay_unit} after ${e.anchor === "activity" ? "the activity" : "last email"}${e.thread_mode === "new" ? " · new email" : ""}`)
                            .join("  →  ")}
                          {r.then_action === "next_rule" ? "  →  then the next rule" : ""}
                        </div>
                        {st && st.people > 0 && (
                          <div className="text-[12px] text-ink-700 mt-2">
                            Reached {st.people.toLocaleString()} · {st.replied.toLocaleString()} replied after ({st.reply_rate}%)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* follow-ups */}
          {campaign.follow_ups_enabled && steps.length > 0 && (
            <section className="sheet p-6">
              <h2 className="text-[15px] font-semibold mb-4">{rules.length > 0 ? "Default sequence (everyone no rule matches)" : "Follow-up sequence"}</h2>
              <div className="space-y-4">
                {steps.map((s) => (
                  <div key={s.step_number} className="grid grid-cols-[70px,1fr] gap-4">
                    <div>
                      <div className="text-[12px] font-semibold text-ink">Step {s.step_number}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5">
                        +{s.delay_days} {s.delay_unit === "business_days" ? "business " : ""}day{s.delay_days === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="border-l border-ink-200 pl-4">
                      {conditionLabel(s.condition) && (
                        <div className="text-[11px] text-ink-500 mb-1.5">{conditionLabel(s.condition)}</div>
                      )}
                      {s.subject && <div className="text-[13px] font-medium mb-1.5">{s.subject}</div>}
                      <pre className="whitespace-pre-wrap font-mono text-[12px] text-ink-700 max-h-48 overflow-auto">{s.template}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Link click breakdown */}
          {activity && activity.links.length > 0 && (
            <section className="sheet p-6">
              <h2 className="text-[15px] font-semibold mb-3">Links clicked</h2>
              <div className="space-y-2">
                {activity.links.slice(0, 10).map((l) => {
                  const pct = total ? Math.round((l.unique_clickers / total) * 100) : 0;
                  return (
                    <div key={l.url} className="grid grid-cols-[1fr,auto,auto] items-center gap-3 text-[13px]">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-ink hover:underline decoration-ink-300 underline-offset-2"
                        title={l.url}
                      >
                        {l.url.replace(/^https?:\/\//, "")}
                      </a>
                      <div className="text-ink-500 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        {l.unique_clickers}{l.unique_clickers === 1 ? " clicker" : " clickers"} · {l.total_clicks} {l.total_clicks === 1 ? "click" : "clicks"}
                      </div>
                      <div className="w-24">
                        <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* recipients table */}
          <section>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-[15px] font-semibold">Recipients <span className="text-ink-400 font-normal">({total})</span></h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSortByScore(!sortByScore)}
                  className={`text-[12px] px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1 ${sortByScore ? "bg-hover text-ink font-medium" : "text-ink-500 hover:bg-hover hover:text-ink"}`}
                  title="Sort by engagement score (opens × 1 + clicks × 5 + reply × 20)"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
                  {sortByScore ? "By score" : "By order"}
                </button>
                <div className="flex items-center gap-1">
                  {(["all", "pending", "sent", "replied", "failed"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`text-[12px] px-2 py-1 rounded transition-colors capitalize cursor-pointer ${
                        filter === f ? "bg-hover text-ink font-medium" : "text-ink-500 hover:bg-hover hover:text-ink"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="sheet overflow-hidden">
              {/* desktop header */}
              <div className="hidden md:grid grid-cols-[40px,1.2fr,1fr,1.4fr,auto,auto] gap-4 px-4 py-2.5 border-b border-ink-200 text-[12px] font-medium text-ink-500">
                <span>#</span>
                <span>Name</span>
                <span>Company</span>
                <span>Email</span>
                <span>Status</span>
                <span className="text-right">When</span>
              </div>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-[13px] text-ink-500">No recipients match this filter.</div>
              )}
              {filtered.map((r, i) => {
                const when = r.sent_at
                  ? new Date(r.sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                  : r.error ? null : "—";
                const idx = String(i + 1).padStart(3, "0");
                const sequenceNote =
                  r.status === "sent" && r.next_follow_up_at
                    ? `Next: step ${r.next_step_number ?? (r.follow_up_count ?? 0) + 1} · ${new Date(r.next_follow_up_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : r.stop_reason && r.stop_reason !== "replied"
                      ? STOP_REASON_LABEL[r.stop_reason] ?? null
                      : null;
                const act = activityById.get(r.id);
                const engage = act && (act.opens > 0 || act.clicks > 0 || act.replied);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActivePerson({ id: r.id, name: r.name, email: r.email, company: r.company })}
                    className="w-full text-left border-b border-ink-100 last:border-b-0 hover:bg-hover transition-colors cursor-pointer"
                  >
                    {/* mobile */}
                    <div className="md:hidden px-4 py-3 text-[13px]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-ink-400 shrink-0">{idx}</span>
                            <span className="font-medium truncate">{r.name}</span>
                          </div>
                          <div className="text-[12px] text-ink-600 truncate mt-0.5">{r.company}</div>
                          <div className="font-mono text-[11px] text-ink-500 truncate mt-0.5">{r.email}</div>
                        </div>
                        <span className="shrink-0"><StatusPill status={r.status} /></span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-ink-500">
                        <span>
                          {when !== null ? when : r.error && <span className="text-[rgb(252_165_165)]">{r.error}</span>}
                          {sequenceNote && <span className="block text-ink-400">{sequenceNote}</span>}
                        </span>
                        {engage && <EngagementBadge act={act!} />}
                      </div>
                    </div>
                    {/* desktop */}
                    <div className="hidden md:grid grid-cols-[40px,1.2fr,1fr,1.4fr,auto,auto] gap-4 items-center px-4 py-2.5 text-[13px]">
                      <span className="font-mono text-ink-400">{idx}</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{r.name}</span>
                        {engage && <EngagementBadge act={act!} />}
                      </div>
                      <span className="text-ink-700 truncate">{r.company}</span>
                      <span className="font-mono text-[11px] text-ink-500 truncate">{r.email}</span>
                      <StatusPill status={r.status} />
                      <span className="text-[11px] text-ink-500 text-right">
                        {when !== null ? when : r.error && <span className="text-[rgb(252_165_165)] truncate block max-w-[160px]" title={r.error}>{r.error}</span>}
                        {sequenceNote && <span className="block text-ink-400 whitespace-nowrap">{sequenceNote}</span>}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* sidebar */}
        <aside className="space-y-5">
          <div className="sheet p-5">
            <h3 className="text-[14px] font-semibold mb-3">Sender</h3>
            <dl className="text-[13px] space-y-1.5">
              <Row k="From">{currentSender ? (currentSender.from_name ?? currentSender.email) : "env fallback"}</Row>
              <Row k="Account" mono>{currentSender?.email ?? "—"}</Row>
              <Row k="Active days">{activeDays} / 7</Row>
              <Row k="Gap">{(campaign.gap_seconds / 60).toFixed(1)} min</Row>
              <Row k="Max/day">{campaign.daily_cap}</Row>
              <Row k="Timezone" mono>{campaign.timezone}</Row>
            </dl>
          </div>

          <div className="sheet p-5">
            <h3 className="text-[14px] font-semibold mb-3">Delivery</h3>
            <dl className="text-[13px] space-y-1.5">
              <Row k="Follow-ups">{campaign.follow_ups_enabled ? `${steps.length} step${steps.length !== 1 ? "s" : ""}` : "off"}</Row>
              <Row k="Retry">{campaign.retry_enabled ? `on · ${campaign.max_retries}x` : "off"}</Row>
              <Row k="Tracking">{campaign.tracking_enabled ? "on" : "off"}</Row>
              <Row k="Unsubscribe">{campaign.unsubscribe_enabled ? "on" : "off"}</Row>
            </dl>
          </div>

          {(() => {
            const names = campaign.attachment_filenames && campaign.attachment_filenames.length > 0
              ? campaign.attachment_filenames
              : campaign.attachment_filename ? [campaign.attachment_filename] : [];
            if (names.length === 0) return null;
            return (
              <div className="sheet p-5">
                <h3 className="text-[14px] font-semibold mb-2">
                  Attachments <span className="text-ink-400 font-normal">({names.length})</span>
                </h3>
                <ul className="space-y-1 mt-2">
                  {names.map((n, i) => (
                    <li key={i} className="text-[13px] font-medium truncate" title={n}>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <RotationPanel campaignId={id} allSenders={senders} />

          {campaign.known_vars.length > 0 && (
            <div className="sheet p-5">
              <h3 className="text-[14px] font-semibold mb-3">Merge tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {campaign.known_vars.map((v) => (
                  <code key={v} className="text-[11px] px-2 py-1 rounded border border-ink-200 bg-surface font-mono text-ink-700">{"{{"}{v}{"}}"}</code>
                ))}
              </div>
            </div>
          )}

          <Link href={`/app/campaigns/${id}/edit`} className="btn-primary w-full">Edit campaign</Link>
        </aside>
      </div>

      <ActivityDrawer campaignId={id} person={activePerson} onClose={() => setActivePerson(null)} />
    </div>
    </AppShell>
  );
}

function EngagementBadge({ act }: { act: ActivityRecipient }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-700 shrink-0">
      {act.opens > 0 && (
        <span className="inline-flex items-center gap-0.5" title={`${act.opens} opens`}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {act.opens}
        </span>
      )}
      {act.clicks > 0 && (
        <span className="inline-flex items-center gap-0.5 text-ink" title={`${act.clicks} clicks`}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          {act.clicks}
        </span>
      )}
      {act.replied && (
        <span className="inline-flex items-center gap-0.5 text-[rgb(110_231_183)]" title="Replied">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
          </svg>
        </span>
      )}
    </span>
  );
}

function Row({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}

// --- Engagement timing ---
const WEEKDAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"];

function EngagementSection({ stats }: { stats: Stats }) {
  const totalOpens = stats.opens_by_hour.reduce((a, b) => a + b, 0);
  const totalClicks = stats.clicks_by_hour.reduce((a, b) => a + b, 0);
  const avgPerHour = totalOpens / 24;

  // Peak hour (by opens)
  const peakHourIdx = stats.opens_by_hour.reduce(
    (best, c, h) => (c > stats.opens_by_hour[best] ? h : best),
    0
  );
  const peakHourOpens = stats.opens_by_hour[peakHourIdx];
  const peakMultiplier = avgPerHour > 0 ? peakHourOpens / avgPerHour : 0;

  // Peak weekday (by opens). If no opens yet, nothing.
  const peakDayIdx = stats.opens_by_weekday.reduce(
    (best, c, d) => (c > stats.opens_by_weekday[best] ? d : best),
    0
  );
  const peakDayOpens = stats.opens_by_weekday[peakDayIdx];

  // Recommended send window — 1 hour BEFORE peak so the email lands just in time.
  const recSendHour = (peakHourIdx + 24 - 1) % 24;

  const clickToOpen = totalOpens > 0 ? Math.round((totalClicks / totalOpens) * 1000) / 10 : 0;

  return (
    <section className="sheet p-6 mb-8">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-[15px] font-semibold">When they engage</h2>
          <p className="text-[12px] text-ink-500 mt-1">
            Hourly opens + clicks in {stats.timezone}. Send ~1h before peak to land when the inbox is being read.
          </p>
        </div>
        {peakHourOpens > 0 && (
          <div className="text-right shrink-0">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">Best send time</div>
            <div className="text-[13px] font-mono font-semibold mt-0.5">
              {peakDayOpens > 0 ? `${WEEKDAY_LABEL[peakDayIdx]} · ` : ""}
              {String(recSendHour).padStart(2, "0")}:00
            </div>
            {peakMultiplier >= 1.3 && (
              <div className="text-[11px] text-ink-500 mt-0.5 font-mono">
                {peakMultiplier.toFixed(1)}× avg at peak
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-ink-500 mb-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "rgb(var(--m-coral))" }} />
          Opens <span className="font-mono text-ink-700">{totalOpens}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "rgb(var(--m-green))" }} />
          Clicks <span className="font-mono text-ink-700">{totalClicks}</span>
        </span>
        {totalOpens > 0 && (
          <span className="text-ink-400">· Click-to-open: <span className="font-mono text-ink-700">{clickToOpen}%</span></span>
        )}
      </div>

      <HourlyBars opens={stats.opens_by_hour} clicks={stats.clicks_by_hour} peakHour={peakHourIdx} />

      {peakDayOpens > 0 && (
        <div className="mt-6 pt-5 border-t border-ink-100">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">By weekday</div>
            <div className="text-[11px] text-ink-400 font-mono">
              Best: <span className="text-ink-700 font-semibold">{WEEKDAY_LABEL[peakDayIdx]}</span>
            </div>
          </div>
          <WeekdayBars
            opens={stats.opens_by_weekday}
            clicks={stats.clicks_by_weekday}
            peakIdx={peakDayIdx}
          />
        </div>
      )}
    </section>
  );
}

function HourlyBars({ opens, clicks, peakHour }: { opens: number[]; clicks: number[]; peakHour: number }) {
  // Stacked bar: opens base + clicks on top. Scale to the max total per hour.
  const totals = opens.map((o, i) => o + (clicks[i] ?? 0));
  const max = Math.max(...totals, 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-end gap-[3px] h-[140px] relative">
        {opens.map((o, h) => {
          const c = clicks[h] ?? 0;
          const total = o + c;
          const openPct = (o / max) * 100;
          const clickPct = (c / max) * 100;
          const isPeak = h === peakHour && total > 0;
          const isHovered = hover === h;
          return (
            <div
              key={h}
              className="flex-1 flex flex-col justify-end h-full relative cursor-default"
              onMouseEnter={() => setHover(h)}
              onMouseLeave={() => setHover(null)}
            >
              {total === 0 && (
                <div className="w-full bg-ink-100" style={{ height: 2 }} />
              )}
              {c > 0 && (
                <div
                  className="w-full transition-opacity"
                  style={{
                    height: `${Math.max(clickPct, 2)}%`,
                    background: "rgb(var(--m-green))",
                    opacity: isHovered ? 0.85 : 1,
                  }}
                />
              )}
              {o > 0 && (
                <div
                  className="w-full transition-opacity"
                  style={{
                    height: `${Math.max(openPct, 3)}%`,
                    minHeight: 3,
                    background: isPeak
                      ? "linear-gradient(180deg, rgb(var(--m-coral)), rgb(var(--m-amber)))"
                      : "rgb(var(--m-coral) / 0.65)",
                    opacity: isHovered ? 0.85 : 1,
                  }}
                />
              )}
              {isHovered && total > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 whitespace-nowrap rounded-md bg-ink text-paper px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none">
                  <div className="font-mono font-semibold">{String(h).padStart(2, "0")}:00</div>
                  <div className="opacity-70 mt-0.5">
                    {o} open{o !== 1 ? "s" : ""}
                    {c > 0 && ` · ${c} click${c !== 1 ? "s" : ""}`}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-mono text-ink-400 tracking-wider">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

function WeekdayBars({ opens, clicks, peakIdx }: { opens: number[]; clicks: number[]; peakIdx: number }) {
  const totals = opens.map((o, i) => o + (clicks[i] ?? 0));
  const max = Math.max(...totals, 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-end gap-2 h-[80px]">
        {opens.map((o, d) => {
          const c = clicks[d] ?? 0;
          const total = o + c;
          const openPct = (o / max) * 100;
          const clickPct = (c / max) * 100;
          const isPeak = d === peakIdx && total > 0;
          const isHovered = hover === d;
          return (
            <div
              key={d}
              className="flex-1 flex flex-col items-center gap-1.5 cursor-default"
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex-1 w-full flex flex-col justify-end relative">
                {total === 0 && (
                  <div className="w-full bg-ink-100" style={{ height: 2 }} />
                )}
                {c > 0 && (
                  <div
                    className="w-full transition-opacity"
                    style={{
                      height: `${Math.max(clickPct, 2)}%`,
                      background: "rgb(var(--m-green))",
                      opacity: isHovered ? 0.85 : 1,
                    }}
                  />
                )}
                {o > 0 && (
                  <div
                    className="w-full transition-opacity"
                    style={{
                      height: `${Math.max(openPct, 3)}%`,
                      minHeight: 3,
                      background: isPeak
                        ? "linear-gradient(180deg, rgb(var(--m-coral)), rgb(var(--m-amber)))"
                        : "rgb(var(--m-coral) / 0.65)",
                      opacity: isHovered ? 0.85 : 1,
                    }}
                  />
                )}
                {isHovered && total > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 whitespace-nowrap rounded-md bg-ink text-paper px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none">
                    <div className="font-mono font-semibold">{WEEKDAY_LABEL[d]}</div>
                    <div className="opacity-70 mt-0.5">
                      {o} open{o !== 1 ? "s" : ""}
                      {c > 0 && ` · ${c} click${c !== 1 ? "s" : ""}`}
                    </div>
                  </div>
                )}
              </div>
              <div className={`text-[11px] font-medium ${isPeak ? "text-ink" : "text-ink-500"}`}>
                {WEEKDAY_SHORT[d]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cold-email reply-rate benchmarks (Instantly 2026 benchmark report, billions
// of emails): average 3.43%, top quartile 5.5%, elite 10.7%+.
const BENCHMARKS = { avg: 3.4, good: 5.5, elite: 10.7 };
const MIN_SAMPLE = 50;

function PerformancePanel({ stats }: { stats: Stats }) {
  const r = stats.rates.reply_rate;
  const early = stats.sent < MIN_SAMPLE;
  const band =
    r >= BENCHMARKS.elite ? { label: "Elite", color: "rgb(110 231 183)" }
    : r >= BENCHMARKS.good ? { label: "Top quartile", color: "rgb(110 231 183)" }
    : r >= BENCHMARKS.avg ? { label: "Around average", color: "rgb(255 180 110)" }
    : { label: "Below average", color: "rgb(252 165 165)" };
  const scaleMax = Math.max(BENCHMARKS.elite * 1.3, r * 1.1);
  const pos = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const steps = stats.steps ?? [];
  const senders = stats.senders ?? [];

  return (
    <section className="sheet p-5 my-6 space-y-6">
      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-[14px] font-semibold">Reply rate vs. cold-email benchmarks</h3>
          <div className="text-[13px]">
            <span className="font-mono font-semibold">{r}%</span>{" "}
            {early ? (
              <span className="text-ink-500">· early: {stats.sent} of {MIN_SAMPLE} sends needed to judge</span>
            ) : (
              <span style={{ color: band.color }}>· {band.label}</span>
            )}
          </div>
        </div>
        <div className="relative h-2 rounded-full bg-ink-100 mt-3" aria-hidden>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: pos(r), background: early ? "rgb(161 161 170 / 0.6)" : band.color }}
          />
          {([["avg", BENCHMARKS.avg], ["top 25%", BENCHMARKS.good], ["elite", BENCHMARKS.elite]] as const).map(([k, v]) => (
            <div key={k} className="absolute -top-1 -bottom-1 w-px bg-ink-400" style={{ left: pos(v) }} />
          ))}
        </div>
        <div className="relative h-4 mt-1 text-[10.5px] font-mono text-ink-500">
          {([["avg 3.4%", BENCHMARKS.avg], ["top 25% 5.5%", BENCHMARKS.good], ["elite 10.7%", BENCHMARKS.elite]] as const).map(([k, v]) => (
            <span key={k} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(v) }}>{k}</span>
          ))}
        </div>
      </div>

      {steps.length > 1 && (
        <div>
          <h3 className="text-[14px] font-semibold">Sequence performance</h3>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Replies credited to the last email they got. Follow-ups usually bring 40–60% of all replies.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] mt-2">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-500 text-left">
                  <th className="py-1.5 font-medium">Email</th>
                  <th className="py-1.5 font-medium">Sent</th>
                  <th className="py-1.5 font-medium">Replies</th>
                  <th className="py-1.5 font-medium">Reply rate</th>
                  <th className="py-1.5 font-medium">Share of replies</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((st) => (
                  <tr key={st.step} className="border-t border-ink-100">
                    <td className="py-1.5">{st.step === 0 ? "First email" : `Follow-up ${st.step}`}</td>
                    <td className="py-1.5 font-mono">{st.sent}</td>
                    <td className="py-1.5 font-mono">{st.replies}</td>
                    <td className="py-1.5 font-mono">{st.sent > 0 ? `${st.reply_rate}%` : "—"}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-ink-100 overflow-hidden">
                          <div className="h-full bg-[rgb(255_159_67)]" style={{ width: `${st.share_of_replies}%` }} />
                        </div>
                        <span className="font-mono text-[12px] text-ink-600">{st.share_of_replies}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {senders.length > 1 && (
        <div>
          <h3 className="text-[14px] font-semibold">Inbox health</h3>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Per sending inbox. A bounce rate above 3% or a reply rate far below the others usually means that inbox is landing in spam.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] mt-2">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-500 text-left">
                  <th className="py-1.5 font-medium">Inbox</th>
                  <th className="py-1.5 font-medium">Emails sent</th>
                  <th className="py-1.5 font-medium">Reply rate</th>
                  <th className="py-1.5 font-medium">Bounce rate</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((sd) => (
                  <tr key={sd.sender_id} className="border-t border-ink-100">
                    <td className="py-1.5 font-mono text-[12px] truncate max-w-[220px]">{sd.email}</td>
                    <td className="py-1.5 font-mono">{sd.sent}</td>
                    <td className="py-1.5 font-mono">{sd.contacted > 0 ? `${sd.reply_rate}%` : "—"}</td>
                    <td className="py-1.5 font-mono" style={{ color: sd.bounce_rate > 3 ? "rgb(252 165 165)" : undefined }}>
                      {sd.contacted > 0 ? `${sd.bounce_rate}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function VariantPanel({
  campaignId,
  variants,
  currentWinner,
  suggestedWinner,
  onChange,
}: {
  campaignId: string;
  variants: Array<{ id: string; sent: number; replied: number; reply_rate: number }>;
  currentWinner: string | null;
  suggestedWinner: string | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function promote(variantId: string | null) {
    setBusy(variantId ?? "clear");
    try {
      await fetch(`/api/campaigns/${campaignId}/promote-winner`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variant_id: variantId }),
      });
      onChange();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sheet p-5 my-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-[14px] font-semibold">A/B test breakdown</h3>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Each row = one variant. Sent + reply rate per cohort.
          </p>
        </div>
        {currentWinner && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => promote(null)}
            className="btn-quiet text-[12px]"
          >
            {busy === "clear" ? "Clearing…" : "Resume random pick"}
          </button>
        )}
      </div>
      {suggestedWinner && !currentWinner && (
        <div
          className="mb-3 px-3 py-2 rounded-lg text-[12.5px] border"
          style={{
            borderColor: "rgb(255 159 67 / 0.30)",
            background: "rgb(255 159 67 / 0.06)",
            color: "rgb(255 180 110)",
          }}
        >
          Variant <b className="text-ink">{suggestedWinner}</b> is winning by a statistically meaningful margin. Pin it to send all remaining recipients that variant (campaigns with an auto-pick threshold do this automatically).
        </div>
      )}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-500 text-left">
            <th className="py-1.5 font-medium">Variant</th>
            <th className="py-1.5 font-medium">Sent</th>
            <th className="py-1.5 font-medium">Replied</th>
            <th className="py-1.5 font-medium">Reply rate</th>
            <th className="py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} className="border-t border-ink-100">
              <td className="py-1.5 font-medium">
                {v.id}
                {currentWinner === v.id && (
                  <span
                    className="ml-2 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-full"
                    style={{ background: "rgb(16 185 129 / 0.15)", color: "rgb(110 231 183)" }}
                  >
                    winner
                  </span>
                )}
                {suggestedWinner === v.id && currentWinner !== v.id && (
                  <span
                    className="ml-2 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-full"
                    style={{ background: "rgb(255 159 67 / 0.15)", color: "rgb(255 180 110)" }}
                  >
                    leader
                  </span>
                )}
              </td>
              <td className="py-1.5 font-mono">{v.sent}</td>
              <td className="py-1.5 font-mono">{v.replied}</td>
              <td className="py-1.5 font-mono">{v.reply_rate}%</td>
              <td className="py-1.5 text-right">
                {currentWinner !== v.id && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => promote(v.id)}
                    className="btn-quiet text-[11px]"
                  >
                    {busy === v.id ? "Pinning…" : "Pin as winner"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

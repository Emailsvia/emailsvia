"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { render, toHtml } from "@/lib/template";
import type { Schedule } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import ActivityDrawer, { type ActivityRecipient } from "@/components/ActivityDrawer";
import RotationPanel from "@/components/RotationPanel";

type Sender = { id: string; label: string; email: string; from_name: string | null; is_default: boolean };
type FollowUpStep = { step_number: number; delay_days: number; subject: string | null; template: string };
type Stats = {
  total: number; sent: number; replied: number; failed: number; pending: number; unsubscribed: number;
  follow_ups_sent: number; retries_sent: number;
  opens: number; unique_opens: number; clicks: number; unique_clicks: number;
  rates: { open_rate: number; click_rate: number; reply_rate: number; bounce_rate: number; unsubscribe_rate: number };
  opens_by_hour: number[];
  clicks_by_hour: number[];
  opens_by_weekday: number[];
  clicks_by_weekday: number[];
  timezone: string;
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
};

const STATUS_CLASS: Record<Recipient["status"], string> = {
  pending: "pill-draft",
  sent: "pill-done",
  failed: "pill-warn",
  skipped: "pill-draft",
  replied: "pill-live",
  unsubscribed: "pill-pause",
  bounced: "pill-warn",
};

function statusPillCampaign(s: Campaign["status"]) {
  const map = { running: "pill-live", paused: "pill-pause", done: "pill-done", draft: "pill-draft" } as const;
  const dot = { running: "dot-live", paused: "dot-pause", done: "dot-done", draft: "dot-draft" } as const;
  return <span className={map[s]}><span className={dot[s]} />{s}</span>;
}

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [filter, setFilter] = useState<"all" | Recipient["status"]>("all");
  const [activity, setActivity] = useState<{ recipients: ActivityRecipient[]; links: { url: string; total_clicks: number; unique_clickers: number }[] } | null>(null);
  const [activeRecipient, setActiveRecipient] = useState<ActivityRecipient | null>(null);
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
    alert(`Checked ${d.checked}, ${d.invalid} invalid${d.invalid > 0 ? ` (${d.invalid_emails.slice(0, 5).join(", ")}${d.invalid > 5 ? "…" : ""})` : ""}.`);
    load();
  }

  const currentSender = useMemo(
    () => senders.find((s) => s.id === campaign?.sender_id),
    [senders, campaign?.sender_id]
  );

  if (!campaign) return <AppShell><div className="page text-sm text-ink-500">Loading…</div></AppShell>;

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
      <Link href="/app" className="btn-link text-[12px]">← Campaigns</Link>

      <header className="mt-4 flex items-start justify-between gap-4 flex-wrap pb-5 border-b border-ink-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {statusPillCampaign(campaign.status)}
            <span className="text-[12px] text-ink-500">Updated {new Date(campaign.updated_at).toLocaleString()}</span>
          </div>
          <h1 className="text-[26px] font-bold tracking-tight mt-2">{campaign.name}</h1>
          <p className="text-[14px] text-ink-600 mt-1 truncate max-w-2xl">{campaign.subject}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {campaign.status !== "running" && pending > 0 && (
            <button className="btn-accent" onClick={() => patch({ status: "running" })}>Start sending</button>
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
                  if (!r.ok) {
                    alert(`Tick failed: ${d.error ?? r.status}`);
                  }
                  // refresh stats / recipients so the UI reflects new sends
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
          {pending > 0 && <button className="btn-quiet" onClick={validateEmails} disabled={validating}>{validating ? "Validating…" : "Validate"}</button>}
          <button className="btn-quiet" onClick={duplicate}>Duplicate</button>
          {campaign.status === "done" && <button className="btn-quiet" onClick={archive}>Archive</button>}
          <button className="btn-quiet text-red-600" onClick={destroy}>Delete</button>
        </div>
      </header>

      {/* big stats row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 mt-0">
        <Stat label="Sent" big={`${sent}`} small={`of ${total}`} />
        <Stat label="Replied" big={`${stats?.replied ?? replied}`} small={stats && stats.rates.reply_rate > 0 ? `${stats.rates.reply_rate}% reply rate` : "—"} accent />
        <Stat label="Failed" big={`${failed}`} small={failed > 0 ? "needs attention" : "—"} />
        <Stat label="Pending" big={`${pending}`} small={`${pct}% complete`} />
      </section>

      {/* strict-merge pre-flight banner — only when there's something to fix */}
      {preflight && preflight.affected_total > 0 && preflight.total_pending > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 mb-3">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <div className="flex-1 text-[13px]">
              <div className="font-medium">
                {preflight.affected_total} of {preflight.total_pending} pending rows are missing merge fields
              </div>
              <ul className="mt-1 space-y-0.5">
                {preflight.by_tag.map((b) => (
                  <li key={b.tag}>
                    <code className="bg-amber-100 px-1 py-0.5 rounded text-[12px]">{`{{${b.tag}}}`}</code>
                    {" "}— {b.count} row{b.count === 1 ? "" : "s"}
                    {b.sample.length > 0 && (
                      <span className="text-amber-700/80"> · {b.sample.slice(0, 3).join(", ")}{b.sample.length > 3 ? "…" : ""}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[12px]">
                {preflight.strict_merge ? (
                  <>Strict merge is on — these rows will be <b>skipped</b> when the campaign runs. Fix the sheet or untick &ldquo;Strict merge fields&rdquo; in <Link href={`/app/campaigns/${id}/edit`} className="underline font-medium">Edit</Link> to send them anyway.</>
                ) : (
                  <>Strict merge is <b>off</b> — these rows will send with empty placeholders. Turn it on in <Link href={`/app/campaigns/${id}/edit`} className="underline font-medium">Edit</Link> to skip them instead.</>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* empty-recipients banner */}
      {campaign.status === "draft" && total === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-50 text-amber-800 px-4 py-3 flex items-start gap-3 mb-8">
          <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="flex-1 text-[13px]">
            <div className="font-medium">No recipients on this campaign.</div>
            <div className="mt-0.5">Click <a href={`/app/campaigns/${id}/edit`} className="underline font-medium">Edit</a> to add a Google Sheet or upload an Excel/CSV file. The "Start sending" button will appear once there's at least one recipient.</div>
          </div>
        </div>
      )}

      {/* analytics row */}
      {campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 -mt-px">
          <Stat label="Unique opens" big={`${stats.unique_opens}`} small={`${stats.rates.open_rate}% of sent · ${stats.opens} total`} />
          <Stat label="Unique clicks" big={`${stats.unique_clicks}`} small={`${stats.rates.click_rate}% · ${stats.clicks} total`} />
          <Stat label="Follow-ups sent" big={`${stats.follow_ups_sent}`} small={stats.follow_ups_sent > 0 ? "sequence active" : "—"} />
          <Stat label="Unsubscribed" big={`${stats.unsubscribed}`} small={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : "—"} />
        </section>
      )}
      {!campaign.tracking_enabled && stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-ink-200 -mt-px">
          <Stat label="Follow-ups sent" big={`${stats.follow_ups_sent}`} small={stats.follow_ups_sent > 0 ? "sequence active" : "—"} />
          <Stat label="Retries used" big={`${stats.retries_sent}`} small={stats.retries_sent > 0 ? "auto-retried" : "—"} />
          <Stat label="Unsubscribed" big={`${stats.unsubscribed}`} small={stats.unsubscribed > 0 ? `${stats.rates.unsubscribe_rate}%` : "—"} />
          <Stat label="Tracking" big="off" small="enable in Edit for open/click stats" />
        </section>
      )}

      <div className="h-[2px] w-full bg-ink-100 mt-0 mb-10 relative">
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>

      {campaign.tracking_enabled && stats && stats.opens > 0 && (
        <EngagementSection stats={stats} />
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

          {/* follow-ups */}
          {campaign.follow_ups_enabled && steps.length > 0 && (
            <section className="sheet p-6">
              <h2 className="text-[15px] font-semibold mb-4">Follow-up sequence</h2>
              <div className="space-y-4">
                {steps.map((s) => (
                  <div key={s.step_number} className="grid grid-cols-[70px,1fr] gap-4">
                    <div>
                      <div className="text-[12px] font-semibold text-ink">Step {s.step_number}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5">+{s.delay_days}d delay</div>
                    </div>
                    <div className="border-l border-ink-200 pl-4">
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
                const act = activityById.get(r.id);
                const engage = act && (act.opens > 0 || act.clicks > 0 || act.replied);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => act && setActiveRecipient(act)}
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
                        <span className={`${STATUS_CLASS[r.status]} shrink-0`}>{r.status}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-ink-500">
                        <span>{when !== null ? when : r.error && <span className="text-red-600">{r.error}</span>}</span>
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
                      <span className={STATUS_CLASS[r.status]}>{r.status}</span>
                      <span className="text-[11px] text-ink-500 text-right">
                        {when !== null ? when : r.error && <span className="text-red-600 truncate block max-w-[160px]" title={r.error}>{r.error}</span>}
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

      <ActivityDrawer recipient={activeRecipient} onClose={() => setActiveRecipient(null)} />
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
        <span className="inline-flex items-center gap-0.5 text-emerald-600" title="Replied">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
          </svg>
        </span>
      )}
    </span>
  );
}

function Stat({ label, big, small, accent }: { label: string; big: string; small?: string; accent?: boolean }) {
  return (
    <div className="border-r last:border-r-0 border-ink-200 border-t border-b py-4 px-5">
      <div className="text-[12px] font-medium text-ink-500">{label}</div>
      <div className={`text-[28px] font-bold mt-1 tracking-tight ${accent ? "text-ink" : "text-ink"}`}>{big}</div>
      {small && <div className="text-[11px] text-ink-500 mt-0.5">{small}</div>}
    </div>
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
          <span className="inline-block w-3 h-2 bg-ink rounded-sm" />
          Opens <span className="font-mono text-ink-700">{totalOpens}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 bg-emerald-500 rounded-sm" />
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
                  className={`w-full ${isHovered ? "bg-emerald-400" : "bg-emerald-500"} transition-colors`}
                  style={{ height: `${Math.max(clickPct, 2)}%` }}
                />
              )}
              {o > 0 && (
                <div
                  className={`w-full transition-colors ${isHovered ? "bg-ink-700" : isPeak ? "bg-ink" : "bg-ink-800"}`}
                  style={{ height: `${Math.max(openPct, 3)}%`, minHeight: 3 }}
                />
              )}
              {isHovered && total > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 whitespace-nowrap rounded-md bg-ink text-paper px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none">
                  <div className="font-mono font-semibold">{String(h).padStart(2, "0")}:00</div>
                  <div className="text-ink-300 mt-0.5">
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
                    className={`w-full ${isHovered ? "bg-emerald-400" : "bg-emerald-500"} transition-colors`}
                    style={{ height: `${Math.max(clickPct, 2)}%` }}
                  />
                )}
                {o > 0 && (
                  <div
                    className={`w-full transition-colors ${isHovered ? "bg-ink-700" : isPeak ? "bg-ink" : "bg-ink-800"}`}
                    style={{ height: `${Math.max(openPct, 3)}%`, minHeight: 3 }}
                  />
                )}
                {isHovered && total > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 whitespace-nowrap rounded-md bg-ink text-paper px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none">
                    <div className="font-mono font-semibold">{WEEKDAY_LABEL[d]}</div>
                    <div className="text-ink-300 mt-0.5">
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

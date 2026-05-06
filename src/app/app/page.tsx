"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import KpiCard, { type SparkPoint } from "@/components/app/KpiCard";
import StatusPill from "@/components/app/StatusPill";
import EmptyState from "@/components/app/EmptyState";

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: "draft" | "running" | "paused" | "done";
  daily_cap: number;
  total: number;
  sent: number;
  failed: number;
  updated_at: string;
  created_at: string;
};

type Dashboard = {
  today: { sent: number; replies: number };
  deltas: { sent: number | null; replies: number | null };
  senders: { connected: number; total: number };
  campaigns: { running: number; total: number };
  reply_rate_14d: number;
  spark: SparkPoint[];
};

type FilterKey = "all" | "running" | "draft" | "done";

export default function AppHome() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  async function loadCampaigns() {
    const r = await fetch(`/api/campaigns${showArchived ? "?archived=1" : ""}`, { cache: "no-store" });
    const data = await r.json();
    setRows(data.campaigns ?? []);
  }
  async function loadDashboard() {
    try {
      const r = await fetch("/api/app/dashboard", { cache: "no-store" });
      if (r.ok) setDash(await r.json());
    } catch { /* dashboard is best-effort — page still works without it */ }
  }

  useEffect(() => {
    loadCampaigns();
    const t = setInterval(loadCampaigns, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    loadDashboard();
    const t = setInterval(loadDashboard, 30_000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    let result = rows ?? [];
    if (filter !== "all") result = result.filter((r) => r.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.subject || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [rows, filter, query]);

  const counts = useMemo(() => ({
    all:     rows?.length ?? 0,
    running: rows?.filter((r) => r.status === "running").length ?? 0,
    draft:   rows?.filter((r) => r.status === "draft").length   ?? 0,
    done:    rows?.filter((r) => r.status === "done").length    ?? 0,
  }), [rows]);

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          eyebrow="Workspace · Today"
          title={<Greeting />}
          subtitle={
            rows
              ? `${counts.all} ${counts.all === 1 ? "campaign" : "campaigns"} · ${counts.running} running right now`
              : "Loading…"
          }
          actions={
            <>
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="btn-quiet text-[13px] cursor-pointer"
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
              <Link href="/app/campaigns/new" className="btn-accent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New campaign
              </Link>
            </>
          }
        />

        {/* KPI strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <KpiCard
            label="Sent today"
            value={dash ? dash.today.sent.toLocaleString() : "—"}
            delta={dash?.deltas.sent}
            spark={dash?.spark}
            tone="hot"
            loading={!dash}
          />
          <KpiCard
            label="Replies today"
            value={dash ? dash.today.replies.toLocaleString() : "—"}
            delta={dash?.deltas.replies}
            loading={!dash}
          />
          <KpiCard
            label="Reply rate · 14d"
            value={dash ? dash.reply_rate_14d.toFixed(1) : "—"}
            unit="%"
            loading={!dash}
          />
          <KpiCard
            label="Senders connected"
            value={dash ? dash.senders.connected.toString() : "—"}
            unit={dash ? `of ${dash.senders.total}` : undefined}
            loading={!dash}
          />
        </section>

        {/* Toolbar: filter chips + search */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "running", "draft", "done"] as FilterKey[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-md transition-colors capitalize cursor-pointer ${
                  filter === f
                    ? "bg-hover text-ink"
                    : "text-ink-600 hover:bg-hover hover:text-ink"
                }`}
              >
                {f}
                {rows && (
                  <span className={`font-mono text-[11px] ${filter === f ? "text-ink-600" : "text-ink-400"}`}>
                    {counts[f]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or subject…"
              className="bg-surface border border-ink-200 rounded-md pl-8 pr-3 py-1.5 text-[13px] text-ink placeholder:text-ink-400 outline-none focus:border-ink-300 transition-colors w-full sm:w-64"
            />
          </div>
        </div>

        {/* States */}
        {rows === null && <SkeletonTable />}

        {rows?.length === 0 && (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
            title="No campaigns yet"
            body="Connect a Gmail, paste a Sheet of recipients, and you're sending in about four minutes."
            action={
              <Link href="/app/campaigns/new" className="btn-accent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create your first campaign
              </Link>
            }
          />
        )}

        {rows && rows.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-[13px] text-ink-500">
            Nothing matches{" "}
            {query ? <span className="font-mono text-ink">&ldquo;{query}&rdquo;</span> : <span>this filter</span>}.
          </div>
        )}

        {filtered.length > 0 && <CampaignsTable rows={filtered} />}
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function Greeting() {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Up late," : hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
  return (
    <span>
      {greeting}{" "}
      <span className="text-ink-500 font-normal">let&rsquo;s ship some mail.</span>
    </span>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-ink-100 last:border-b-0"
        >
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-2.5 w-2/3 rounded bg-ink-100 animate-pulse" />
          </div>
          <div className="h-2 w-20 rounded bg-ink-100 animate-pulse" />
          <div className="h-5 w-14 rounded-full bg-ink-100 animate-pulse" />
          <div className="h-2 w-12 rounded bg-ink-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function CampaignsTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {/* Desktop header */}
      <div className="hidden md:grid grid-cols-[1fr,200px,120px,100px] gap-4 px-4 py-2.5 border-b border-ink-200 bg-surface">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">Name</span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">Progress</span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">Status</span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 text-right">Updated</span>
      </div>

      {rows.map((c, i) => {
        const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
        return (
          <Link
            key={c.id}
            href={`/app/campaigns/${c.id}`}
            className={`group block md:grid md:grid-cols-[1fr,200px,120px,100px] md:gap-4 md:items-center px-4 py-3 hover:bg-hover transition-colors ${
              i < rows.length - 1 ? "border-b border-ink-100" : ""
            }`}
          >
            {/* Name + subject */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 md:block">
                <div className="text-[14px] font-medium text-ink truncate flex-1 md:flex-initial group-hover:text-ink">
                  {c.name}
                </div>
                <span className="md:hidden shrink-0">
                  <StatusPill status={c.status} />
                </span>
              </div>
              <div className="text-[12.5px] text-ink-500 truncate mt-0.5">{c.subject}</div>

              {/* Mobile-only progress */}
              <div className="md:hidden flex items-center gap-2 mt-2">
                <ProgressBar pct={pct} />
                <span className="font-mono text-[11px] text-ink-500 tabular-nums whitespace-nowrap">
                  {c.sent.toLocaleString()} / {c.total.toLocaleString()} · {pct}%
                </span>
              </div>
              <div className="md:hidden font-mono text-[11px] text-ink-400 mt-1">
                Updated {relative(c.updated_at)}
              </div>
            </div>

            {/* Desktop progress */}
            <div className="hidden md:block min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[12px] text-ink tabular-nums">
                  {c.sent.toLocaleString()} <span className="text-ink-400">/ {c.total.toLocaleString()}</span>
                </span>
                <span className="font-mono text-[11px] text-ink-500">{pct}%</span>
              </div>
              <ProgressBar pct={pct} />
            </div>

            <div className="hidden md:flex items-center"><StatusPill status={c.status} /></div>

            <div className="hidden md:block font-mono text-[11.5px] text-ink-500 text-right">
              {relative(c.updated_at)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: pct >= 100
            ? "rgb(16 185 129)"
            : "linear-gradient(90deg, rgb(255 99 99), rgb(255 159 67))",
        }}
      />
    </div>
  );
}

function relative(dt: string): string {
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dt).toLocaleDateString();
}

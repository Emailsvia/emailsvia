"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

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

function statusPill(s: CampaignRow["status"]) {
  const map = { running: "pill-live", paused: "pill-pause", done: "pill-done", draft: "pill-draft" } as const;
  const dot = { running: "dot-live", paused: "dot-pause", done: "dot-done", draft: "dot-draft" } as const;
  return (
    <span className={map[s]}>
      <span className={dot[s]} />
      {s}
    </span>
  );
}

function relative(dt: string) {
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

export default function Home() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<"all" | "running" | "draft" | "done">("all");

  async function load() {
    const r = await fetch(`/api/campaigns${showArchived ? "?archived=1" : ""}`, { cache: "no-store" });
    const data = await r.json();
    setRows(data.campaigns ?? []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const filtered = (rows ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <AppShell>
      <div className="page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">Campaigns</h1>
            <p className="text-[13px] text-ink-500 mt-1">
              {rows ? `${rows.length} ${rows.length === 1 ? "campaign" : "campaigns"}` : "Loading…"}
              {rows && ` · ${rows.filter((r) => r.status === "running").length} running`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="btn-quiet text-[13px]"
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
            <Link href="/app/campaigns/new" className="btn-accent">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              New
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-4">
          {(["all", "running", "draft", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[13px] px-2.5 py-1 rounded transition-colors capitalize cursor-pointer ${
                filter === f ? "bg-hover text-ink font-medium" : "text-ink-500 hover:bg-hover hover:text-ink"
              }`}
            >
              {f}
              {rows && (
                <span className="ml-1.5 text-ink-400">
                  {f === "all" ? rows.length : rows.filter((r) => r.status === f).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {rows === null && (
          <div className="text-[13px] text-ink-500 py-8">Loading…</div>
        )}

        {rows?.length === 0 && (
          <div className="text-center py-16 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No campaigns yet</div>
            <p className="text-[13px] text-ink-500 mb-4">Create your first campaign to get started.</p>
            <Link href="/app/campaigns/new" className="btn-accent inline-flex">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              New campaign
            </Link>
          </div>
        )}

        {rows && rows.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-[13px] text-ink-500">No campaigns match this filter.</div>
        )}

        {filtered.length > 0 && (
          <div className="sheet overflow-hidden">
            {/* desktop table header */}
            <div className="hidden md:grid grid-cols-[1fr,auto,120px,100px] gap-4 px-4 py-2.5 border-b border-ink-200 text-[12px] font-medium text-ink-500">
              <span>Name</span>
              <span className="text-right">Progress</span>
              <span>Status</span>
              <span className="text-right">Updated</span>
            </div>
            {filtered.map((c) => {
              const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
              return (
                <Link
                  key={c.id}
                  href={`/app/campaigns/${c.id}`}
                  className="block md:grid md:grid-cols-[1fr,auto,120px,100px] md:gap-4 px-4 py-3 border-b border-ink-100 last:border-b-0 hover:bg-hover transition-colors"
                >
                  {/* mobile: stacked; desktop: first column */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 md:block">
                      <div className="text-[14px] font-medium text-ink truncate flex-1 md:flex-initial">{c.name}</div>
                      <span className="md:hidden shrink-0">{statusPill(c.status)}</span>
                    </div>
                    <div className="text-[12px] text-ink-500 truncate mt-0.5">{c.subject}</div>
                    {/* mobile-only progress bar under name */}
                    <div className="md:hidden flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1 bg-ink-100 rounded-full overflow-hidden">
                        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-ink-500 font-mono tabular-nums whitespace-nowrap">
                        {c.sent} / {c.total} · {pct}%
                      </span>
                    </div>
                    <div className="md:hidden text-[11px] text-ink-500 mt-1">Updated {relative(c.updated_at)}</div>
                  </div>
                  {/* desktop-only columns */}
                  <div className="hidden md:block text-right">
                    <div className="text-[13px] font-mono">{c.sent} / {c.total}</div>
                    <div className="flex items-center gap-1.5 justify-end mt-1">
                      <div className="w-16 h-1 bg-ink-100 rounded-full overflow-hidden">
                        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-ink-400 font-mono">{pct}%</span>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center">{statusPill(c.status)}</div>
                  <div className="hidden md:block text-[12px] text-ink-500 text-right">{relative(c.updated_at)}</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

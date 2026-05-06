"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/app/PageHeader";
import StatusPill from "@/components/app/StatusPill";

type AdminCampaign = {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  status: string;
  daily_cap: number;
  created_at: string;
  archived_at: string | null;
  owner_email: string | null;
  counts: {
    pending: number;
    sent: number;
    failed: number;
    replied: number;
    unsubscribed: number;
    bounced: number;
    skipped: number;
    total: number;
  } | null;
};

export default function AdminCampaignsPage() {
  const [data, setData] = useState<AdminCampaign[] | null>(null);
  const [status, setStatus] = useState<"" | "draft" | "running" | "paused" | "done">("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    fetch(`/api/admin/campaigns?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d.campaigns));
  }, [status]);

  const filtered = (data ?? []).filter((c) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      c.name.toLowerCase().includes(needle) ||
      c.subject.toLowerCase().includes(needle) ||
      (c.owner_email ?? "").toLowerCase().includes(needle)
    );
  });

  function exportCsv() {
    const cols = ["id", "owner", "name", "subject", "status", "total", "sent", "failed", "replied", "unsubscribed", "created_at"];
    const rows = filtered.map((c) =>
      [c.id, c.owner_email ?? c.user_id, c.name, c.subject, c.status, String(c.counts?.total ?? 0), String(c.counts?.sent ?? 0), String(c.counts?.failed ?? 0), String(c.counts?.replied ?? 0), String(c.counts?.unsubscribed ?? 0), c.created_at]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `emailsvia-campaigns-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Campaigns"
        subtitle="All campaigns across all tenants. Click a row to open the owner."
        actions={
          <button type="button" onClick={exportCsv} className="btn-quiet text-[13px]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export CSV
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search name / subject / owner email"
            className="w-full bg-surface border border-ink-200 rounded-md pl-8 pr-3 py-1.5 text-[13px] text-ink placeholder:text-ink-400 outline-none focus:border-ink-300 transition-colors"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
          <option value="done">Done</option>
        </select>
      </div>

      <div className="font-mono text-[11.5px] text-ink-500 mb-3">
        {data ? `${filtered.length.toLocaleString()} campaigns` : "Loading…"}
      </div>

      {data === null ? (
        <SkeletonTable />
      ) : (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left bg-surface border-b border-ink-200">
                <ColHead>Owner</ColHead>
                <ColHead>Campaign</ColHead>
                <ColHead>Status</ColHead>
                <ColHead className="text-right">Sent</ColHead>
                <ColHead className="text-right">Failed</ColHead>
                <ColHead className="text-right">Replied</ColHead>
                <ColHead className="text-right">Total</ColHead>
                <ColHead>Started</ColHead>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  className={`hover:bg-hover transition-colors ${i < filtered.length - 1 ? "border-b border-ink-100" : ""}`}
                >
                  <td className="py-2.5 px-3">
                    <Link
                      href={`/admin/users/${c.user_id}`}
                      className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                    >
                      {c.owner_email ?? <span className="font-mono text-[11.5px] text-ink-500">{c.user_id.slice(0, 8)}</span>}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="text-ink font-medium truncate max-w-[260px]">{c.name}</div>
                    <div className="text-[11.5px] text-ink-500 truncate max-w-[260px]">{c.subject}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink tabular-nums">
                    {c.counts?.sent.toLocaleString() ?? "0"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {c.counts && c.counts.failed > 0 ? (
                      <span className="text-[rgb(252_165_165)]">{c.counts.failed.toLocaleString()}</span>
                    ) : (
                      <span className="text-ink-400">0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink tabular-nums">
                    {c.counts?.replied.toLocaleString() ?? "0"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink-700 tabular-nums">
                    {c.counts?.total.toLocaleString() ?? "0"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500">
                    {new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-500">No campaigns match.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ColHead({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium py-2.5 px-3 ${className}`}>
      {children}
    </th>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`grid grid-cols-8 gap-3 items-center px-3 py-2.5 ${i < 5 ? "border-b border-ink-100" : ""}`}
        >
          {Array.from({ length: 8 }).map((__, j) => (
            <div key={j} className="h-3 rounded bg-ink-100 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

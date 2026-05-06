"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
    const cols = [
      "id",
      "owner",
      "name",
      "subject",
      "status",
      "total",
      "sent",
      "failed",
      "replied",
      "unsubscribed",
      "created_at",
    ];
    const rows = filtered.map((c) =>
      [
        c.id,
        c.owner_email ?? c.user_id,
        c.name,
        c.subject,
        c.status,
        String(c.counts?.total ?? 0),
        String(c.counts?.sent ?? 0),
        String(c.counts?.failed ?? 0),
        String(c.counts?.replied ?? 0),
        String(c.counts?.unsubscribed ?? 0),
        c.created_at,
      ]
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
    <div className="page-narrow">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Campaigns</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            All campaigns across all tenants. Click a row to open the owner.
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="btn-quiet text-[12px]">
          Export CSV
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search name / subject / owner email"
          className="field-boxed flex-1 min-w-[200px]"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="field-boxed"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
          <option value="done">Done</option>
        </select>
      </div>

      <div className="mt-3 text-[12px] text-ink-500">
        {data ? `${filtered.length.toLocaleString()} campaigns` : "Loading…"}
      </div>

      <div className="sheet mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-ink-500 text-left bg-paper">
              <th className="py-2 px-3 font-medium">Owner</th>
              <th className="py-2 px-3 font-medium">Campaign</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium text-right">Sent</th>
              <th className="py-2 px-3 font-medium text-right">Failed</th>
              <th className="py-2 px-3 font-medium text-right">Replied</th>
              <th className="py-2 px-3 font-medium text-right">Total</th>
              <th className="py-2 px-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-ink-100">
                <td className="py-1.5 px-3">
                  <Link
                    href={`/admin/users/${c.user_id}`}
                    className="hover:underline"
                  >
                    {c.owner_email ?? <span className="font-mono text-[11px]">{c.user_id.slice(0, 8)}</span>}
                  </Link>
                </td>
                <td className="py-1.5 px-3">
                  <div className="font-medium truncate max-w-[260px]">{c.name}</div>
                  <div className="text-[11px] text-ink-500 truncate max-w-[260px]">
                    {c.subject}
                  </div>
                </td>
                <td className="py-1.5 px-3">
                  <span
                    className={
                      "capitalize " +
                      (c.status === "running"
                        ? "text-emerald-700"
                        : c.status === "paused"
                          ? "text-amber-700"
                          : c.status === "done"
                            ? "text-ink-500"
                            : "text-ink")
                    }
                  >
                    {c.status}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {c.counts?.sent.toLocaleString() ?? "0"}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {c.counts && c.counts.failed > 0 ? (
                    <span className="text-red-700">{c.counts.failed}</span>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {c.counts?.replied.toLocaleString() ?? "0"}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {c.counts?.total.toLocaleString() ?? "0"}
                </td>
                <td className="py-1.5 px-3 text-[11px] text-ink-500">
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && filtered.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-500">No campaigns.</p>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";

type Delivery = {
  id: string;
  webhook_id: string;
  user_id: string;
  event_type: string;
  event_id: string;
  status: string;
  attempts: number;
  http_status: number | null;
  response_excerpt: string | null;
  next_attempt_at: string | null;
  created_at: string;
  delivered_at: string | null;
  owner_email: string | null;
  webhook: { name: string; url: string; active: boolean } | null;
};

type Tone = { dot: string; text: string; bg: string };

const STATUS_TONE: Record<string, Tone> = {
  succeeded: { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
  pending:   { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  failed:    { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  exhausted: { dot: "rgb(239 68 68)",   text: "rgb(252 165 165)", bg: "rgb(239 68 68 / 0.10)" },
};

function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? {
    dot: "rgb(113 113 122)",
    text: "rgb(161 161 170)",
    bg: "rgb(255 255 255 / 0.04)",
  };
}

export default function AdminWebhooksPage() {
  const [data, setData] = useState<{
    status_counts: Record<string, number>;
    deliveries: Delivery[];
  } | null>(null);
  const [status, setStatus] = useState<"" | "pending" | "succeeded" | "failed" | "exhausted">("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    fetch(`/api/admin/webhooks?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, [status]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Webhook log"
        subtitle="Outbound webhook deliveries. Surface stuck or exhausted destinations."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed (retrying)</option>
          <option value="exhausted">Exhausted</option>
        </select>
        {data && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.status_counts).map(([k, v]) => {
              const tone = statusTone(k);
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                  {k}
                  <span className="font-mono opacity-80 normal-case">{v}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {data === null ? (
        <SkeletonTable />
      ) : (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left bg-surface border-b border-ink-200">
                <ColHead>Owner</ColHead>
                <ColHead>Destination</ColHead>
                <ColHead>Event</ColHead>
                <ColHead>Status</ColHead>
                <ColHead className="text-right">Attempts</ColHead>
                <ColHead className="text-right">HTTP</ColHead>
                <ColHead>Created</ColHead>
              </tr>
            </thead>
            <tbody>
              {data.deliveries.map((d, i) => {
                const tone = statusTone(d.status);
                return (
                  <tr
                    key={d.id}
                    className={`align-top hover:bg-hover transition-colors ${
                      i < data.deliveries.length - 1 ? "border-b border-ink-100" : ""
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <Link
                        href={`/admin/users/${d.user_id}`}
                        className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                      >
                        {d.owner_email ?? <span className="font-mono text-[11px] text-ink-500">{d.user_id.slice(0, 8)}</span>}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 max-w-[260px]">
                      <div className="text-ink font-medium truncate">{d.webhook?.name ?? "—"}</div>
                      <div className="font-mono text-[11.5px] text-ink-500 truncate">{d.webhook?.url ?? ""}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[12px] text-ink-700">{d.event_type}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: tone.bg, color: tone.text }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-ink tabular-nums">{d.attempts}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {d.http_status != null
                        ? <span className={d.http_status >= 400 ? "text-[rgb(252_165_165)]" : "text-ink-700"}>{d.http_status}</span>
                        : <span className="text-ink-400">—</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500 whitespace-nowrap">
                      {new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.deliveries.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-500">No deliveries yet.</p>
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
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`grid grid-cols-7 gap-3 items-center px-3 py-2.5 ${i < 4 ? "border-b border-ink-100" : ""}`}
        >
          {Array.from({ length: 7 }).map((__, j) => (
            <div key={j} className="h-3 rounded bg-ink-100 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

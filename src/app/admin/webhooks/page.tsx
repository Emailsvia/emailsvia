"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-emerald-700",
  pending: "text-amber-700",
  failed: "text-amber-700",
  exhausted: "text-red-700",
};

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
    <div className="page-narrow">
      <h1 className="text-[28px] font-bold tracking-tight">Webhook log</h1>
      <p className="text-[13px] text-ink-500 mt-1">
        Outbound webhook deliveries. Surface stuck or exhausted destinations.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="field-boxed"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed (retrying)</option>
          <option value="exhausted">Exhausted</option>
        </select>
        {data && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.status_counts).map(([k, v]) => (
              <span
                key={k}
                className={
                  "text-[11px] px-2 py-0.5 rounded bg-paper border border-ink-100 " +
                  (STATUS_TONE[k] ?? "")
                }
              >
                {k}: {v}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sheet mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-ink-500 text-left bg-paper">
              <th className="py-2 px-3 font-medium">Owner</th>
              <th className="py-2 px-3 font-medium">Destination</th>
              <th className="py-2 px-3 font-medium">Event</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium text-right">Attempts</th>
              <th className="py-2 px-3 font-medium text-right">HTTP</th>
              <th className="py-2 px-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.deliveries ?? []).map((d) => (
              <tr key={d.id} className="border-t border-ink-100 align-top">
                <td className="py-1.5 px-3">
                  <Link
                    href={`/admin/users/${d.user_id}`}
                    className="hover:underline"
                  >
                    {d.owner_email ?? (
                      <span className="font-mono text-[11px]">
                        {d.user_id.slice(0, 8)}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="py-1.5 px-3 max-w-[260px]">
                  <div className="font-medium truncate">
                    {d.webhook?.name ?? "—"}
                  </div>
                  <div className="text-[11px] text-ink-500 truncate font-mono">
                    {d.webhook?.url ?? ""}
                  </div>
                </td>
                <td className="py-1.5 px-3 font-mono text-[12px]">{d.event_type}</td>
                <td className="py-1.5 px-3">
                  <span className={STATUS_TONE[d.status] ?? "text-ink"}>{d.status}</span>
                </td>
                <td className="py-1.5 px-3 text-right font-mono">{d.attempts}</td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {d.http_status ?? "—"}
                </td>
                <td className="py-1.5 px-3 text-[11px] text-ink-500">
                  {new Date(d.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.deliveries.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-500">
            No deliveries yet.
          </p>
        )}
      </div>
    </div>
  );
}

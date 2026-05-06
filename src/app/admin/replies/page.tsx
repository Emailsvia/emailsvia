"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AdminReply = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  intent: string | null;
  intent_confidence: number | null;
  received_at: string | null;
  created_at: string;
  owner_email: string | null;
};

const INTENT_TONE: Record<string, string> = {
  interested: "text-emerald-700",
  question: "text-blue-700",
  not_now: "text-amber-700",
  unsubscribe: "text-red-700",
  ooo: "text-ink-500",
  bounce: "text-red-700",
  other: "text-ink-500",
};

export default function AdminRepliesPage() {
  const [data, setData] = useState<{
    intent_counts: Record<string, number>;
    replies: AdminReply[];
  } | null>(null);
  const [intent, setIntent] = useState("");
  const [days, setDays] = useState(7);

  useEffect(() => {
    const params = new URLSearchParams();
    if (intent) params.set("intent", intent);
    params.set("days", String(days));
    fetch(`/api/admin/replies?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d));
  }, [intent, days]);

  return (
    <div className="page-narrow">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Replies</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            Cross-tenant inbound responses with AI intent labels.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="field-boxed"
        >
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          className="field-boxed"
        >
          <option value="">All intents</option>
          <option value="interested">Interested</option>
          <option value="question">Question</option>
          <option value="not_now">Not now</option>
          <option value="unsubscribe">Unsubscribe</option>
          <option value="ooo">OOO</option>
          <option value="bounce">Bounce</option>
          <option value="other">Other</option>
        </select>
      </div>

      {data && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(data.intent_counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <span
                key={k}
                className={
                  "text-[11px] px-2 py-0.5 rounded bg-paper border border-ink-100 " +
                  (INTENT_TONE[k] ?? "")
                }
              >
                {k}: {v.toLocaleString()}
              </span>
            ))}
        </div>
      )}

      <div className="sheet mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-ink-500 text-left bg-paper">
              <th className="py-2 px-3 font-medium">Owner</th>
              <th className="py-2 px-3 font-medium">From</th>
              <th className="py-2 px-3 font-medium">Reply</th>
              <th className="py-2 px-3 font-medium">Intent</th>
              <th className="py-2 px-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {(data?.replies ?? []).map((r) => (
              <tr key={r.id} className="border-t border-ink-100 align-top">
                <td className="py-1.5 px-3">
                  <Link
                    href={`/admin/users/${r.user_id}`}
                    className="hover:underline text-[12px]"
                  >
                    {r.owner_email ?? (
                      <span className="font-mono text-[11px]">
                        {r.user_id.slice(0, 8)}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="py-1.5 px-3 text-[12px] truncate max-w-[200px]">
                  {r.from_email}
                </td>
                <td className="py-1.5 px-3 max-w-[420px]">
                  <div className="truncate font-medium">{r.subject ?? "(no subject)"}</div>
                  <div className="text-[11px] text-ink-500 line-clamp-2">
                    {r.snippet ?? ""}
                  </div>
                </td>
                <td className="py-1.5 px-3">
                  {r.intent ? (
                    <span className={INTENT_TONE[r.intent] ?? "text-ink"}>
                      {r.intent}
                      {r.intent_confidence != null && (
                        <span className="text-ink-500 text-[10px] ml-1">
                          {Math.round(r.intent_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-[11px] text-ink-500">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.replies.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-500">No replies in window.</p>
        )}
      </div>
    </div>
  );
}

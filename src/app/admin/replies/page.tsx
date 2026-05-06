"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import IntentBadge, { intentTone, type Intent } from "@/components/app/IntentBadge";

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
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Replies"
        subtitle="Cross-tenant inbound responses with AI intent labels."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
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
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(data.intent_counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => {
              const tone = intentTone(k as Intent);
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                  {k}
                  <span className="font-mono opacity-80 normal-case">{v.toLocaleString()}</span>
                </span>
              );
            })}
        </div>
      )}

      {data === null ? (
        <SkeletonTable />
      ) : (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left bg-surface border-b border-ink-200">
                <ColHead>Owner</ColHead>
                <ColHead>From</ColHead>
                <ColHead>Reply</ColHead>
                <ColHead>Intent</ColHead>
                <ColHead>When</ColHead>
              </tr>
            </thead>
            <tbody>
              {data.replies.map((r, i) => (
                <tr
                  key={r.id}
                  className={`align-top hover:bg-hover transition-colors ${
                    i < data.replies.length - 1 ? "border-b border-ink-100" : ""
                  }`}
                >
                  <td className="py-2.5 px-3">
                    <Link
                      href={`/admin/users/${r.user_id}`}
                      className="text-ink hover:text-[rgb(255_140_140)] transition-colors text-[12.5px]"
                    >
                      {r.owner_email ?? <span className="font-mono text-[11px] text-ink-500">{r.user_id.slice(0, 8)}</span>}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[12px] text-ink-700 truncate max-w-[200px]">
                    {r.from_email}
                  </td>
                  <td className="py-2.5 px-3 max-w-[420px]">
                    <div className="text-ink font-medium truncate">
                      {r.subject ?? <span className="italic text-ink-400 font-normal">(no subject)</span>}
                    </div>
                    <div className="text-[12px] text-ink-500 line-clamp-2 mt-0.5">{r.snippet ?? ""}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    {r.intent ? (
                      <IntentBadge
                        intent={r.intent as Intent}
                        confidence={r.intent_confidence}
                        size="xs"
                      />
                    ) : (
                      <span className="text-ink-400 font-mono text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.replies.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-500">No replies in window.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium py-2.5 px-3">
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
          className={`grid grid-cols-5 gap-3 items-start px-3 py-3 ${i < 5 ? "border-b border-ink-100" : ""}`}
        >
          <div className="h-3 rounded bg-ink-100 animate-pulse" />
          <div className="h-3 rounded bg-ink-100 animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 w-2/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-2.5 w-full rounded bg-ink-100 animate-pulse" />
          </div>
          <div className="h-5 w-16 rounded-full bg-ink-100 animate-pulse" />
          <div className="h-3 rounded bg-ink-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

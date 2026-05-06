"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StackedBars, LegendDot } from "@/components/MiniChart";

type BillingData = {
  mrr_cents: number;
  paying_users: number;
  trend: Array<{ day: string; mrr_cents: number }>;
  events: Array<{ event_id: string; type: string; processed_at: string }>;
  churn: Array<{
    user_id: string;
    plan_id: string;
    status: string;
    cancel_at_period_end: boolean;
    suspended_at: string | null;
    current_period_end: string | null;
    owner_email: string | null;
  }>;
};

export default function AdminBillingPage() {
  const [d, setD] = useState<BillingData | null>(null);
  useEffect(() => {
    fetch("/api/admin/billing", { cache: "no-store" })
      .then((r) => r.json())
      .then(setD);
  }, []);

  if (!d) {
    return (
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">Billing &amp; MRR</h1>
        <p className="text-[13px] text-ink-500 mt-2">Loading…</p>
      </div>
    );
  }

  const mrrChartData = d.trend.map((p) => ({
    day: p.day,
    values: { mrr: p.mrr_cents / 100 },
  }));
  const peak = Math.max(...d.trend.map((p) => p.mrr_cents)) / 100;
  const startMrr = d.trend[0]?.mrr_cents ?? 0;
  const change = startMrr > 0 ? ((d.mrr_cents - startMrr) / startMrr) * 100 : 0;

  return (
    <div className="page-narrow">
      <h1 className="text-[28px] font-bold tracking-tight">Billing &amp; MRR</h1>
      <p className="text-[13px] text-ink-500 mt-1">
        Live recurring revenue, churn signals, and the Stripe event ledger.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <Stat label="MRR" value={`$${(d.mrr_cents / 100).toLocaleString()}`} />
        <Stat label="Paying users" value={d.paying_users.toLocaleString()} />
        <Stat
          label="90-day change"
          value={
            startMrr > 0
              ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`
              : "—"
          }
          tone={change < -2 ? "warn" : undefined}
        />
        <Stat label="Peak (90d)" value={`$${peak.toLocaleString()}`} />
      </div>

      <div className="sheet p-4 mt-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-[14px] font-semibold">MRR · last 90 days</h2>
          <LegendDot color="#34d399" label="MRR ($)" />
        </div>
        <div className="mt-3">
          <StackedBars
            data={mrrChartData}
            keys={["mrr"]}
            colors={{ mrr: "#34d399" }}
            height={140}
          />
        </div>
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">
          Churn & risk ({d.churn.length})
        </h2>
        {d.churn.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            No subs flagged as canceling, past-due, or suspended.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[12px] text-ink-500 text-left">
                <th className="py-1.5 font-medium">Owner</th>
                <th className="py-1.5 font-medium">Plan</th>
                <th className="py-1.5 font-medium">Status</th>
                <th className="py-1.5 font-medium">Period end</th>
              </tr>
            </thead>
            <tbody>
              {d.churn.map((c) => (
                <tr key={c.user_id} className="border-t border-ink-100">
                  <td className="py-1.5">
                    <Link
                      href={`/admin/users/${c.user_id}`}
                      className="hover:underline"
                    >
                      {c.owner_email ?? (
                        <span className="font-mono text-[11px]">
                          {c.user_id.slice(0, 8)}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="py-1.5 capitalize">{c.plan_id}</td>
                  <td className="py-1.5">
                    {c.suspended_at ? (
                      <span className="text-red-700">suspended</span>
                    ) : c.status === "past_due" ? (
                      <span className="text-red-700">past due</span>
                    ) : c.cancel_at_period_end ? (
                      <span className="text-amber-700">canceling</span>
                    ) : (
                      c.status
                    )}
                  </td>
                  <td className="py-1.5 text-[11px] text-ink-500">
                    {c.current_period_end
                      ? new Date(c.current_period_end).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">
          Recent Stripe events ({d.events.length})
        </h2>
        {d.events.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            No events processed yet. Webhook is wired but quiet.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[12px] text-ink-500 text-left">
                <th className="py-1.5 font-medium">Event</th>
                <th className="py-1.5 font-medium">Type</th>
                <th className="py-1.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {d.events.map((e) => (
                <tr key={e.event_id} className="border-t border-ink-100">
                  <td className="py-1.5 font-mono text-[11px] truncate max-w-[220px]">
                    <a
                      className="hover:underline"
                      href={`https://dashboard.stripe.com/events/${e.event_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.event_id}
                    </a>
                  </td>
                  <td className="py-1.5 font-mono text-[12px]">{e.type}</td>
                  <td className="py-1.5 text-[11px] text-ink-500">
                    {new Date(e.processed_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="sheet p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div
        className={
          "text-[20px] font-bold mt-1 " + (tone === "warn" ? "text-red-600" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}

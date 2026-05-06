"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StackedBars, LegendDot } from "@/components/MiniChart";
import PageHeader from "@/components/app/PageHeader";
import KpiCard from "@/components/app/KpiCard";
import StatusPill from "@/components/app/StatusPill";

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

const MRR_GREEN = "rgb(16 185 129)";

export default function AdminBillingPage() {
  const [d, setD] = useState<BillingData | null>(null);
  useEffect(() => {
    fetch("/api/admin/billing", { cache: "no-store" })
      .then((r) => r.json())
      .then(setD);
  }, []);

  if (!d) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operator" title="Billing & MRR" />
        <SkeletonBilling />
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
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Billing & MRR"
        subtitle="Live recurring revenue, churn signals, and the Stripe event ledger."
      />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="MRR"
          value={`$${(d.mrr_cents / 100).toLocaleString()}`}
          tone="hot"
        />
        <KpiCard
          label="Paying users"
          value={d.paying_users.toLocaleString()}
        />
        <KpiCard
          label="90-day change"
          value={startMrr > 0 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
          tone={change < -2 ? "hot" : "default"}
        />
        <KpiCard
          label="Peak (90d)"
          value={`$${peak.toLocaleString()}`}
        />
      </section>

      <Panel
        title="MRR · last 90 days"
        legend={<LegendDot color={MRR_GREEN} label="MRR ($)" />}
      >
        <StackedBars
          data={mrrChartData}
          keys={["mrr"]}
          colors={{ mrr: MRR_GREEN }}
          height={140}
        />
      </Panel>

      <Panel title={`Churn & risk (${d.churn.length})`} className="mt-3">
        {d.churn.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-[13px] text-[rgb(110_231_183)]">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "rgb(16 185 129)", boxShadow: "0 0 8px rgb(16 185 129 / 0.5)" }}
            />
            No subs flagged as canceling, past-due, or suspended.
          </div>
        ) : (
          <div className="rounded-lg border border-ink-100 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left bg-surface border-b border-ink-100">
                  <ColHead>Owner</ColHead>
                  <ColHead>Plan</ColHead>
                  <ColHead>Status</ColHead>
                  <ColHead>Period end</ColHead>
                </tr>
              </thead>
              <tbody>
                {d.churn.map((c, i) => {
                  const status = c.suspended_at
                    ? "failed"
                    : c.status === "past_due"
                      ? "failed"
                      : c.cancel_at_period_end
                        ? "paused"
                        : c.status;
                  return (
                    <tr
                      key={c.user_id}
                      className={`hover:bg-hover transition-colors ${i < d.churn.length - 1 ? "border-b border-ink-100" : ""}`}
                    >
                      <td className="py-2.5 px-3">
                        <Link
                          href={`/admin/users/${c.user_id}`}
                          className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                        >
                          {c.owner_email ?? <span className="font-mono text-[11.5px] text-ink-500">{c.user_id.slice(0, 8)}</span>}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 capitalize text-ink-700">{c.plan_id}</td>
                      <td className="py-2.5 px-3">
                        <StatusPill status={status} />
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500">
                        {c.current_period_end
                          ? new Date(c.current_period_end).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Recent Stripe events (${d.events.length})`} className="mt-3">
        {d.events.length === 0 ? (
          <p className="text-[13px] text-ink-500">No events processed yet. Webhook is wired but quiet.</p>
        ) : (
          <div className="rounded-lg border border-ink-100 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left bg-surface border-b border-ink-100">
                  <ColHead>Event</ColHead>
                  <ColHead>Type</ColHead>
                  <ColHead>When</ColHead>
                </tr>
              </thead>
              <tbody>
                {d.events.map((e, i) => (
                  <tr
                    key={e.event_id}
                    className={`hover:bg-hover transition-colors ${i < d.events.length - 1 ? "border-b border-ink-100" : ""}`}
                  >
                    <td className="py-2.5 px-3">
                      <a
                        className="font-mono text-[11.5px] text-ink hover:text-[rgb(255_140_140)] transition-colors truncate block max-w-[260px]"
                        href={`https://dashboard.stripe.com/events/${e.event_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {e.event_id}
                      </a>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[12px] text-ink-700">{e.type}</td>
                    <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500">
                      {new Date(e.processed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title, legend, children, className = "",
}: {
  title: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-ink-200 bg-paper p-4 sm:p-5 ${className}`}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {legend && <div className="flex items-center gap-3 text-[11.5px] text-ink-500">{legend}</div>}
      </div>
      {children}
    </section>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium py-2 px-3">
      {children}
    </th>
  );
}

function SkeletonBilling() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />
        ))}
      </div>
      <div className="h-56 rounded-xl bg-ink-100 animate-pulse" />
      <div className="h-40 rounded-xl bg-ink-100 animate-pulse" />
    </div>
  );
}

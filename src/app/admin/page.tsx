"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StackedBars, LegendDot } from "@/components/MiniChart";
import PageHeader from "@/components/app/PageHeader";
import KpiCard from "@/components/app/KpiCard";
import StatusPill from "@/components/app/StatusPill";

type AdminMetrics = {
  mrr_cents: number;
  paying_users: number;
  plan_counts: Record<string, number>;
  sends_24h: number;
  errors_24h: number;
  error_rate_24h: number;
  sends_7d: number;
  errors_7d: number;
  error_rate_7d: number;
  error_by_class_24h: Record<string, number>;
  signups_7d: number;
  signups_30d: number;
  paid_signups_30d: number;
  free_to_paid_30d: number;
  recent_signups: Array<{
    user_id: string;
    plan_id: string;
    status: string;
    created_at: string;
  }>;
};

type SeriesPoint = {
  day: string;
  sends: number;
  errors: number;
  signups_free: number;
  signups_paid: number;
  replies: number;
  interested: number;
};

const PLAN_TONE: Record<string, { dot: string; text: string; bg: string }> = {
  free:    { dot: "rgb(113 113 122)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  starter: { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  growth:  { dot: "rgb(255 99 99)",   text: "rgb(255 140 140)", bg: "rgb(255 99 99 / 0.10)" },
  scale:   { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
};

// Theme-aware chart colors. Replace the old cool-blue / red-600 with our
// warm gradient stops + signal green — keeps charts on-brand.
const CHART_COLORS = {
  sends:       "rgb(244 244 245)",
  errors:      "rgb(239 68 68)",
  free:        "rgb(113 113 122)",
  paid:        "rgb(255 99 99)",
  interested:  "rgb(16 185 129)",
  other:       "rgb(82 82 91)",
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const [m, s] = await Promise.all([
        fetch("/api/admin", { cache: "no-store" }).then(async (r) =>
          r.status === 401 ? { not_admin: true } : await r.json(),
        ),
        fetch("/api/admin/series?days=30", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if ((m as { not_admin?: boolean }).not_admin) {
        setErr("not_admin");
        return;
      }
      setData(m as AdminMetrics);
      setSeries((s as { series: SeriesPoint[] }).series);
    } catch {
      setErr("fetch_failed");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (err === "not_admin") {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Operator"
          title="Overview"
          subtitle={
            <>
              Your account isn&rsquo;t in <code className="font-mono text-ink bg-surface border border-ink-200 px-1.5 py-0.5 rounded text-[12px]">ADMIN_USER_IDS</code>.
            </>
          }
        />
      </div>
    );
  }
  if (err) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Operator"
          title="Overview"
          subtitle={<span className="text-[rgb(255_140_140)]">Failed to load: {err}</span>}
        />
      </div>
    );
  }

  const send30dTotal   = series?.reduce((s, p) => s + p.sends, 0) ?? 0;
  const err30dTotal    = series?.reduce((s, p) => s + p.errors, 0) ?? 0;
  const reply30dTotal  = series?.reduce((s, p) => s + p.replies, 0) ?? 0;
  const signup30dTotal = series?.reduce((s, p) => s + p.signups_free + p.signups_paid, 0) ?? 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title={<>Overview <span className="text-ink-500 font-normal">·</span> <span className="text-ink-500 font-normal">all tenants</span></>}
        subtitle="Cross-tenant numbers. Live, no caching."
        actions={
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="btn-ghost text-[13px]"
          >
            {refreshing ? <Spinner /> : <RefreshIcon />}
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />

      {!data || !series ? (
        <SkeletonOverview />
      ) : (
        <div className="space-y-6">
          {/* Top-line KPIs */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="MRR"
              value={`$${(data.mrr_cents / 100).toLocaleString()}`}
              tone="hot"
            />
            <KpiCard
              label="Paying users"
              value={data.paying_users.toLocaleString()}
            />
            <KpiCard
              label="Sends · 24h"
              value={data.sends_24h.toLocaleString()}
            />
            <KpiCard
              label="Error rate · 24h"
              value={`${(data.error_rate_24h * 100).toFixed(1)}%`}
              tone={data.error_rate_24h > 0.05 ? "hot" : "default"}
            />
          </section>

          {/* 30-day sends chart */}
          <Panel
            title="Sends · last 30 days"
            legend={
              <>
                <LegendDot color={CHART_COLORS.sends}  label={`Sent (${send30dTotal.toLocaleString()})`} />
                <LegendDot color={CHART_COLORS.errors} label={`Errors (${err30dTotal.toLocaleString()})`} />
              </>
            }
          >
            <StackedBars
              data={series.map((p) => ({
                day: p.day,
                values: { sends: p.sends, errors: p.errors },
              }))}
              keys={["sends", "errors"]}
              colors={{ sends: CHART_COLORS.sends, errors: CHART_COLORS.errors }}
            />
            <DayAxis days={series.map((p) => p.day)} />
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Signups */}
            <Panel
              title="Signups · last 30 days"
              legend={
                <>
                  <LegendDot color={CHART_COLORS.free} label="Free" />
                  <LegendDot color={CHART_COLORS.paid} label="Paid" />
                </>
              }
              footer={
                <>
                  {signup30dTotal.toLocaleString()} signups ·{" "}
                  <span className="text-ink font-mono">{(data.free_to_paid_30d * 100).toFixed(1)}%</span> paid
                </>
              }
            >
              <StackedBars
                data={series.map((p) => ({
                  day: p.day,
                  values: { paid: p.signups_paid, free: p.signups_free },
                }))}
                keys={["paid", "free"]}
                colors={{ free: CHART_COLORS.free, paid: CHART_COLORS.paid }}
                height={120}
              />
            </Panel>

            {/* Replies */}
            <Panel
              title="Replies · last 30 days"
              legend={
                <>
                  <LegendDot color={CHART_COLORS.other}      label="All replies" />
                  <LegendDot color={CHART_COLORS.interested} label="Interested" />
                </>
              }
              footer={`${reply30dTotal.toLocaleString()} replies in window`}
            >
              <StackedBars
                data={series.map((p) => ({
                  day: p.day,
                  values: {
                    interested: p.interested,
                    other: Math.max(0, p.replies - p.interested),
                  },
                }))}
                keys={["interested", "other"]}
                colors={{ interested: CHART_COLORS.interested, other: CHART_COLORS.other }}
                height={120}
              />
            </Panel>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Plan distribution */}
            <Panel title="Plan distribution">
              <PlanBars counts={data.plan_counts} />
            </Panel>

            {/* Errors by class */}
            <Panel title="Errors by class · 24h">
              {Object.keys(data.error_by_class_24h).length === 0 ? (
                <div className="flex items-center gap-2 py-1 text-[13px] text-[rgb(110_231_183)]">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: "rgb(16 185 129)", boxShadow: "0 0 8px rgb(16 185 129 / 0.5)" }}
                  />
                  No errors in the last 24h.
                </div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(data.error_by_class_24h)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([cls, count]) => (
                      <div
                        key={cls}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-hover transition-colors"
                      >
                        <code className="font-mono text-[12.5px] text-ink-700">{cls}</code>
                        <span className="font-mono text-[13px] text-ink tabular-nums">
                          {count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Recent signups */}
          <Panel title="Recent signups">
            {data.recent_signups.length === 0 ? (
              <p className="text-[13px] text-ink-500">No signups yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left">
                      <ColHead>User</ColHead>
                      <ColHead>Plan</ColHead>
                      <ColHead>Status</ColHead>
                      <ColHead className="text-right">When</ColHead>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_signups.map((s) => {
                      const tone = PLAN_TONE[s.plan_id] ?? PLAN_TONE.free;
                      return (
                        <tr key={s.user_id} className="border-t border-ink-100 hover:bg-hover transition-colors">
                          <td className="py-2 px-2">
                            <Link
                              href={`/admin/users/${s.user_id}`}
                              className="font-mono text-[11.5px] text-ink-600 hover:text-ink truncate block max-w-[280px]"
                            >
                              {s.user_id}
                            </Link>
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: tone.bg, color: tone.text }}
                            >
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                              {s.plan_id}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <StatusPill status={s.status} />
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-[11.5px] text-ink-500">
                            {relative(s.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* 7-day secondary KPIs */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Sends · 7d"    value={data.sends_7d.toLocaleString()} />
            <KpiCard label="Errors · 7d"   value={data.errors_7d.toLocaleString()} tone={data.errors_7d > 0 ? "hot" : "default"} />
            <KpiCard label="Signups · 7d"  value={data.signups_7d.toLocaleString()} />
            <KpiCard
              label="Free → paid · 30d"
              value={`${(data.free_to_paid_30d * 100).toFixed(1)}`}
              unit="%"
              tone="hot"
            />
          </section>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function Panel({
  title,
  legend,
  footer,
  children,
}: {
  title: string;
  legend?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink-200 bg-paper p-4 sm:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {legend && <div className="flex items-center gap-3 text-[11.5px] text-ink-500">{legend}</div>}
      </div>
      {children}
      {footer && (
        <p className="mt-3 text-[12px] text-ink-500">{footer}</p>
      )}
    </section>
  );
}

function ColHead({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium pb-2 px-2 ${className}`}>
      {children}
    </th>
  );
}

function DayAxis({ days }: { days: string[] }) {
  if (days.length === 0) return null;
  const first = days[0];
  const mid = days[Math.floor(days.length / 2)];
  const last = days[days.length - 1];
  return (
    <div className="flex justify-between mt-1.5 text-[10.5px] text-ink-500 font-mono">
      <span>{first.slice(5)}</span>
      <span>{mid.slice(5)}</span>
      <span>{last.slice(5)}</span>
    </div>
  );
}

function PlanBars({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const order = ["free", "starter", "growth", "scale"];
  return (
    <div className="space-y-3">
      {order.map((p) => {
        const c = counts[p] ?? 0;
        const pct = (c / total) * 100;
        const tone = PLAN_TONE[p] ?? PLAN_TONE.free;
        return (
          <div key={p}>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span className="inline-flex items-center gap-2 capitalize text-ink">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                {p}
              </span>
              <span className="font-mono text-ink-500 tabular-nums">
                {c.toLocaleString()} <span className="text-ink-400">· {pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: tone.dot }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SkeletonOverview() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-ink-100 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="h-44 rounded-xl bg-ink-100 animate-pulse" />
        <div className="h-44 rounded-xl bg-ink-100 animate-pulse" />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.5 6.3L3 16M3 20v-4h4" />
    </svg>
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

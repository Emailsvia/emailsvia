"use client";

import { useEffect, useState } from "react";
import { StackedBars, LegendDot } from "@/components/MiniChart";

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

const PLAN_COLORS: Record<string, string> = {
  free: "#94a3b8",
  starter: "#60a5fa",
  growth: "#34d399",
  scale: "#a78bfa",
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin", { cache: "no-store" }).then(async (r) =>
        r.status === 401 ? { not_admin: true } : await r.json(),
      ),
      fetch("/api/admin/series?days=30", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([m, s]) => {
        if ((m as { not_admin?: boolean }).not_admin) {
          setErr("not_admin");
          return;
        }
        setData(m);
        setSeries(s.series);
      })
      .catch(() => setErr("fetch_failed"));
  }, []);

  if (err === "not_admin") {
    return (
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">Overview</h1>
        <p className="text-[13px] text-ink-500 mt-2">
          Your account isn&apos;t in <code>ADMIN_USER_IDS</code>.
        </p>
      </div>
    );
  }
  if (err) {
    return (
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">Overview</h1>
        <p className="text-[13px] text-red-600 mt-2">Failed to load: {err}</p>
      </div>
    );
  }

  const send30dTotal = series?.reduce((s, p) => s + p.sends, 0) ?? 0;
  const err30dTotal = series?.reduce((s, p) => s + p.errors, 0) ?? 0;
  const reply30dTotal = series?.reduce((s, p) => s + p.replies, 0) ?? 0;
  const signup30dTotal =
    series?.reduce((s, p) => s + p.signups_free + p.signups_paid, 0) ?? 0;

  return (
    <div className="page-narrow">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Overview</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            Operator-side numbers. Everything live across all tenants.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-quiet text-[12px]"
        >
          Refresh
        </button>
      </div>

      {!data || !series ? (
        <p className="text-[13px] text-ink-500 mt-6">Loading…</p>
      ) : (
        <div className="space-y-6 mt-6">
          {/* Top-line stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="MRR" value={`$${(data.mrr_cents / 100).toLocaleString()}`} />
            <Stat label="Paying users" value={data.paying_users.toLocaleString()} />
            <Stat label="Sends · 24h" value={data.sends_24h.toLocaleString()} />
            <Stat
              label="Error rate · 24h"
              value={`${(data.error_rate_24h * 100).toFixed(1)}%`}
              tone={data.error_rate_24h > 0.05 ? "warn" : undefined}
            />
          </div>

          {/* 30-day sends chart */}
          <div className="sheet p-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="text-[14px] font-semibold">Sends · last 30 days</h2>
              <div className="flex items-center gap-3">
                <LegendDot color="#1a1a1a" label={`Sent (${send30dTotal.toLocaleString()})`} />
                <LegendDot color="#dc2626" label={`Errors (${err30dTotal.toLocaleString()})`} />
              </div>
            </div>
            <div className="mt-3">
              <StackedBars
                data={series.map((p) => ({
                  day: p.day,
                  values: { sends: p.sends, errors: p.errors },
                }))}
                keys={["sends", "errors"]}
                colors={{ sends: "#1a1a1a", errors: "#dc2626" }}
              />
              <DayAxis days={series.map((p) => p.day)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Signups */}
            <div className="sheet p-4">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="text-[14px] font-semibold">Signups · last 30 days</h2>
                <div className="flex items-center gap-3">
                  <LegendDot color="#94a3b8" label="Free" />
                  <LegendDot color="#34d399" label="Paid" />
                </div>
              </div>
              <div className="mt-3">
                <StackedBars
                  data={series.map((p) => ({
                    day: p.day,
                    values: { paid: p.signups_paid, free: p.signups_free },
                  }))}
                  keys={["paid", "free"]}
                  colors={{ free: "#94a3b8", paid: "#34d399" }}
                  height={120}
                />
              </div>
              <p className="mt-2 text-[12px] text-ink-500">
                {signup30dTotal.toLocaleString()} signups · {(data.free_to_paid_30d * 100).toFixed(1)}% paid
              </p>
            </div>

            {/* Replies */}
            <div className="sheet p-4">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="text-[14px] font-semibold">Replies · last 30 days</h2>
                <div className="flex items-center gap-3">
                  <LegendDot color="#475569" label="All replies" />
                  <LegendDot color="#34d399" label="Interested" />
                </div>
              </div>
              <div className="mt-3">
                <StackedBars
                  data={series.map((p) => ({
                    day: p.day,
                    values: {
                      interested: p.interested,
                      other: Math.max(0, p.replies - p.interested),
                    },
                  }))}
                  keys={["interested", "other"]}
                  colors={{ interested: "#34d399", other: "#475569" }}
                  height={120}
                />
              </div>
              <p className="mt-2 text-[12px] text-ink-500">
                {reply30dTotal.toLocaleString()} replies in window
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Plan distribution as horizontal bars */}
            <div className="sheet p-4">
              <h2 className="text-[14px] font-semibold mb-3">Plan distribution</h2>
              <PlanBars counts={data.plan_counts} />
            </div>

            {/* Errors by class — sparkline-light table */}
            <div className="sheet p-4">
              <h2 className="text-[14px] font-semibold mb-3">Errors by class · 24h</h2>
              {Object.keys(data.error_by_class_24h).length === 0 ? (
                <p className="text-[13px] text-ink-500">No errors in the last 24h.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {Object.entries(data.error_by_class_24h)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([cls, count]) => (
                        <tr key={cls} className="border-b border-ink-100 last:border-0">
                          <td className="py-1.5 font-mono text-[12px]">{cls}</td>
                          <td className="py-1.5 text-right font-mono">{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent signups */}
          <div className="sheet p-4">
            <h2 className="text-[14px] font-semibold mb-3">Recent signups</h2>
            {data.recent_signups.length === 0 ? (
              <p className="text-[13px] text-ink-500">No signups yet.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[12px] text-ink-500 text-left">
                    <th className="py-1.5 font-medium">User</th>
                    <th className="py-1.5 font-medium">Plan</th>
                    <th className="py-1.5 font-medium">Status</th>
                    <th className="py-1.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_signups.map((s) => (
                    <tr key={s.user_id} className="border-b border-ink-100 last:border-0">
                      <td className="py-1.5 font-mono text-[11px] truncate max-w-[260px]">
                        <a
                          href={`/admin/users/${s.user_id}`}
                          className="hover:underline"
                        >
                          {s.user_id}
                        </a>
                      </td>
                      <td className="py-1.5 capitalize">{s.plan_id}</td>
                      <td className="py-1.5 capitalize">{s.status}</td>
                      <td className="py-1.5 text-ink-500">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Sends · 7d" value={data.sends_7d.toLocaleString()} />
            <Stat label="Errors · 7d" value={data.errors_7d.toLocaleString()} />
            <Stat label="Signups · 7d" value={data.signups_7d.toLocaleString()} />
            <Stat
              label="Free → paid · 30d"
              value={`${(data.free_to_paid_30d * 100).toFixed(1)}%`}
            />
          </div>
        </div>
      )}
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
          "text-[22px] font-bold mt-1 " + (tone === "warn" ? "text-red-600" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}

function DayAxis({ days }: { days: string[] }) {
  if (days.length === 0) return null;
  const first = days[0];
  const mid = days[Math.floor(days.length / 2)];
  const last = days[days.length - 1];
  return (
    <div className="flex justify-between mt-1 text-[10px] text-ink-500 font-mono">
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
    <div className="space-y-2">
      {order.map((p) => {
        const c = counts[p] ?? 0;
        const pct = (c / total) * 100;
        return (
          <div key={p}>
            <div className="flex items-center justify-between text-[12px] text-ink-500">
              <span className="capitalize">{p}</span>
              <span className="font-mono">{c.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 h-1.5 bg-ink-100 rounded-sm overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: `${pct}%`,
                  background: PLAN_COLORS[p],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

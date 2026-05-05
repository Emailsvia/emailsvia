"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

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

export default function AdminPage() {
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          setErr("not_admin");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setErr("fetch_failed"));
  }, []);

  if (err === "not_admin") {
    return (
      <AppShell>
        <div className="page-narrow">
          <h1 className="text-[28px] font-bold tracking-tight">Admin</h1>
          <p className="text-[13px] text-ink-500 mt-2">
            Your account isn't in <code>ADMIN_USER_IDS</code>. Add your user id there to
            unlock this page.
          </p>
        </div>
      </AppShell>
    );
  }

  if (err) {
    return (
      <AppShell>
        <div className="page-narrow">
          <h1 className="text-[28px] font-bold tracking-tight">Admin</h1>
          <p className="text-[13px] text-red-600 mt-2">Failed to load: {err}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">Admin</h1>
        <p className="text-[13px] text-ink-500 mt-1 mb-6">
          Operator-side numbers. Refresh manually for live values.
        </p>

        {!data ? (
          <p className="text-[13px] text-ink-500">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="MRR" value={`$${(data.mrr_cents / 100).toLocaleString()}`} />
              <Stat label="Paying users" value={data.paying_users.toLocaleString()} />
              <Stat label="Sends · 24h" value={data.sends_24h.toLocaleString()} />
              <Stat
                label="Error rate · 24h"
                value={`${(data.error_rate_24h * 100).toFixed(1)}%`}
                tone={data.error_rate_24h > 0.05 ? "warn" : undefined}
              />
              <Stat label="Sends · 7d" value={data.sends_7d.toLocaleString()} />
              <Stat label="Errors · 7d" value={data.errors_7d.toLocaleString()} />
              <Stat label="Signups · 7d" value={data.signups_7d.toLocaleString()} />
              <Stat
                label="Free → paid · 30d"
                value={`${(data.free_to_paid_30d * 100).toFixed(1)}%`}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="sheet p-4">
                <h2 className="text-[14px] font-semibold mb-3">Plan distribution</h2>
                <table className="w-full text-[13px]">
                  <tbody>
                    {Object.entries(data.plan_counts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([plan, count]) => (
                        <tr key={plan} className="border-b border-ink-100 last:border-0">
                          <td className="py-1.5 capitalize">{plan}</td>
                          <td className="py-1.5 text-right font-mono">{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="sheet p-4">
                <h2 className="text-[14px] font-semibold mb-3">Errors by class · 24h</h2>
                {Object.keys(data.error_by_class_24h).length === 0 ? (
                  <p className="text-[13px] text-ink-500">No errors in the last 24h.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <tbody>
                      {Object.entries(data.error_by_class_24h)
                        .sort((a, b) => b[1] - a[1])
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
                          {s.user_id}
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
          </div>
        )}
      </div>
    </AppShell>
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AdminUser = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  plan_id: string;
  status: string;
  suspended_at: string | null;
  mrr_cents: number;
  sends_30d: number;
  errors_30d: number;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<"" | "free" | "starter" | "growth" | "scale">("");
  const [status, setStatus] = useState<"" | "active" | "suspended">("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (plan) params.set("plan", plan);
    if (status) params.set("status", status);
    fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUsers(d.users))
      .catch(() => setErr("fetch_failed"));
  }, [q, plan, status]);

  const totalMrr = useMemo(() => {
    return (users ?? []).reduce((s, u) => s + u.mrr_cents, 0);
  }, [users]);

  function exportCsv() {
    if (!users) return;
    const cols = [
      "id",
      "email",
      "plan",
      "status",
      "suspended",
      "mrr_cents",
      "sends_30d",
      "errors_30d",
      "created_at",
      "last_sign_in_at",
    ];
    const rows = users.map((u) =>
      [
        u.id,
        u.email ?? "",
        u.plan_id,
        u.status,
        u.suspended_at ? "yes" : "no",
        String(u.mrr_cents),
        String(u.sends_30d),
        String(u.errors_30d),
        u.created_at,
        u.last_sign_in_at ?? "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `emailsvia-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="page-narrow">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Users</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            Every signed-up tenant. Filter, search, and click a row for details.
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
          placeholder="search email or id…"
          className="field-boxed flex-1 min-w-[200px]"
        />
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as typeof plan)}
          className="field-boxed"
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="scale">Scale</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="field-boxed"
        >
          <option value="">Active + suspended</option>
          <option value="active">Active only</option>
          <option value="suspended">Suspended only</option>
        </select>
      </div>

      <div className="mt-3 text-[12px] text-ink-500">
        {users ? (
          <>
            {users.length.toLocaleString()} users · MRR in view: $
            {(totalMrr / 100).toLocaleString()}
          </>
        ) : (
          "Loading…"
        )}
      </div>

      {err && <p className="text-[13px] text-red-600 mt-3">{err}</p>}

      <div className="sheet mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-ink-500 text-left bg-paper">
              <th className="py-2 px-3 font-medium">Email</th>
              <th className="py-2 px-3 font-medium">Plan</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium text-right">MRR</th>
              <th className="py-2 px-3 font-medium text-right">Sends 30d</th>
              <th className="py-2 px-3 font-medium text-right">Errors 30d</th>
              <th className="py-2 px-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr
                key={u.id}
                className="border-t border-ink-100 hover:bg-paper/50 cursor-pointer"
                onClick={() => (window.location.href = `/admin/users/${u.id}`)}
              >
                <td className="py-1.5 px-3">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {u.email ?? <span className="text-ink-500 font-mono">{u.id.slice(0, 8)}…</span>}
                  </Link>
                </td>
                <td className="py-1.5 px-3 capitalize">{u.plan_id}</td>
                <td className="py-1.5 px-3">
                  {u.suspended_at ? (
                    <span className="text-red-700">suspended</span>
                  ) : (
                    <span className="capitalize">{u.status}</span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  ${(u.mrr_cents / 100).toLocaleString()}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">{u.sends_30d.toLocaleString()}</td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {u.errors_30d > 0 ? (
                    <span className="text-red-700">{u.errors_30d.toLocaleString()}</span>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="py-1.5 px-3 text-ink-500">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users && users.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-500">No matches.</p>
        )}
      </div>
    </div>
  );
}

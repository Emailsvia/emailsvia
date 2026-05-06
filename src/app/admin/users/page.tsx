"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import StatusPill from "@/components/app/StatusPill";

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

const PLAN_TONE: Record<string, { dot: string; text: string; bg: string }> = {
  free:    { dot: "rgb(113 113 122)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  starter: { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  growth:  { dot: "rgb(255 99 99)",   text: "rgb(255 140 140)", bg: "rgb(255 99 99 / 0.10)" },
  scale:   { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
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

  const totalMrr = useMemo(() => (users ?? []).reduce((s, u) => s + u.mrr_cents, 0), [users]);

  function exportCsv() {
    if (!users) return;
    const cols = ["id", "email", "plan", "status", "suspended", "mrr_cents", "sends_30d", "errors_30d", "created_at", "last_sign_in_at"];
    const rows = users.map((u) =>
      [u.id, u.email ?? "", u.plan_id, u.status, u.suspended_at ? "yes" : "no", String(u.mrr_cents), String(u.sends_30d), String(u.errors_30d), u.created_at, u.last_sign_in_at ?? ""]
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
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Users"
        subtitle="Every signed-up tenant. Filter, search, and click a row for details."
        actions={
          <button type="button" onClick={exportCsv} className="btn-quiet text-[13px]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export CSV
          </button>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search email or id…"
            className="w-full bg-surface border border-ink-200 rounded-md pl-8 pr-3 py-1.5 text-[13px] text-ink placeholder:text-ink-400 outline-none focus:border-ink-300 transition-colors"
          />
        </div>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as typeof plan)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
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
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value="">Active + suspended</option>
          <option value="active">Active only</option>
          <option value="suspended">Suspended only</option>
        </select>
      </div>

      <div className="font-mono text-[11.5px] text-ink-500 mb-3">
        {users ? (
          <>
            {users.length.toLocaleString()} users <span className="text-ink-400">·</span>{" "}
            MRR in view: <span className="text-ink">${(totalMrr / 100).toLocaleString()}</span>
          </>
        ) : (
          "Loading…"
        )}
      </div>

      {err && (
        <div
          className="mb-3 px-3 py-2 rounded-lg text-[13px] border"
          style={{
            borderColor: "rgb(255 99 99 / 0.30)",
            background: "rgb(255 99 99 / 0.06)",
            color: "rgb(255 140 140)",
          }}
        >
          Couldn&rsquo;t load: {err}
        </div>
      )}

      {users === null ? (
        <SkeletonTable />
      ) : (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left bg-surface border-b border-ink-200">
                <ColHead>Email</ColHead>
                <ColHead>Plan</ColHead>
                <ColHead>Status</ColHead>
                <ColHead className="text-right">MRR</ColHead>
                <ColHead className="text-right">Sends 30d</ColHead>
                <ColHead className="text-right">Errors 30d</ColHead>
                <ColHead>Joined</ColHead>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const tone = PLAN_TONE[u.plan_id] ?? PLAN_TONE.free;
                const suspended = Boolean(u.suspended_at);
                return (
                  <tr
                    key={u.id}
                    className={`hover:bg-hover transition-colors cursor-pointer ${
                      i < users.length - 1 ? "border-b border-ink-100" : ""
                    }`}
                    onClick={() => (window.location.href = `/admin/users/${u.id}`)}
                  >
                    <td className="py-2.5 px-3">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {u.email ?? (
                          <span className="text-ink-500 font-mono">{u.id.slice(0, 8)}…</span>
                        )}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: tone.bg, color: tone.text }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                        {u.plan_id}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusPill status={suspended ? "failed" : u.status} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-ink tabular-nums">
                      ${(u.mrr_cents / 100).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-ink-700 tabular-nums">
                      {u.sends_30d.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {u.errors_30d > 0 ? (
                        <span className="text-[rgb(252_165_165)]">{u.errors_30d.toLocaleString()}</span>
                      ) : (
                        <span className="text-ink-400">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500">
                      {new Date(u.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-500">No matches.</p>
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
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`grid grid-cols-7 gap-3 items-center px-3 py-2.5 ${
            i < 5 ? "border-b border-ink-100" : ""
          }`}
        >
          {Array.from({ length: 7 }).map((__, j) => (
            <div key={j} className="h-3 rounded bg-ink-100 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

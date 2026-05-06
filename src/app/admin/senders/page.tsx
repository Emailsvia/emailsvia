"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import StatusPill from "@/components/app/StatusPill";

type AdminSender = {
  id: string;
  user_id: string;
  label: string;
  email: string;
  auth_method: string;
  oauth_status: string;
  is_default: boolean;
  warmup_enabled: boolean;
  created_at: string;
  owner_email: string | null;
  sends_24h: number;
};

const OAUTH_TONE: Record<string, string> = {
  ok:      "ok",
  pending: "pending",
  revoked: "revoked",
};

export default function AdminSendersPage() {
  const [data, setData] = useState<AdminSender[] | null>(null);
  const [auth, setAuth] = useState<"" | "oauth" | "app_password">("");
  const [oauthStatus, setOauthStatus] = useState<"" | "ok" | "revoked" | "pending">("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/admin/senders", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d.senders));
  }, []);

  const filtered = (data ?? []).filter((s) => {
    if (auth && s.auth_method !== auth) return false;
    if (oauthStatus && s.oauth_status !== oauthStatus) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (
        !s.email.toLowerCase().includes(needle) &&
        !s.label.toLowerCase().includes(needle) &&
        !(s.owner_email ?? "").toLowerCase().includes(needle)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="Senders"
        subtitle="All connected sender accounts. Watch for revoked OAuth — campaigns silently die without it."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search email / label / owner"
            className="w-full bg-surface border border-ink-200 rounded-md pl-8 pr-3 py-1.5 text-[13px] text-ink placeholder:text-ink-400 outline-none focus:border-ink-300 transition-colors"
          />
        </div>
        <select
          value={auth}
          onChange={(e) => setAuth(e.target.value as typeof auth)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value="">All auth methods</option>
          <option value="oauth">OAuth</option>
          <option value="app_password">App password</option>
        </select>
        <select
          value={oauthStatus}
          onChange={(e) => setOauthStatus(e.target.value as typeof oauthStatus)}
          className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
        >
          <option value="">All OAuth states</option>
          <option value="ok">OK</option>
          <option value="revoked">Revoked</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="font-mono text-[11.5px] text-ink-500 mb-3">
        {data ? `${filtered.length.toLocaleString()} senders` : "Loading…"}
      </div>

      {data === null ? (
        <SkeletonTable />
      ) : (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left bg-surface border-b border-ink-200">
                <ColHead>Owner</ColHead>
                <ColHead>Sender</ColHead>
                <ColHead>Auth</ColHead>
                <ColHead>OAuth</ColHead>
                <ColHead className="text-right">Sends · 24h</ColHead>
                <ColHead>Connected</ColHead>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr
                  key={s.id}
                  className={`hover:bg-hover transition-colors ${i < filtered.length - 1 ? "border-b border-ink-100" : ""}`}
                >
                  <td className="py-2.5 px-3">
                    <Link
                      href={`/admin/users/${s.user_id}`}
                      className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                    >
                      {s.owner_email ?? <span className="font-mono text-[11.5px] text-ink-500">{s.user_id.slice(0, 8)}</span>}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="text-ink font-medium truncate max-w-[260px]">{s.label}</div>
                    <div className="font-mono text-[11.5px] text-ink-500 truncate max-w-[260px]">{s.email}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-mono text-[11.5px] uppercase tracking-wider text-ink-700">
                      {s.auth_method}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {s.auth_method === "oauth" ? (
                      <StatusPill status={OAUTH_TONE[s.oauth_status] ?? "draft"} />
                    ) : (
                      <span className="text-ink-400 font-mono text-[11.5px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink tabular-nums">
                    {s.sends_24h.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11.5px] text-ink-500">
                    {new Date(s.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-500">No senders match.</p>
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
          className={`grid grid-cols-6 gap-3 items-center px-3 py-2.5 ${i < 5 ? "border-b border-ink-100" : ""}`}
        >
          {Array.from({ length: 6 }).map((__, j) => (
            <div key={j} className="h-3 rounded bg-ink-100 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

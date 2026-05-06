"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
    <div className="page-narrow">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Senders</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            All connected sender accounts. Watch for revoked OAuth.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search email / label / owner"
          className="field-boxed flex-1 min-w-[200px]"
        />
        <select
          value={auth}
          onChange={(e) => setAuth(e.target.value as typeof auth)}
          className="field-boxed"
        >
          <option value="">All auth methods</option>
          <option value="oauth">OAuth</option>
          <option value="app_password">App password</option>
        </select>
        <select
          value={oauthStatus}
          onChange={(e) => setOauthStatus(e.target.value as typeof oauthStatus)}
          className="field-boxed"
        >
          <option value="">All OAuth states</option>
          <option value="ok">OK</option>
          <option value="revoked">Revoked</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="mt-3 text-[12px] text-ink-500">
        {data ? `${filtered.length.toLocaleString()} senders` : "Loading…"}
      </div>

      <div className="sheet mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-ink-500 text-left bg-paper">
              <th className="py-2 px-3 font-medium">Owner</th>
              <th className="py-2 px-3 font-medium">Sender</th>
              <th className="py-2 px-3 font-medium">Auth</th>
              <th className="py-2 px-3 font-medium">OAuth</th>
              <th className="py-2 px-3 font-medium text-right">Sends · 24h</th>
              <th className="py-2 px-3 font-medium">Connected</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-t border-ink-100">
                <td className="py-1.5 px-3">
                  <Link
                    href={`/admin/users/${s.user_id}`}
                    className="hover:underline"
                  >
                    {s.owner_email ?? (
                      <span className="font-mono text-[11px]">
                        {s.user_id.slice(0, 8)}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="py-1.5 px-3">
                  <div className="truncate max-w-[260px]">
                    <span className="font-medium">{s.label}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 truncate max-w-[260px]">
                    {s.email}
                  </div>
                </td>
                <td className="py-1.5 px-3 capitalize">{s.auth_method}</td>
                <td className="py-1.5 px-3">
                  {s.auth_method === "oauth" ? (
                    <span
                      className={
                        s.oauth_status === "ok"
                          ? "text-emerald-700"
                          : s.oauth_status === "pending"
                            ? "text-amber-700"
                            : "text-red-700"
                      }
                    >
                      {s.oauth_status}
                    </span>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {s.sends_24h.toLocaleString()}
                </td>
                <td className="py-1.5 px-3 text-[11px] text-ink-500">
                  {new Date(s.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && filtered.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-500">No senders.</p>
        )}
      </div>
    </div>
  );
}

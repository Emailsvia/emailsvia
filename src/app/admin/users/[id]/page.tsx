"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { StackedBars, LegendDot } from "@/components/MiniChart";

type Detail = {
  user: {
    id: string;
    email: string | null;
    created_at: string;
    last_sign_in_at: string | null;
    provider: string | null;
  };
  subscription: {
    plan_id: string;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    suspended_at: string | null;
    stripe_customer_id: string | null;
    stripe_sub_id: string | null;
  } | null;
  series: Array<{ day: string; sends: number; errors: number }>;
  counts: { senders: number; campaigns: number; replies: number };
  recent_campaigns: Array<{
    id: string;
    name: string;
    status: string;
    created_at: string;
  }>;
  senders: Array<{
    id: string;
    label: string;
    email: string;
    auth_method: string;
    oauth_status: string;
    is_default: boolean;
  }>;
  audit: Array<{
    id: number;
    action: string;
    payload: unknown;
    actor_id: string;
    created_at: string;
  }>;
};

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetch(`/api/admin/users/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setMsg(data.error);
        else setD(data);
      });
  }

  useEffect(load, [id]);

  async function changePlan(plan: string) {
    if (!confirm(`Force-change plan to ${plan}? This bypasses Stripe.`)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/users/${id}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg("Plan change failed");
      return;
    }
    setMsg(`Plan set to ${plan}`);
    load();
  }

  async function toggleSuspend() {
    if (!d?.subscription) return;
    const want = !d.subscription.suspended_at;
    if (!confirm(want ? "Suspend this user?" : "Un-suspend this user?")) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/users/${id}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspend: want }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg("Suspend toggle failed");
      return;
    }
    setMsg(want ? "User suspended" : "User unsuspended");
    load();
  }

  if (!d) {
    return (
      <div className="page-narrow">
        <Link href="/admin/users" className="text-[12px] text-ink-500 hover:text-ink">
          ← Back to users
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight mt-2">User</h1>
        <p className="text-[13px] text-ink-500 mt-2">Loading…</p>
      </div>
    );
  }

  const send30 = d.series.reduce((s, p) => s + p.sends, 0);
  const err30 = d.series.reduce((s, p) => s + p.errors, 0);

  return (
    <div className="page-narrow">
      <Link href="/admin/users" className="text-[12px] text-ink-500 hover:text-ink">
        ← Back to users
      </Link>
      <div className="mt-2 flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">
            {d.user.email ?? d.user.id}
          </h1>
          <p className="text-[12px] text-ink-500 font-mono mt-1">{d.user.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            disabled={busy}
            value={d.subscription?.plan_id ?? "free"}
            onChange={(e) => changePlan(e.target.value)}
            className="field-boxed text-[13px]"
          >
            <option value="free">Force: Free</option>
            <option value="starter">Force: Starter</option>
            <option value="growth">Force: Growth</option>
            <option value="scale">Force: Scale</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={toggleSuspend}
            className={
              d.subscription?.suspended_at
                ? "btn-quiet text-[13px]"
                : "btn-quiet text-[13px] text-red-700"
            }
          >
            {d.subscription?.suspended_at ? "Un-suspend" : "Suspend"}
          </button>
        </div>
      </div>

      {msg && <p className="text-[13px] text-ink-500 mt-3">{msg}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <Stat label="Plan" value={(d.subscription?.plan_id ?? "free").toUpperCase()} />
        <Stat
          label="Status"
          value={
            d.subscription?.suspended_at
              ? "SUSPENDED"
              : (d.subscription?.status ?? "active").toUpperCase()
          }
          tone={d.subscription?.suspended_at ? "warn" : undefined}
        />
        <Stat label="Sends · 30d" value={send30.toLocaleString()} />
        <Stat
          label="Errors · 30d"
          value={err30.toLocaleString()}
          tone={err30 > 0 ? "warn" : undefined}
        />
      </div>

      <div className="sheet p-4 mt-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-[14px] font-semibold">Sends · last 30 days</h2>
          <div className="flex items-center gap-3">
            <LegendDot color="#1a1a1a" label="Sent" />
            <LegendDot color="#dc2626" label="Errors" />
          </div>
        </div>
        <div className="mt-3">
          <StackedBars
            data={d.series.map((p) => ({
              day: p.day,
              values: { sends: p.sends, errors: p.errors },
            }))}
            keys={["sends", "errors"]}
            colors={{ sends: "#1a1a1a", errors: "#dc2626" }}
            height={120}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="sheet p-4">
          <h2 className="text-[14px] font-semibold mb-3">Account</h2>
          <KV label="Email" value={d.user.email ?? "—"} />
          <KV label="Provider" value={d.user.provider ?? "email"} />
          <KV label="Joined" value={new Date(d.user.created_at).toLocaleString()} />
          <KV
            label="Last sign-in"
            value={
              d.user.last_sign_in_at
                ? new Date(d.user.last_sign_in_at).toLocaleString()
                : "never"
            }
          />
          <KV
            label="Stripe customer"
            value={
              d.subscription?.stripe_customer_id ? (
                <a
                  className="hover:underline font-mono text-[12px]"
                  href={`https://dashboard.stripe.com/customers/${d.subscription.stripe_customer_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.subscription.stripe_customer_id}
                </a>
              ) : (
                "—"
              )
            }
          />
          <KV
            label="Period end"
            value={
              d.subscription?.current_period_end
                ? new Date(d.subscription.current_period_end).toLocaleString()
                : "—"
            }
          />
        </div>

        <div className="sheet p-4">
          <h2 className="text-[14px] font-semibold mb-3">Senders ({d.counts.senders})</h2>
          {d.senders.length === 0 ? (
            <p className="text-[13px] text-ink-500">No senders connected.</p>
          ) : (
            <ul className="text-[13px] space-y-1.5">
              {d.senders.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span className="truncate">
                    <span className="font-medium">{s.label}</span>{" "}
                    <span className="text-ink-500">· {s.email}</span>
                  </span>
                  <span className="text-[11px] text-ink-500 ml-3">
                    {s.auth_method}
                    {s.oauth_status !== "ok" ? (
                      <span className="text-red-700"> · {s.oauth_status}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">
          Recent campaigns ({d.counts.campaigns})
        </h2>
        {d.recent_campaigns.length === 0 ? (
          <p className="text-[13px] text-ink-500">No campaigns yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {d.recent_campaigns.map((c) => (
                <tr key={c.id} className="border-b border-ink-100 last:border-0">
                  <td className="py-1.5">
                    <span className="font-medium">{c.name}</span>
                  </td>
                  <td className="py-1.5 capitalize text-ink-500">{c.status}</td>
                  <td className="py-1.5 text-right text-[11px] text-ink-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">Operator audit log</h2>
        {d.audit.length === 0 ? (
          <p className="text-[13px] text-ink-500">No operator actions on this user yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {d.audit.map((a) => (
                <tr key={a.id} className="border-b border-ink-100 last:border-0">
                  <td className="py-1.5 font-mono text-[12px]">{a.action}</td>
                  <td className="py-1.5 text-ink-500 text-[11px] truncate max-w-[400px]">
                    {a.payload ? JSON.stringify(a.payload) : ""}
                  </td>
                  <td className="py-1.5 text-right text-[11px] text-ink-500">
                    {new Date(a.created_at).toLocaleString()}
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
          "text-[18px] font-bold mt-1 " + (tone === "warn" ? "text-red-600" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-ink-100 last:border-0">
      <span className="text-[12px] text-ink-500">{label}</span>
      <span className="text-[13px] text-right">{value}</span>
    </div>
  );
}

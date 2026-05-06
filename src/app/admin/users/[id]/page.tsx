"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { StackedBars, LegendDot } from "@/components/MiniChart";
import PageHeader from "@/components/app/PageHeader";
import KpiCard from "@/components/app/KpiCard";
import StatusPill from "@/components/app/StatusPill";

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

const CHART = {
  sends:  "rgb(244 244 245)",
  errors: "rgb(239 68 68)",
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
      <div className="page">
        <BackLink />
        <div className="space-y-4 mt-4">
          <div className="h-8 w-1/2 rounded bg-ink-100 animate-pulse" />
          <div className="h-3 w-1/3 rounded bg-ink-100 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-ink-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const send30     = d.series.reduce((s, p) => s + p.sends, 0);
  const err30      = d.series.reduce((s, p) => s + p.errors, 0);
  const planId     = d.subscription?.plan_id ?? "free";
  const suspended  = Boolean(d.subscription?.suspended_at);
  const subStatus  = suspended ? "failed" : (d.subscription?.status ?? "active");

  return (
    <div className="page">
      <BackLink />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={subStatus} />
            <span className="text-ink-500 normal-case font-sans tracking-normal">
              Plan <span className="text-ink m-mono">{planId}</span>
            </span>
          </span>
        }
        title={d.user.email ?? "Unknown user"}
        subtitle={
          <span className="font-mono text-ink-500">{d.user.id}</span>
        }
        actions={
          <>
            <select
              disabled={busy}
              value={planId}
              onChange={(e) => changePlan(e.target.value)}
              className="bg-surface border border-ink-200 rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-300 cursor-pointer"
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
                suspended
                  ? "btn-quiet text-[13px]"
                  : "btn-quiet text-[13px] text-[rgb(252_165_165)] hover:text-[rgb(255_140_140)]"
              }
            >
              {suspended ? "Un-suspend" : "Suspend"}
            </button>
          </>
        }
      />

      {msg && (
        <div
          className="mb-6 px-3 py-2 rounded-lg text-[13px] border"
          style={{
            borderColor: "rgb(255 255 255 / 0.10)",
            background: "rgb(255 255 255 / 0.03)",
            color: "rgb(244 244 245)",
          }}
        >
          {msg}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Plan" value={planId.toUpperCase()} />
        <KpiCard label="Status" value={(suspended ? "Suspended" : (d.subscription?.status ?? "active"))} tone={suspended ? "hot" : "default"} />
        <KpiCard label="Sends · 30d" value={send30.toLocaleString()} />
        <KpiCard label="Errors · 30d" value={err30.toLocaleString()} tone={err30 > 0 ? "hot" : "default"} />
      </section>

      <Panel
        title="Sends · last 30 days"
        legend={
          <>
            <LegendDot color={CHART.sends}  label="Sent" />
            <LegendDot color={CHART.errors} label="Errors" />
          </>
        }
      >
        <StackedBars
          data={d.series.map((p) => ({
            day: p.day,
            values: { sends: p.sends, errors: p.errors },
          }))}
          keys={["sends", "errors"]}
          colors={{ sends: CHART.sends, errors: CHART.errors }}
          height={120}
        />
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Panel title="Account">
          <KV label="Email" value={d.user.email ?? "—"} />
          <KV label="Provider" value={d.user.provider ?? "email"} mono />
          <KV label="Joined" value={new Date(d.user.created_at).toLocaleString()} />
          <KV
            label="Last sign-in"
            value={d.user.last_sign_in_at ? new Date(d.user.last_sign_in_at).toLocaleString() : "never"}
          />
          <KV
            label="Stripe customer"
            value={
              d.subscription?.stripe_customer_id ? (
                <a
                  className="font-mono text-[12px] text-ink hover:text-[rgb(255_140_140)] transition-colors underline decoration-[rgb(255_99_99/0.4)] underline-offset-[3px]"
                  href={`https://dashboard.stripe.com/customers/${d.subscription.stripe_customer_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.subscription.stripe_customer_id}
                </a>
              ) : "—"
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
        </Panel>

        <Panel title={`Senders (${d.counts.senders})`}>
          {d.senders.length === 0 ? (
            <p className="text-[13px] text-ink-500">No senders connected.</p>
          ) : (
            <ul className="text-[13px] space-y-2">
              {d.senders.map((s) => {
                const revoked = s.oauth_status !== "ok";
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{s.label}</span>{" "}
                      <span className="font-mono text-[11.5px] text-ink-500">{s.email}</span>
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 shrink-0">
                      {s.auth_method}
                      {revoked && (
                        <span
                          className="ml-1.5 px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgb(239 68 68 / 0.10)", color: "rgb(252 165 165)" }}
                        >
                          {s.oauth_status}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={`Recent campaigns (${d.counts.campaigns})`} className="mt-3">
        {d.recent_campaigns.length === 0 ? (
          <p className="text-[13px] text-ink-500">No campaigns yet.</p>
        ) : (
          <div className="space-y-1">
            {d.recent_campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-hover transition-colors">
                <span className="text-[13px] text-ink truncate flex-1">{c.name}</span>
                <StatusPill status={c.status} />
                <span className="font-mono text-[11.5px] text-ink-500 shrink-0">
                  {new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Operator audit log" className="mt-3">
        {d.audit.length === 0 ? (
          <p className="text-[13px] text-ink-500">No operator actions on this user yet.</p>
        ) : (
          <div className="space-y-1">
            {d.audit.map((a) => (
              <div key={a.id} className="grid grid-cols-[auto,1fr,auto] items-baseline gap-3 py-1.5 px-2 rounded hover:bg-hover transition-colors">
                <code className="font-mono text-[12px] text-ink">{a.action}</code>
                <span className="font-mono text-[11px] text-ink-500 truncate">
                  {a.payload ? JSON.stringify(a.payload) : ""}
                </span>
                <span className="font-mono text-[11px] text-ink-500 shrink-0">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink transition-colors cursor-pointer mb-4"
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 2L3 6l4 4" />
      </svg>
      Back to users
    </Link>
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
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {legend && <div className="flex items-center gap-3 text-[11.5px] text-ink-500">{legend}</div>}
      </div>
      {children}
    </section>
  );
}

function KV({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-ink-100 last:border-0">
      <span className="text-[12.5px] text-ink-500">{label}</span>
      <span className={`text-[13px] text-right text-ink ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

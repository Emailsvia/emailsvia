"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type PlanId = "free" | "starter" | "growth" | "scale";

type Plan = {
  id: PlanId;
  name: string;
  daily_cap: number;
  sender_limit: number;
  monthly_price_cents: number;
  watermark: boolean;
  features: Record<string, unknown>;
};

type Subscription = {
  plan_id: PlanId;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
} | null;

type BillingState = {
  plan: Plan;
  subscription: Subscription;
  sent_today: number;
  day: string;
  timezone: string;
};

const TIERS: Array<{
  id: PlanId;
  name: string;
  price: string;
  cap: number;
  senders: number;
  highlights: string[];
  cta: "current" | "downgrade" | "upgrade";
}> = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cap: 50,
    senders: 1,
    highlights: ["50 sends / day", "1 sender", "EmailsVia watermark", "100-row imports"],
    cta: "current",
  },
  {
    id: "starter",
    name: "Starter",
    price: "$9 / mo",
    cap: 500,
    senders: 1,
    highlights: ["500 sends / day", "Follow-ups", "Tracking + scheduling", "Warmup included"],
    cta: "upgrade",
  },
  {
    id: "growth",
    name: "Growth",
    price: "$19 / mo",
    cap: 1500,
    senders: 3,
    highlights: ["1,500 sends / day", "3 senders", "AI reply triage", "A/B testing"],
    cta: "upgrade",
  },
  {
    id: "scale",
    name: "Scale",
    price: "$39 / mo",
    cap: 5000,
    senders: 10,
    highlights: ["5,000 sends / day", "10 senders + inbox rotation", "Email verification", "Public API"],
    cta: "upgrade",
  },
];

const RANK: Record<PlanId, number> = { free: 0, starter: 1, growth: 2, scale: 3 };

export default function BillingPage() {
  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function load() {
    const r = await fetch("/api/billing", { cache: "no-store" });
    const data = await r.json();
    setState(data);
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "success") {
      setFlash({ kind: "ok", msg: "Payment confirmed. Your plan will update in a few seconds." });
      window.history.replaceState({}, "", "/app/billing");
    } else if (status === "cancelled") {
      setFlash({ kind: "err", msg: "Checkout cancelled — no changes made." });
      window.history.replaceState({}, "", "/app/billing");
    }
  }, []);

  async function startCheckout(plan: Exclude<PlanId, "free">) {
    setBusy(plan);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) {
        setFlash({ kind: "err", msg: data.error ?? `Couldn't start checkout (${r.status}).` });
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const r = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.url) {
        setFlash({ kind: "err", msg: data.error ?? `Couldn't open portal (${r.status}).` });
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(null);
    }
  }

  const current: PlanId = state?.plan.id ?? "free";

  return (
    <AppShell>
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">Billing</h1>
        <p className="text-[13px] text-ink-500 mt-1 mb-6">Plans, usage, and payment.</p>

        {flash && (
          <div
            className={
              "mb-4 px-3 py-2 rounded-md text-[13px] " +
              (flash.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")
            }
          >
            {flash.msg}
          </div>
        )}

        {state && (
          <div className="sheet p-5 mb-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[12px] uppercase tracking-wide text-ink-500">Current plan</div>
                <div className="text-[20px] font-semibold mt-0.5">{state.plan.name}</div>
                <div className="text-[12px] text-ink-500 mt-1">
                  {state.subscription?.status === "past_due"
                    ? "Payment past due — Stripe is retrying. Update your card to avoid downgrade."
                    : state.subscription?.cancel_at_period_end
                    ? `Cancels at end of period (${state.subscription.current_period_end?.slice(0, 10) ?? "—"}).`
                    : `Status: ${state.subscription?.status ?? "active"}`}
                </div>
              </div>
              {state.subscription?.stripe_customer_id && (
                <button onClick={openPortal} disabled={busy === "portal"} className="btn-ghost">
                  {busy === "portal" ? "Opening…" : "Manage subscription"}
                </button>
              )}
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-[12px] text-ink-500 mb-1.5">
                <span>Today's usage</span>
                <span className="font-mono">
                  {state.sent_today.toLocaleString()} / {state.plan.daily_cap.toLocaleString()}
                </span>
              </div>
              <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                <div
                  className={
                    "h-full transition-all " +
                    (state.sent_today / state.plan.daily_cap > 0.9 ? "bg-red-500" : "bg-ink")
                  }
                  style={{
                    width: `${Math.min(100, (state.sent_today / Math.max(1, state.plan.daily_cap)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {TIERS.map((t) => {
            const isCurrent = t.id === current;
            const isUpgrade = RANK[t.id] > RANK[current];
            const isDowngrade = RANK[t.id] < RANK[current];
            return (
              <div
                key={t.id}
                className={
                  "sheet p-4 flex flex-col " +
                  (isCurrent ? "border-ink ring-1 ring-ink" : "")
                }
              >
                <div className="text-[14px] font-semibold">{t.name}</div>
                <div className="text-[20px] font-bold mt-0.5">{t.price}</div>
                <ul className="text-[12px] text-ink-600 mt-3 space-y-1.5 flex-1">
                  {t.highlights.map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent && (
                    <button className="btn-ghost w-full" disabled>
                      Current plan
                    </button>
                  )}
                  {isUpgrade && (
                    <button
                      className="btn-accent w-full"
                      disabled={busy === t.id}
                      onClick={() => t.id !== "free" && startCheckout(t.id)}
                    >
                      {busy === t.id ? "Redirecting…" : `Upgrade to ${t.name}`}
                    </button>
                  )}
                  {isDowngrade && state?.subscription?.stripe_customer_id && (
                    <button className="btn-ghost w-full" onClick={openPortal} disabled={busy === "portal"}>
                      {busy === "portal" ? "Opening…" : "Change in portal"}
                    </button>
                  )}
                  {isDowngrade && !state?.subscription?.stripe_customer_id && (
                    <button className="btn-ghost w-full" disabled>
                      Lower tier
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[12px] text-ink-500 mt-6">
          Tax is calculated automatically by Stripe. Cancel anytime &mdash; you keep paid features
          through the end of the current billing period.
        </p>
      </div>
    </AppShell>
  );
}

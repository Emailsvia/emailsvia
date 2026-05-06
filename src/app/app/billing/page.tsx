"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";

type PlanId = "free" | "starter" | "growth" | "scale";

type Plan = {
  id: PlanId;
  name: string;
  daily_cap: number;
  sender_limit: number;
  monthly_price_cents: number;
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
  stripe_configured: boolean;
  dev_mode: boolean;
};

type Tier = {
  id: PlanId;
  name: string;
  price: string;
  unit: string;
  cap: number;
  senders: number;
  tagline: string;
  highlight: string;
  features: string[];
  recommended?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    unit: "forever",
    cap: 50,
    senders: 1,
    tagline: "for kicking the tires",
    highlight: "1 sender, 100-row imports",
    features: ["50 sends / day", "1 sender", "100-row imports"],
  },
  {
    id: "starter",
    name: "Starter",
    price: "$9",
    unit: "/ month",
    cap: 500,
    senders: 1,
    tagline: "for the founder doing it solo",
    highlight: "Warmup included",
    features: ["500 sends / day", "Threaded follow-ups", "Warmup ramp", "Tracking + scheduling"],
  },
  {
    id: "growth",
    name: "Growth",
    price: "$19",
    unit: "/ month",
    cap: 1500,
    senders: 3,
    tagline: "for the team running cadences",
    highlight: "AI triage + A/B testing",
    features: ["1,500 sends / day", "3 senders", "AI reply triage", "A/B testing", "Conditional follow-ups"],
    recommended: true,
  },
  {
    id: "scale",
    name: "Scale",
    price: "$39",
    unit: "/ month",
    cap: 5000,
    senders: 10,
    tagline: "for the agency / SDR floor",
    highlight: "Inbox rotation + Public API",
    features: ["5,000 sends / day", "10 senders + rotation", "Email verification", "Public API + webhooks"],
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

  async function startCheckout(plan: PlanId) {
    setBusy(plan);
    try {
      if (state && !state.stripe_configured && state.dev_mode) {
        const r = await fetch("/api/dev/set-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const data = await r.json();
        if (!r.ok) {
          setFlash({ kind: "err", msg: data.error ?? `Couldn't set plan (${r.status}).` });
          return;
        }
        setFlash({ kind: "ok", msg: `Switched to ${plan} (dev mode — no charge).` });
        await load();
        return;
      }
      if (plan === "free") {
        setFlash({ kind: "err", msg: "Free downgrade goes through the Customer Portal — click “Manage subscription”." });
        return;
      }
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
  const usagePct = state ? Math.min(100, (state.sent_today / Math.max(1, state.plan.daily_cap)) * 100) : 0;
  const usageNearCap = usagePct >= 90;

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          eyebrow="Settings"
          title="Plan & billing"
          subtitle="Pricing that respects you. Cancel anytime — paid features run through the end of the period, then drop to Free."
          actions={
            state?.subscription?.stripe_customer_id ? (
              <button onClick={openPortal} disabled={busy === "portal"} className="btn-ghost">
                {busy === "portal" ? "Opening…" : "Manage subscription"}
              </button>
            ) : null
          }
        />

        {flash && <FlashBanner kind={flash.kind} message={flash.msg} onDismiss={() => setFlash(null)} />}

        {state && state.dev_mode && !state.stripe_configured && (
          <DevModeBanner />
        )}

        {state && (
          <section className="rounded-2xl border border-ink-200 bg-paper p-5 sm:p-6 mb-8">
            <div className="flex items-center justify-between gap-4 flex-wrap pb-4 mb-4 border-b border-ink-100">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">Current plan</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{state.plan.name}</span>
                  <span className="font-mono text-[12px] text-ink-500">
                    {state.plan.daily_cap.toLocaleString()}/day cap
                  </span>
                </div>
                <SubscriptionStatus sub={state.subscription} />
              </div>
              {!state.subscription?.stripe_customer_id && current !== "free" && (
                <span className="font-mono text-[11px] text-ink-500">
                  No Stripe subscription on record.
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 text-[12px] mb-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
                  Today&rsquo;s usage · {state.timezone}
                </span>
                <span className={`font-mono tabular-nums ${usageNearCap ? "text-[rgb(255_140_140)]" : "text-ink-700"}`}>
                  {state.sent_today.toLocaleString()} / {state.plan.daily_cap.toLocaleString()}
                </span>
              </div>
              <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${usagePct}%`,
                    background: usageNearCap
                      ? "rgb(239 68 68)"
                      : "linear-gradient(90deg, rgb(255 99 99), rgb(255 159 67))",
                  }}
                />
              </div>
              {usageNearCap && (
                <p className="mt-2 text-[12px] text-[rgb(255_140_140)]">
                  Almost at your daily cap. Upgrade if you need more headroom today.
                </p>
              )}
            </div>
          </section>
        )}

        <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 mb-3">
          Tiers
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {TIERS.map((t) => {
            const isCurrent = t.id === current;
            const isUpgrade = RANK[t.id] > RANK[current];
            const isDowngrade = RANK[t.id] < RANK[current];
            return (
              <PlanCard
                key={t.id}
                tier={t}
                isCurrent={isCurrent}
                ctaSlot={
                  isCurrent ? (
                    <button className="m-btn m-btn-ghost text-[13px] py-2 w-full" disabled>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                      Current plan
                    </button>
                  ) : isUpgrade ? (
                    <button
                      className="m-btn m-btn-primary text-[13px] py-2 w-full"
                      disabled={busy === t.id}
                      onClick={() => t.id !== "free" && startCheckout(t.id)}
                    >
                      {busy === t.id ? "Redirecting…" : `Upgrade to ${t.name}`}
                    </button>
                  ) : isDowngrade && state?.subscription?.stripe_customer_id ? (
                    <button
                      className="m-btn m-btn-ghost text-[13px] py-2 w-full"
                      onClick={openPortal}
                      disabled={busy === "portal"}
                    >
                      {busy === "portal" ? "Opening…" : "Change in portal"}
                    </button>
                  ) : isDowngrade && !state?.subscription?.stripe_customer_id && state?.dev_mode && !state?.stripe_configured ? (
                    <button
                      className="m-btn m-btn-ghost text-[13px] py-2 w-full"
                      disabled={busy === t.id}
                      onClick={() => startCheckout(t.id)}
                    >
                      {busy === t.id ? "Switching…" : `Switch to ${t.name}`}
                    </button>
                  ) : (
                    <button className="m-btn m-btn-ghost text-[13px] py-2 w-full" disabled>
                      Lower tier
                    </button>
                  )
                }
              />
            );
          })}
        </div>

        <p className="text-[12px] text-ink-500 mt-6 max-w-xl">
          Tax is calculated automatically by Stripe. We don&rsquo;t make you call anyone to cancel
          — one click in the customer portal does it.
        </p>
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function PlanCard({
  tier,
  isCurrent,
  ctaSlot,
}: {
  tier: Tier;
  isCurrent: boolean;
  ctaSlot: React.ReactNode;
}) {
  return (
    <div
      className={`relative rounded-2xl p-5 flex flex-col ${
        isCurrent
          ? "m-gradient-border bg-[rgb(255_99_99/0.04)]"
          : "border border-ink-200 bg-paper"
      }`}
      style={
        isCurrent
          ? { boxShadow: "0 0 60px -20px rgb(255 99 99 / 0.35)" }
          : undefined
      }
    >
      {tier.recommended && !isCurrent && (
        <span className="absolute -top-2.5 left-5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full m-gradient-bg text-[rgb(10_10_11)] font-semibold">
          Recommended
        </span>
      )}
      {isCurrent && (
        <span className="absolute -top-2.5 left-5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-paper border border-[rgb(255_99_99/0.35)] text-[rgb(255_140_140)]">
          Current
        </span>
      )}

      <div>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{tier.name}</h3>
        <p className="text-[12px] text-ink-500 mt-0.5">{tier.tagline}</p>
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-mono text-[28px] font-semibold tracking-[-0.02em] text-ink">{tier.price}</span>
        <span className="text-[11.5px] text-ink-500">{tier.unit}</span>
      </div>

      <div className="mt-3 mb-3 m-hairline" />

      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500 mb-1.5">
        Why this tier
      </div>
      <div className="text-[12.5px] text-ink font-medium mb-3">{tier.highlight}</div>

      <ul className="space-y-1.5 text-[12.5px] text-ink-700 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0 text-[rgb(255_140_140)]" aria-hidden>
              <path d="M5 12l5 5L20 7" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">{ctaSlot}</div>
    </div>
  );
}

function SubscriptionStatus({ sub }: { sub: Subscription }) {
  if (!sub) {
    return (
      <p className="text-[12.5px] text-ink-600 mt-1">No active subscription.</p>
    );
  }
  if (sub.status === "past_due") {
    return (
      <p className="text-[12.5px] text-[rgb(255_140_140)] mt-1">
        Payment past due — Stripe is retrying. Update your card to avoid downgrade.
      </p>
    );
  }
  if (sub.cancel_at_period_end) {
    return (
      <p className="text-[12.5px] text-[rgb(255_180_110)] mt-1">
        Cancels at end of period ({sub.current_period_end?.slice(0, 10) ?? "—"}).
      </p>
    );
  }
  return (
    <p className="text-[12.5px] text-ink-600 mt-1">
      Status: <span className="font-mono">{sub.status}</span>
    </p>
  );
}

function DevModeBanner() {
  return (
    <div
      className="mb-6 rounded-xl border px-4 py-3 flex items-start gap-3"
      style={{
        borderColor: "rgb(255 159 67 / 0.30)",
        background: "rgb(255 159 67 / 0.06)",
      }}
    >
      <span
        className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
        style={{ background: "rgb(255 159 67 / 0.18)", color: "rgb(255 180 110)" }}
        aria-hidden
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </span>
      <div className="flex-1 text-[13px]">
        <div className="font-semibold text-ink">Dev mode</div>
        <div className="text-ink-600 mt-0.5">
          Stripe products aren&rsquo;t configured. Upgrade buttons flip your plan directly with no
          payment so feature gates can be tested. This shortcut is disabled in production builds.
        </div>
      </div>
    </div>
  );
}

function FlashBanner({
  kind, message, onDismiss,
}: {
  kind: "ok" | "err";
  message: string;
  onDismiss: () => void;
}) {
  const tone = kind === "ok"
    ? { border: "rgb(16 185 129 / 0.30)", bg: "rgb(16 185 129 / 0.08)", text: "rgb(110 231 183)", iconBg: "rgb(16 185 129 / 0.18)" }
    : { border: "rgb(255 99 99 / 0.30)", bg: "rgb(255 99 99 / 0.06)", text: "rgb(255 140 140)", iconBg: "rgb(255 99 99 / 0.18)" };
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl border mb-6"
      style={{ borderColor: tone.border, background: tone.bg }}
    >
      <span
        className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
        style={{ background: tone.iconBg, color: tone.text }}
        aria-hidden
      >
        {kind === "ok" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4M12 16h.01" />
          </svg>
        )}
      </span>
      <span className="flex-1 text-[13.5px] text-ink">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid place-items-center w-6 h-6 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l6 6M3 9l6-6" />
        </svg>
      </button>
    </div>
  );
}

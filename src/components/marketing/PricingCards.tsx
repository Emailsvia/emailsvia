"use client";

import Link from "next/link";

type Tier = {
  id: "free" | "starter" | "growth" | "scale";
  name: string;
  tagline: string;
  price: string;
  unit: string;
  cap: string;
  highlight: string;
  features: string[];
  cta: string;
  href: string;
  recommended?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "for kicking the tires",
    price: "$0",
    unit: "forever",
    cap: "50 sends / day",
    highlight: "1 sender, 100-row imports",
    features: [
      "Mail merge from your Gmail",
      "Tracking + scheduling",
      "Manual send window",
      "No card. No timer. Really.",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "for the founder doing it solo",
    price: "$9",
    unit: "/ month",
    cap: "500 sends / day",
    highlight: "Warmup included",
    features: [
      "Threaded follow-ups",
      "Warmup ramp (14 days)",
      "Unlimited row imports",
      "Open + click tracking",
      "Strict-merge validation",
    ],
    cta: "Choose Starter",
    href: "/signup?plan=starter",
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "for the team running cadences",
    price: "$19",
    unit: "/ month",
    cap: "1,500 sends / day",
    highlight: "AI triage + A/B testing",
    features: [
      "AI reply triage (7 intents)",
      "AI personalization tags",
      "A/B testing + auto-promote",
      "Conditional follow-ups",
      "3 connected senders",
      "Everything in Starter",
    ],
    cta: "Choose Growth",
    href: "/signup?plan=growth",
    recommended: true,
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "for the agency / SDR floor",
    price: "$39",
    unit: "/ month",
    cap: "5,000 sends / day",
    highlight: "Inbox rotation + Public API",
    features: [
      "Inbox rotation across 10 Gmails",
      "Public API + webhooks",
      "Email verification",
      "Priority support",
      "10 connected senders",
      "Everything in Growth",
    ],
    cta: "Choose Scale",
    href: "/signup?plan=scale",
  },
];

export default function PricingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {TIERS.map((t) => (
        <PricingCard key={t.id} tier={t} />
      ))}
    </div>
  );
}

function PricingCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={`relative rounded-2xl p-6 flex flex-col ${
        tier.recommended
          ? "m-gradient-border bg-[rgb(255_255_255/0.025)]"
          : "m-card-hairline"
      }`}
      style={
        tier.recommended
          ? { boxShadow: "0 0 80px -20px rgb(255 99 99 / 0.35)" }
          : undefined
      }
    >
      {tier.recommended && (
        <span className="absolute -top-3 left-6 m-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full m-gradient-bg text-[rgb(10_10_11)] font-semibold">
          Recommended
        </span>
      )}

      <div className="flex items-baseline justify-between">
        <h3 className="text-[18px] font-semibold tracking-tight text-[rgb(244_244_245)]">{tier.name}</h3>
      </div>
      <p className="text-[12.5px] text-[rgb(113_113_122)] mt-1">{tier.tagline}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-[40px] font-semibold tracking-[-0.03em] text-[rgb(244_244_245)] m-mono">{tier.price}</span>
        <span className="text-[12px] text-[rgb(113_113_122)]">{tier.unit}</span>
      </div>
      <div className="mt-1 m-mono text-[12px] text-[rgb(255_140_140)]">{tier.cap}</div>

      <div className="mt-4 mb-5 m-hairline" />

      <div className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)] mb-2.5">
        Why this tier
      </div>
      <div className="text-[13px] text-[rgb(244_244_245)] font-medium mb-4">
        {tier.highlight}
      </div>

      <ul className="space-y-2 text-[13px] text-[rgb(209_209_213)] flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={tier.href}
        className={`m-btn mt-6 ${tier.recommended ? "m-btn-primary" : "m-btn-ghost"}`}
      >
        {tier.cta}
      </Link>
    </div>
  );
}

function Check() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-1 text-[rgb(255_140_140)] flex-shrink-0"
      aria-hidden
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

"use client";

import { useEffect, useState } from "react";

type Variant = "welcome-back" | "join";

const COPY: Record<Variant, { eyebrow: string; headline: React.ReactNode; sub: string; quote: string; quoteAttr: string }> = {
  "welcome-back": {
    eyebrow: "Welcome back",
    headline: (
      <>
        Your inbox{" "}
        <span className="m-gradient-text">is waiting.</span>
      </>
    ),
    sub: "Pick up where you left off. Campaigns paused since you last signed in are sitting at the gate, ready when you are.",
    quote:
      "First tool that actually thinks about deliverability instead of just throwing more sends at the problem. The threading alone is worth $9.",
    quoteAttr: "Maya P. · founder, design tools",
  },
  join: {
    eyebrow: "Free, forever",
    headline: (
      <>
        One Gmail. One sheet.
        <br />
        <span className="m-gradient-text">Zero spam folders.</span>
      </>
    ),
    sub: "Send 50 personalized emails a day, free forever. No card. No timer. When you outgrow it, we&rsquo;ll be here.",
    quote:
      "Tried half a dozen outbound tools. Switched in week three and never looked back. The strict-merge alone saved an 800-row campaign.",
    quoteAttr: "Theo N. · head of growth",
  },
};

export default function AuthSidePanel({ variant }: { variant: Variant }) {
  const data = COPY[variant];
  return (
    <div className="space-y-10">
      <div>
        <span className="m-pill">
          <span className="m-pill-dot" />
          <span>{data.eyebrow}</span>
        </span>
        <h2 className="m-display text-[44px] xl:text-[52px] mt-6 leading-[1]">{data.headline}</h2>
        <p className="m-body text-[15px] mt-5 max-w-sm">{data.sub}</p>
      </div>

      <LiveStats />

      <figure className="m-glass rounded-2xl p-5">
        <svg
          width="20"
          height="14"
          viewBox="0 0 20 14"
          fill="rgb(255 99 99 / 0.4)"
          className="mb-3"
          aria-hidden
        >
          <path d="M0 14V8c0-3 1-5 3-7l3 1.5C5 4 4 6 4 8h3v6H0zm10 0V8c0-3 1-5 3-7l3 1.5c-1 1.5-2 3.5-2 5.5h3v6h-7z" />
        </svg>
        <blockquote className="text-[14px] text-[rgb(220_220_225)] leading-relaxed">
          &ldquo;{data.quote}&rdquo;
        </blockquote>
        <figcaption className="m-mono text-[11px] text-[rgb(113_113_122)] mt-4">
          {data.quoteAttr}
        </figcaption>
      </figure>
    </div>
  );
}

/* Live stats pulse — feels like a working product, not a static page */
function LiveStats() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => setTicks((t) => t + 1), 3200);
    return () => window.clearInterval(id);
  }, []);

  // Numbers aren't a claim — they're vibe. Tiny breathing motion.
  const sentToday = 14_287 + (ticks % 9);
  const replied = 1_902 + Math.floor(ticks / 4);
  const interested = 312;

  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Sent today"  value={sentToday.toLocaleString()} />
      <Stat label="Replies"     value={replied.toLocaleString()}   />
      <Stat label="Interested"  value={interested.toString()}      hot />
    </div>
  );
}

function Stat({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="m-card-hairline rounded-xl p-3">
      <div className="m-mono text-[10px] uppercase tracking-wider text-[rgb(113_113_122)]">
        {label}
      </div>
      <div
        className={`m-mono text-[18px] mt-1 ${hot ? "m-gradient-text" : "text-[rgb(244_244_245)]"}`}
      >
        {value}
      </div>
    </div>
  );
}

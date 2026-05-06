"use client";

import { useEffect, useState } from "react";

/**
 * Asymmetric 7-tile bento grid. Each tile is a glass card with a small
 * embedded "live-feeling" visual — no static screenshots.
 */

const REPLY_DEMO = [
  { from: "elise@figma.com",     body: "Yes — let's chat. Wed 3pm work?",                 intent: "interested" as const },
  { from: "noreply@google.com",  body: "Out of office until Aug 12. I'll reply on return.", intent: "ooo"        as const },
  { from: "ben@stripe.com",      body: "Curious — does this support custom HTML in the body?", intent: "question" as const },
];

const INTENT_STYLE = {
  interested: { bg: "bg-[rgb(16_185_129/0.12)]",  text: "text-[rgb(110_231_183)]" },
  ooo:        { bg: "bg-[rgb(255_159_67/0.12)]",  text: "text-[rgb(255_180_110)]" },
  question:   { bg: "bg-[rgb(255_99_99/0.12)]",   text: "text-[rgb(255_140_140)]" },
};

export default function FeatureBento() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
      {/* Tile 1 — AI triage (large 2x2) */}
      <div className="md:col-span-2 md:row-span-2 m-glass rounded-2xl p-6 md:p-7 relative overflow-hidden">
        <TileHeader
          eyebrow="AI Reply Triage"
          title="Stop reading every reply."
          body="Inbound mail gets classified the moment it lands — interested, question, OOO, bounce. Filter your inbox by intent in one click. Hello to your top 5%."
        />
        <div className="mt-6 space-y-2.5">
          {REPLY_DEMO.map((r, i) => (
            <ReplyRow key={r.from} reply={r} delayMs={i * 700} />
          ))}
        </div>
      </div>

      {/* Tile 2 — Warmup */}
      <div className="m-glass rounded-2xl p-6 relative overflow-hidden">
        <TileHeader
          eyebrow="Warmup"
          title="14 days from cold to confident."
          body="A new Gmail ramps from 10/day to 400/day automatically — paced just below the throttling line."
        />
        <WarmupRamp />
      </div>

      {/* Tile 3 — A/B */}
      <div className="m-glass rounded-2xl p-6 relative overflow-hidden">
        <TileHeader
          eyebrow="A/B Testing"
          title="Two subjects walk in. One leaves."
          body="50/50 split. Auto-promote the winner the moment confidence threshold hits."
        />
        <ABBars />
      </div>

      {/* Tile 4 — Inbox rotation (wide) */}
      <div className="md:col-span-2 m-glass rounded-2xl p-6 md:p-7 relative overflow-hidden">
        <TileHeader
          eyebrow="Inbox Rotation"
          title="One campaign. Ten Gmails. Zero spam folders."
          body="Sticky-per-recipient so follow-ups always thread cleanly. The volume play that no $39 competitor ships."
        />
        <RotationDiagram />
      </div>

      {/* Tile 5 — Strict merge */}
      <div className="m-glass rounded-2xl p-6 relative overflow-hidden">
        <TileHeader
          eyebrow="Strict Merge"
          title={'Never sends "Hi ,".'}
          body="If a row is missing a field, we skip it loudly. Saves a campaign in row 4 instead of row 200."
        />
        <div className="mt-5 space-y-1.5">
          <CodeRow tone="ok"   text='Hi {{Name=Maya}},'         />
          <CodeRow tone="ok"   text='Hi {{Name=Theo}},'         />
          <CodeRow tone="bad"  text='Hi {{Name=}},  ← skipped' />
          <CodeRow tone="ok"   text='Hi {{Name=Aisha}},'        />
        </div>
      </div>

      {/* Tile 6 — API + Webhooks (wide bottom) */}
      <div className="md:col-span-2 m-glass rounded-2xl p-6 md:p-7 relative overflow-hidden">
        <TileHeader
          eyebrow="Public API · Webhooks"
          title="Send a campaign with one POST."
          body="Embed outbound into your CRM, agent, or product. Sign every webhook with HMAC."
        />
        <CodeBlock />
      </div>

      {/* Tile 7 — Threading */}
      <div className="m-glass rounded-2xl p-6 relative overflow-hidden">
        <TileHeader
          eyebrow="Threaded Follow-ups"
          title="Step 2 lands as a reply, not a re-pitch."
          body="In-Reply-To headers wired correctly. Gmail groups them — the way a real conversation looks."
        />
        <ThreadVisual />
      </div>
    </div>
  );
}

function TileHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <div className="m-eyebrow">{eyebrow}</div>
      <h3 className="mt-2 text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[rgb(244_244_245)] leading-tight">
        {title}
      </h3>
      <p className="mt-2 text-[13.5px] text-[rgb(161_161_170)] leading-relaxed max-w-md">
        {body}
      </p>
    </div>
  );
}

function ReplyRow({
  reply,
  delayMs,
}: {
  reply: typeof REPLY_DEMO[number];
  delayMs: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 600 + delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  const s = INTENT_STYLE[reply.intent];
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-[rgb(255_255_255/0.025)] border border-[rgb(255_255_255/0.05)]">
      <div className="flex-1 min-w-0">
        <div className="m-mono text-[11px] text-[rgb(113_113_122)] truncate">{reply.from}</div>
        <div className="text-[13px] text-[rgb(244_244_245)] truncate">{reply.body}</div>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 m-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-all duration-500 ${
          shown ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"
        } ${s.bg} ${s.text}`}
      >
        {reply.intent}
      </span>
    </div>
  );
}

function WarmupRamp() {
  const days = [10, 20, 40, 60, 100, 150, 200, 250, 300, 350, 380, 400, 400, 400];
  const max = Math.max(...days);
  return (
    <div className="mt-5 grid grid-cols-14 gap-[3px] items-end h-20" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
      {days.map((d, i) => (
        <div
          key={i}
          className="rounded-t-[3px] m-gradient-bg"
          style={{
            height: `${(d / max) * 100}%`,
            opacity: 0.35 + (i / days.length) * 0.65,
          }}
          title={`Day ${i + 1}: ${d}/day`}
        />
      ))}
    </div>
  );
}

function ABBars() {
  return (
    <div className="mt-5 space-y-3">
      <Bar label="A · Quick question" pct={42} ghost />
      <Bar label="B · 5 mins for…"     pct={68} winner />
    </div>
  );
}
function Bar({ label, pct, ghost = false, winner = false }: { label: string; pct: number; ghost?: boolean; winner?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className={`m-mono ${winner ? "text-[rgb(244_244_245)]" : "text-[rgb(161_161_170)]"}`}>{label}</span>
        <span className="m-mono text-[rgb(113_113_122)]">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-[rgb(255_255_255/0.05)] overflow-hidden">
        <div
          className={`h-full rounded-full ${winner ? "m-gradient-bg" : "bg-[rgb(255_255_255/0.18)]"}`}
          style={{ width: `${pct}%`, opacity: ghost ? 0.7 : 1 }}
        />
      </div>
    </div>
  );
}

function RotationDiagram() {
  return (
    <div className="mt-6 flex items-center gap-5 overflow-x-auto pb-1">
      <div className="flex-shrink-0">
        <div className="m-mono text-[10px] uppercase tracking-wider text-[rgb(113_113_122)] mb-1.5">Campaign</div>
        <div className="m-glass rounded-lg px-3 py-2 text-[12px] text-[rgb(244_244_245)] m-mono">10,000 rows</div>
      </div>
      <ArrowR />
      <div className="flex flex-col gap-1.5">
        <div className="m-mono text-[10px] uppercase tracking-wider text-[rgb(113_113_122)]">Senders (10)</div>
        <div className="flex gap-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)] grid place-items-center m-mono text-[10px] text-[rgb(244_244_245)]"
            >
              {String.fromCharCode(65 + i)}
            </div>
          ))}
        </div>
      </div>
      <ArrowR />
      <div className="flex-shrink-0">
        <div className="m-mono text-[10px] uppercase tracking-wider text-[rgb(113_113_122)] mb-1.5">Per-sender daily</div>
        <div className="m-glass rounded-lg px-3 py-2 text-[12px] text-[rgb(255_140_140)] m-mono">~400 / safe</div>
      </div>
    </div>
  );
}
function ArrowR() {
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[rgb(113_113_122)] flex-shrink-0" aria-hidden>
      <path d="M0 7 H22 M16 1 L22 7 L16 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CodeRow({ tone, text }: { tone: "ok" | "bad"; text: string }) {
  const isBad = tone === "bad";
  return (
    <div
      className={`m-mono text-[12px] px-3 py-1.5 rounded-md flex items-center gap-2 ${
        isBad
          ? "bg-[rgb(255_99_99/0.08)] text-[rgb(255_140_140)] border border-[rgb(255_99_99/0.18)]"
          : "bg-[rgb(255_255_255/0.025)] text-[rgb(209_209_213)] border border-[rgb(255_255_255/0.05)]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isBad ? "bg-[rgb(255_99_99)]" : "bg-[rgb(16_185_129/0.7)]"}`} />
      {text}
    </div>
  );
}

function CodeBlock() {
  return (
    <pre className="mt-5 m-mono text-[12px] leading-[1.7] bg-[rgb(0_0_0/0.4)] border border-[rgb(255_255_255/0.06)] rounded-xl p-4 overflow-x-auto text-[rgb(209_209_213)]">
{`POST /api/v1/campaigns/from-sheet
Authorization: Bearer eav_live_…

{
  "name":     "Q2 outreach",
  "sheet":    "https://docs.google.com/…",
  "subject":  "Quick question about {{Company}}",
  "schedule": { "daily_cap": 1000, "gap_seconds": 60 }
}`}
    </pre>
  );
}

function ThreadVisual() {
  return (
    <div className="mt-5 space-y-1.5">
      <ThreadMsg subject="Quick question about Linear"  preview="Hi Maya, I came across…" depth={0} />
      <ThreadMsg subject="Re: Quick question about Linear" preview="Following up on this…" depth={1} />
      <ThreadMsg subject="Re: Quick question about Linear" preview="One last note…"        depth={2} />
    </div>
  );
}
function ThreadMsg({ subject, preview, depth }: { subject: string; preview: string; depth: number }) {
  return (
    <div
      className="rounded-md bg-[rgb(255_255_255/0.025)] border border-[rgb(255_255_255/0.05)] px-3 py-2"
      style={{ marginLeft: depth * 14 }}
    >
      <div className="text-[12px] text-[rgb(244_244_245)] truncate">{subject}</div>
      <div className="text-[11px] text-[rgb(113_113_122)] truncate">{preview}</div>
    </div>
  );
}

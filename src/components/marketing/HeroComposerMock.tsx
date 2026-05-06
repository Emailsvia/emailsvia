"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero showpiece: a fake macOS-window campaign composer.
 * Subject types itself, recipient list resolves merge tags into a live preview,
 * status pill cycles drafting → sending → delivered.
 * Pauses on hover so visitors can read.
 */

const SUBJECT_TARGET = "Quick question about {{Company}}";

type Recipient = {
  id: string;
  name: string;
  email: string;
  company: string;
  initial: string;
  tone: "coral" | "amber" | "pink";
};

const RECIPIENTS: Recipient[] = [
  { id: "r1", name: "Maya Patel",   email: "maya@linear.app",     company: "Linear",     initial: "M", tone: "coral" },
  { id: "r2", name: "Theo Nakamura", email: "theo@vercel.com",    company: "Vercel",     initial: "T", tone: "amber" },
  { id: "r3", name: "Aisha Khan",   email: "aisha@attio.com",      company: "Attio",      initial: "A", tone: "pink"  },
  { id: "r4", name: "Dario Costa",  email: "dario@raycast.com",    company: "Raycast",    initial: "D", tone: "coral" },
  { id: "r5", name: "Eden Park",    email: "eden@cursor.so",       company: "Cursor",     initial: "E", tone: "amber" },
];

const TONE_BG: Record<Recipient["tone"], string> = {
  coral: "bg-[rgb(255_99_99/0.15)] text-[rgb(255_140_140)]",
  amber: "bg-[rgb(255_159_67/0.15)] text-[rgb(255_180_110)]",
  pink:  "bg-[rgb(255_119_154/0.15)] text-[rgb(255_160_180)]",
};

type Status = "drafting" | "sending" | "delivered";

export default function HeroComposerMock() {
  const [typed, setTyped] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus] = useState<Status>("drafting");
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Subject typing animation (loops)
  useEffect(() => {
    if (paused) return;
    let i = typed.length;
    let ts: number | undefined;
    const tick = () => {
      if (i <= SUBJECT_TARGET.length) {
        setTyped(SUBJECT_TARGET.slice(0, i));
        i += 1;
        ts = window.setTimeout(tick, 55 + Math.random() * 60);
      } else {
        ts = window.setTimeout(() => {
          setTyped("");
          i = 0;
          tick();
        }, 2400);
      }
    };
    ts = window.setTimeout(tick, 700);
    return () => {
      if (ts) window.clearTimeout(ts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Recipient cursor + status loop
  useEffect(() => {
    if (paused) return;
    const sequence = window.setInterval(() => {
      setActiveIdx((prev) => {
        const next = (prev + 1) % RECIPIENTS.length;
        if (next === 0) {
          setStatus("delivered");
          window.setTimeout(() => setStatus("drafting"), 1100);
        } else if (next === RECIPIENTS.length - 1) {
          setStatus("sending");
        } else {
          setStatus("drafting");
        }
        return next;
      });
    }, 1700);
    return () => window.clearInterval(sequence);
  }, [paused]);

  const active = RECIPIENTS[activeIdx];

  return (
    <div
      ref={rootRef}
      className="relative w-full max-w-5xl mx-auto m-card-hairline overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        boxShadow:
          "0 80px 120px -40px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.05)",
      }}
    >
      {/* macOS chrome */}
      <div className="flex items-center gap-2 px-4 h-9 border-b border-[rgb(255_255_255/0.06)] bg-[rgb(255_255_255/0.02)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[rgb(255_99_99/0.7)]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[rgb(255_159_67/0.7)]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[rgb(16_185_129/0.5)]" />
        <div className="ml-2 flex-1 text-center">
          <span className="m-mono text-[11px] text-[rgb(161_161_170)]">
            emailsvia.com — Q2 founder outreach
          </span>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Body grid: composer | preview */}
      <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr]">
        {/* LEFT: composer */}
        <div className="p-5 md:p-7 border-b md:border-b-0 md:border-r border-[rgb(255_255_255/0.05)] space-y-5">
          <Field label="From">
            <span className="text-[13px] text-[rgb(244_244_245)]">
              you@yourdomain.com
              <span className="text-[rgb(113_113_122)]"> · via Gmail</span>
            </span>
          </Field>

          <Field label="To">
            <div className="flex flex-wrap gap-1.5">
              {RECIPIENTS.map((r, i) => (
                <span
                  key={r.id}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] transition ${
                    i === activeIdx
                      ? "ring-1 ring-[rgb(255_99_99/0.4)] bg-[rgb(255_99_99/0.10)] text-[rgb(244_244_245)]"
                      : "bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)]"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full grid place-items-center text-[10px] font-medium ${TONE_BG[r.tone]}`}
                  >
                    {r.initial}
                  </span>
                  {r.name}
                </span>
              ))}
              <span className="m-mono text-[11px] text-[rgb(113_113_122)] self-center pl-1">
                + 196
              </span>
            </div>
          </Field>

          <Field label="Subject">
            <span className="text-[15px] text-[rgb(244_244_245)] m-mono">
              {typed}
              <span className="m-caret" />
            </span>
          </Field>

          <Field label="Body" expanded>
            <div className="space-y-2 text-[13px] leading-relaxed text-[rgb(209_209_213)]">
              <p>
                Hi <Token tone={active.tone}>{active.name.split(" ")[0]}</Token>,
              </p>
              <p>
                I came across <Token tone={active.tone}>{active.company}</Token> last week and the way you ship made
                me actually stop scrolling. I&rsquo;m building something quietly adjacent — wanted to see if a 15-min
                conversation might be useful for either of us.
              </p>
              <p className="text-[rgb(161_161_170)]">— Sent from your Gmail, paced by EmailsVia.</p>
            </div>
          </Field>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3 text-[12px] text-[rgb(113_113_122)]">
              <KeyChip>⌘</KeyChip>
              <KeyChip>↵</KeyChip>
              <span className="m-mono">to send</span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              className="m-btn m-btn-primary text-[13px] py-1.5 px-3"
              aria-hidden
            >
              Start campaign
            </button>
          </div>
        </div>

        {/* RIGHT: live preview */}
        <div className="p-5 md:p-7 bg-[rgb(255_255_255/0.015)]">
          <div className="m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] mb-3">
            Live preview · row {activeIdx + 1} of 200
          </div>
          <div className="m-glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-full grid place-items-center text-[13px] font-medium ${TONE_BG[active.tone]}`}>
                {active.initial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[rgb(244_244_245)] truncate">{active.name}</div>
                <div className="text-[11px] text-[rgb(113_113_122)] truncate">{active.email}</div>
              </div>
              <span className="m-mono text-[10px] text-[rgb(113_113_122)]">9:42 AM</span>
            </div>
            <div className="text-[13px] text-[rgb(244_244_245)] font-medium">
              Quick question about {active.company}
            </div>
            <div className="text-[12px] leading-relaxed text-[rgb(209_209_213)]">
              <p>Hi {active.name.split(" ")[0]},</p>
              <p className="mt-1.5">
                I came across <span className="text-[rgb(244_244_245)]">{active.company}</span> last week and the way
                you ship made me actually stop scrolling…
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="m-pill text-[10.5px]">
                <span className="m-pill-dot" /> threading via In-Reply-To
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
            <Stat label="Daily cap" value="500" />
            <Stat label="Gap" value="60s" />
            <Stat label="Window" value="9–6 IST" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  expanded = false,
}: {
  label: string;
  children: React.ReactNode;
  expanded?: boolean;
}) {
  return (
    <div>
      <div className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)] mb-1.5">
        {label}
      </div>
      <div className={expanded ? "" : ""}>{children}</div>
    </div>
  );
}

function Token({
  tone,
  children,
}: {
  tone: "coral" | "amber" | "pink";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-px m-mono text-[12px] ${TONE_BG[tone]}`}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; color: string }> = {
    drafting:  { label: "Drafting",  color: "rgb(161 161 170)" },
    sending:   { label: "Sending",   color: "rgb(255 159 67)"  },
    delivered: { label: "Delivered", color: "rgb(16 185 129)"  },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 m-mono text-[11px] text-[rgb(244_244_245)]">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: s.color,
          boxShadow: `0 0 12px ${s.color}`,
        }}
      />
      {s.label}
    </span>
  );
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)] text-[10px] text-[rgb(244_244_245)] m-mono">
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="m-glass rounded-lg px-3 py-2">
      <div className="m-mono text-[10px] uppercase tracking-wider text-[rgb(113_113_122)]">{label}</div>
      <div className="text-[13px] text-[rgb(244_244_245)] mt-0.5">{value}</div>
    </div>
  );
}

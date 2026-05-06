"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AlertSeverity = "error" | "warn" | "info";
type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  href: string;
  cta: string;
};

// Banner stack rendered above every /app page. Polls the alerts feed every
// 60s so a sender-revoked event surfaces without a refresh. Dismiss is
// session-local — alerts come back next reload because they're sourced
// from real account state, not "I clicked X".
export default function AppAlerts() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/app/alerts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((d) => { if (!cancelled) setAlerts(d.alerts ?? []); })
        .catch(() => { if (!cancelled) setAlerts([]); });
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!alerts || alerts.length === 0) return null;
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="px-6 md:px-10 pt-4 space-y-2">
      {visible.map((a) => (
        <AlertBanner
          key={a.id}
          alert={a}
          onDismiss={() =>
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add(a.id);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}

function AlertBanner({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const isExternal = alert.href.startsWith("mailto:") || alert.href.startsWith("http");
  const tone = TONE[alert.severity];

  return (
    <div
      role={alert.severity === "error" ? "alert" : "status"}
      className="relative flex items-start gap-3 rounded-xl border px-4 py-3 backdrop-blur-md transition-all"
      style={{
        borderColor: tone.border,
        background: tone.bg,
      }}
    >
      <span
        className="mt-1 flex-shrink-0 grid place-items-center w-5 h-5 rounded-full"
        style={{ background: tone.iconBg }}
        aria-hidden
      >
        <Glyph severity={alert.severity} color={tone.icon} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-ink">{alert.title}</span>
          <span className="text-[12.5px] text-ink-600 leading-relaxed">{alert.body}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {isExternal ? (
          <a
            href={alert.href}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer"
            style={{ color: tone.cta, background: tone.ctaBg }}
          >
            {alert.cta}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
          </a>
        ) : (
          <Link
            href={alert.href}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer"
            style={{ color: tone.cta, background: tone.ctaBg }}
          >
            {alert.cta}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
          </Link>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="grid place-items-center w-6 h-6 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M3 3l6 6M3 9l6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const TONE: Record<
  AlertSeverity,
  { border: string; bg: string; icon: string; iconBg: string; cta: string; ctaBg: string }
> = {
  error: {
    border: "rgb(255 99 99 / 0.30)",
    bg:     "rgb(255 99 99 / 0.06)",
    icon:   "rgb(255 140 140)",
    iconBg: "rgb(255 99 99 / 0.18)",
    cta:    "rgb(255 140 140)",
    ctaBg:  "rgb(255 99 99 / 0.10)",
  },
  warn: {
    border: "rgb(255 159 67 / 0.30)",
    bg:     "rgb(255 159 67 / 0.06)",
    icon:   "rgb(255 180 110)",
    iconBg: "rgb(255 159 67 / 0.18)",
    cta:    "rgb(255 180 110)",
    ctaBg:  "rgb(255 159 67 / 0.10)",
  },
  info: {
    border: "rgb(255 255 255 / 0.10)",
    bg:     "rgb(255 255 255 / 0.025)",
    icon:   "rgb(244 244 245)",
    iconBg: "rgb(255 255 255 / 0.06)",
    cta:    "rgb(244 244 245)",
    ctaBg:  "rgb(255 255 255 / 0.06)",
  },
};

function Glyph({ severity, color }: { severity: AlertSeverity; color: string }) {
  if (severity === "error") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 8v5M12 17h.01" />
      </svg>
    );
  }
  if (severity === "warn") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 8v8M12 8h.01" />
    </svg>
  );
}

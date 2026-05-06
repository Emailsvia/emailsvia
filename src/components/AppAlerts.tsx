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

const TONE: Record<AlertSeverity, { wrap: string; cta: string }> = {
  error: {
    wrap: "border-red-200 bg-red-50 text-red-900",
    cta: "text-red-700 hover:text-red-900 underline",
  },
  warn: {
    wrap: "border-amber-200 bg-amber-50 text-amber-900",
    cta: "text-amber-700 hover:text-amber-900 underline",
  },
  info: {
    wrap: "border-ink-200 bg-paper text-ink",
    cta: "text-ink hover:underline",
  },
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
        .then((d) => {
          if (!cancelled) setAlerts(d.alerts ?? []);
        })
        .catch(() => {
          if (!cancelled) setAlerts([]);
        });
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!alerts || alerts.length === 0) return null;
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="px-6 md:px-10 pt-4 space-y-2">
      {visible.map((a) => {
        const tone = TONE[a.severity];
        const isExternal = a.href.startsWith("mailto:") || a.href.startsWith("http");
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-[13px] ${tone.wrap}`}
            role={a.severity === "error" ? "alert" : "status"}
          >
            <DotIcon severity={a.severity} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{a.title}</div>
              <div className="opacity-90">{a.body}</div>
            </div>
            {isExternal ? (
              <a
                href={a.href}
                className={`text-[12px] font-medium shrink-0 mt-0.5 ${tone.cta}`}
              >
                {a.cta} →
              </a>
            ) : (
              <Link
                href={a.href}
                className={`text-[12px] font-medium shrink-0 mt-0.5 ${tone.cta}`}
              >
                {a.cta} →
              </Link>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() =>
                setDismissed((prev) => {
                  const next = new Set(prev);
                  next.add(a.id);
                  return next;
                })
              }
              className="text-current opacity-50 hover:opacity-100 mt-0.5"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DotIcon({ severity }: { severity: AlertSeverity }) {
  const fill =
    severity === "error" ? "#dc2626" : severity === "warn" ? "#d97706" : "#1a1a1a";
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
      style={{ background: fill }}
    />
  );
}

"use client";

import { useEffect, useState } from "react";

export type AlertSeverity = "error" | "warn" | "info";
export type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  href: string;
  cta: string;
};

// One shared poller for /api/app/alerts. The banner stack and the header
// bell both need the feed; polling it from each doubled the requests, and
// polling a hidden tab kept the server from ever idling.
const POLL_MS = 60_000;
let current: Alert[] | null = null;
const listeners = new Set<(a: Alert[]) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function load() {
  if (document.hidden) return;
  fetch("/api/app/alerts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { alerts: [] }))
    .then((d) => (d.alerts ?? []) as Alert[])
    .catch(() => [] as Alert[])
    .then((alerts) => {
      current = alerts;
      listeners.forEach((l) => l(alerts));
    });
}

function onVisible() {
  if (!document.hidden) load();
}

export function useAlerts(): Alert[] | null {
  const [alerts, setAlerts] = useState<Alert[] | null>(current);

  useEffect(() => {
    listeners.add(setAlerts);
    if (listeners.size === 1) {
      load();
      timer = setInterval(load, POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
    } else if (current) {
      setAlerts(current);
    }
    return () => {
      listeners.delete(setAlerts);
      if (listeners.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  return alerts;
}

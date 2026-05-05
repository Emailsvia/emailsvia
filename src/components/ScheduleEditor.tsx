"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SCHEDULE, type Schedule, type WeekdayKey } from "@/lib/supabase";
import { WEEKDAYS, WEEKDAY_LABEL } from "@/lib/time";

export default function ScheduleEditor({
  schedule,
  onChange,
  dailyCap,
  onDailyCap,
  gapSeconds,
  onGapSeconds,
  totalRecipients,
}: {
  schedule: Schedule;
  onChange: (s: Schedule) => void;
  dailyCap: number;
  onDailyCap: (n: number) => void;
  gapSeconds: number;
  onGapSeconds: (n: number) => void;
  totalRecipients?: number;
}) {
  function patchDay(key: WeekdayKey, patch: Partial<Schedule[WeekdayKey]>) {
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });
  }

  function applyPreset(preset: "anytime" | "business" | "weekdays") {
    const next = { ...schedule };
    if (preset === "anytime") {
      WEEKDAYS.forEach((k) => { next[k] = { enabled: true, start: "00:00", end: "23:59" }; });
    } else if (preset === "business") {
      WEEKDAYS.forEach((k) => {
        const weekend = k === "sat" || k === "sun";
        next[k] = { enabled: !weekend, start: "09:00", end: "17:00" };
      });
    } else {
      WEEKDAYS.forEach((k) => {
        const weekend = k === "sat" || k === "sun";
        next[k] = { enabled: !weekend, start: "08:00", end: "18:00" };
      });
    }
    onChange(next);
  }

  const enabledCount = WEEKDAYS.filter((k) => schedule[k].enabled).length;
  const totalMinPerDay = WEEKDAYS.reduce((acc, k) => {
    if (!schedule[k].enabled) return acc;
    const [sh, sm] = schedule[k].start.split(":").map(Number);
    const [eh, em] = schedule[k].end.split(":").map(Number);
    return acc + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);
  const perGapMin = gapSeconds / 60;
  const slotsPerWeek = perGapMin > 0 ? Math.floor(totalMinPerDay / perGapMin) : 0;
  const effectivePerWeek = Math.min(slotsPerWeek, dailyCap * enabledCount);

  // ETA for current recipient count (if known)
  const avgDayMin = enabledCount > 0 ? totalMinPerDay / enabledCount : 0;
  const sendsPerActiveDay = perGapMin > 0 && avgDayMin > 0
    ? Math.min(dailyCap, Math.floor(avgDayMin / perGapMin))
    : 0;
  const daysNeeded = totalRecipients && sendsPerActiveDay > 0
    ? Math.ceil(totalRecipients / sendsPerActiveDay)
    : 0;

  function formatEta(N: number): string {
    if (sendsPerActiveDay === 0) return "never — add an active day or lower the gap";
    const days = Math.ceil(N / sendsPerActiveDay);
    if (days <= 1) {
      const totalMin = N * perGapMin;
      if (totalMin < 60) return `≈ ${Math.ceil(totalMin)} min to send all`;
      const h = Math.floor(totalMin / 60);
      const m = Math.round(totalMin - h * 60);
      return m > 0 ? `≈ ${h} hr ${m} min to send all` : `≈ ${h} hr to send all`;
    }
    return `≈ ${days} active ${days === 1 ? "day" : "days"} to send all`;
  }

  // local text state so users can freely type / clear the number inputs
  const [dailyCapText, setDailyCapText] = useState(String(dailyCap));
  const [gapText, setGapText] = useState(String(perGapMin));

  useEffect(() => { setDailyCapText(String(dailyCap)); }, [dailyCap]);
  useEffect(() => { setGapText(String(gapSeconds / 60)); }, [gapSeconds]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-ink-200">
        <span className="text-[11px] font-medium text-ink-500 uppercase tracking-wider mr-1">Presets</span>
        <button
          type="button"
          onClick={() => applyPreset("anytime")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ink text-paper text-[12px] font-medium hover:bg-ink-800 transition-colors"
          title="Send 24/7, no schedule restrictions"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          Send now · anytime
        </button>
        <button
          type="button"
          onClick={() => applyPreset("business")}
          className="btn-ghost text-[12px]"
          title="Mon–Fri, 9am–5pm"
        >
          Business hours
        </button>
        <button
          type="button"
          onClick={() => applyPreset("weekdays")}
          className="btn-ghost text-[12px]"
          title="Mon–Fri, 8am–6pm"
        >
          Weekdays 8–6
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-6">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Send only on</div>
          <div className="space-y-1.5">
            {WEEKDAYS.map((k) => {
              const d = schedule[k];
              return (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 w-28">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => patchDay(k, { enabled: e.target.checked })}
                      className="accent-ink"
                    />
                    <span>{WEEKDAY_LABEL[k]}</span>
                  </label>
                  <input
                    type="time"
                    value={d.start}
                    onChange={(e) => patchDay(k, { start: e.target.value })}
                    disabled={!d.enabled}
                    className="input w-[8.5rem] py-1 text-sm disabled:bg-ink-50 disabled:text-ink-400"
                  />
                  <span className="text-ink-400 text-xs">to</span>
                  <input
                    type="time"
                    value={d.end}
                    onChange={(e) => patchDay(k, { end: e.target.value })}
                    disabled={!d.enabled}
                    className="input w-[8.5rem] py-1 text-sm disabled:bg-ink-50 disabled:text-ink-400"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 md:min-w-[240px]">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Sending rate</div>
          <div>
            <label className="text-sm block">Max emails per day</label>
            <input
              type="number"
              min={1}
              max={2000}
              className="input mt-1"
              value={dailyCapText}
              onChange={(e) => {
                setDailyCapText(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 2000) onDailyCap(Math.round(n));
              }}
              onBlur={() => {
                const n = Number(dailyCapText);
                const v = Number.isFinite(n) && n >= 1 ? Math.min(2000, Math.round(n)) : 1;
                setDailyCapText(String(v));
                onDailyCap(v);
              }}
            />
          </div>
          <div>
            <label className="text-sm block">Delay between emails</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="input"
                value={gapText}
                onChange={(e) => {
                  setGapText(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0.5 && n <= 120) onGapSeconds(Math.round(n * 60));
                }}
                onBlur={() => {
                  const n = Number(gapText);
                  const v = Number.isFinite(n) && n >= 0.5 ? Math.min(120, n) : 2;
                  setGapText(String(v));
                  onGapSeconds(Math.round(v * 60));
                }}
              />
              <span className="text-sm text-ink-500">minutes</span>
            </div>
          </div>
          <div className="rounded-md bg-surface border border-ink-200 p-3 text-xs text-ink-600 space-y-1.5">
            <div className="font-medium text-ink">Summary</div>
            {enabledCount === 0 ? (
              <div>No days enabled — the campaign will never send.</div>
            ) : (
              <div>
                Capacity: up to <b className="text-ink">{effectivePerWeek.toLocaleString()}</b> emails per week ({enabledCount} {enabledCount === 1 ? "day" : "days"} active).
              </div>
            )}
            {totalRecipients && totalRecipients > 0 && enabledCount > 0 && (
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-ink-100 text-ink-700">
                <svg className="w-3 h-3 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>
                  For your <b className="text-ink">{totalRecipients.toLocaleString()}</b> recipients: <b className="text-ink">{formatEta(totalRecipients)}</b>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_SCHEDULE };

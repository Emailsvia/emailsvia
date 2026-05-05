"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string; // "YYYY-MM-DDTHH:mm" (datetime-local format)
  onChange: (v: string) => void;
  placeholder?: string;
};

function pad(n: number) { return String(n).padStart(2, "0"); }

function formatDisplay(v: string) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  return `${date} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalIso(d: Date, h: number, m: number) {
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${mo}-${day}T${pad(h)}:${pad(m)}`;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DateTimePicker({ value, onChange, placeholder = "Pick a date & time" }: Props) {
  const [open, setOpen] = useState(false);
  const initial = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(value ? initial : null);
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());
  const ref = useRef<HTMLDivElement>(null);

  // Keep internal state in sync when value changes externally
  useEffect(() => {
    if (!value) { setSelectedDate(null); return; }
    const d = new Date(value);
    if (isNaN(d.getTime())) return;
    setSelectedDate(d);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setHour(d.getHours());
    setMinute(d.getMinutes());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function apply() {
    if (!selectedDate) return;
    onChange(toLocalIso(selectedDate, hour, minute));
    setOpen(false);
  }

  function clear() {
    onChange("");
    setSelectedDate(null);
    setOpen(false);
  }

  function today() {
    const n = new Date();
    setSelectedDate(n);
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
    setHour(n.getHours());
    setMinute(n.getMinutes());
  }

  function shiftMonth(delta: number) {
    const m = viewMonth + delta;
    if (m < 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else if (m > 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(m);
  }

  // Build 42-cell grid (6 rows × 7 cols), Monday-start
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(viewYear, viewMonth, 1 - startOffset + i));
  }

  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="field-boxed text-left flex items-center justify-between w-full cursor-pointer hover:border-ink-300"
      >
        <span className={value ? "text-ink" : "text-ink-400"}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <svg className="w-4 h-4 text-ink-500 shrink-0 ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1.5 sheet p-3 shadow-lg" style={{ minWidth: 300 }}>
          {/* month nav */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold">{MONTHS[viewMonth]}</span>
              <span className="text-[13px] text-ink-500">{viewYear}</span>
            </div>
            <div className="flex gap-0.5">
              <button type="button" onClick={() => shiftMonth(-1)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-hover transition-colors" aria-label="Previous month">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button type="button" onClick={() => shiftMonth(1)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-hover transition-colors" aria-label="Next month">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>

          {/* calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-[10px] font-medium text-ink-400 uppercase tracking-wider text-center py-1">{w}</div>
            ))}
            {cells.map((d, i) => {
              const isSel = selectedDate && sameDay(d, selectedDate);
              const isToday = sameDay(d, now);
              const isCurMonth = d.getMonth() === viewMonth;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={[
                    "h-8 w-full text-[12px] rounded transition-colors relative",
                    isSel ? "bg-ink text-paper font-medium" : "hover:bg-hover",
                    !isSel && !isCurMonth ? "text-ink-400" : "",
                    !isSel && isCurMonth ? "text-ink" : "",
                    isToday && !isSel ? "font-semibold" : "",
                  ].join(" ")}
                >
                  {d.getDate()}
                  {isToday && !isSel && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-ink" />
                  )}
                </button>
              );
            })}
          </div>

          {/* time */}
          <div className="mt-3 pt-3 border-t border-ink-100 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <input
              type="number"
              min={0}
              max={23}
              value={pad(hour)}
              onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              className="field-boxed !py-1 !px-2 w-12 text-[13px] text-center"
              aria-label="Hour"
            />
            <span className="text-ink-400">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={pad(minute)}
              onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
              className="field-boxed !py-1 !px-2 w-12 text-[13px] text-center"
              aria-label="Minute"
            />
            <button type="button" onClick={today} className="btn-quiet text-[12px] ml-auto">Now</button>
          </div>

          {/* actions */}
          <div className="mt-3 pt-3 border-t border-ink-100 flex items-center justify-between">
            <button type="button" onClick={clear} className="btn-quiet text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700">Clear</button>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setOpen(false)} className="btn-quiet text-[12px]">Cancel</button>
              <button type="button" onClick={apply} disabled={!selectedDate} className="btn-accent text-[12px] !py-1 !px-3">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

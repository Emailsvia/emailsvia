import type { Schedule, WeekdayKey } from "@/lib/supabase";

export const WEEKDAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function zonedParts(now: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = (parts.weekday || "").toLowerCase().slice(0, 3) as WeekdayKey;
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  return { weekday, hour, minute };
}

function hmToMinutes(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function inWindow(
  now: Date,
  tz: string,
  schedule: Schedule | null,
  fallbackStart: number,
  fallbackEnd: number
) {
  const { weekday, hour, minute } = zonedParts(now, tz);
  const totalMin = hour * 60 + minute;

  if (schedule && schedule[weekday]) {
    const d = schedule[weekday];
    if (!d.enabled) return false;
    return totalMin >= hmToMinutes(d.start) && totalMin < hmToMinutes(d.end);
  }

  return hour >= fallbackStart && hour < fallbackEnd;
}

export function dayKey(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

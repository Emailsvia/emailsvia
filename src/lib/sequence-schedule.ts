// Follow-up due-time math. Pure — shared by tick and unit checks.

export type DelayUnit = "days" | "business_days";

// Spread follow-ups over up to this many minutes so a batch of first sends
// doesn't turn into a burst of follow-ups at the same minute days later.
export const FOLLOW_UP_JITTER_MINUTES = 90;

function weekdayIn(d: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// `from` + delay. For business_days, whole days are walked one calendar day
// at a time and only Mon–Fri (in `tz`) count; a fractional remainder is
// added as hours. If the result lands on a weekend it rolls to Monday.
export function addDelay(
  from: Date,
  delayDays: number,
  unit: DelayUnit | null | undefined,
  tz: string
): Date {
  const DAY = 86_400_000;
  if (unit !== "business_days") return new Date(from.getTime() + delayDays * DAY);
  let t = from.getTime();
  let whole = Math.floor(delayDays);
  const frac = delayDays - whole;
  while (whole > 0) {
    t += DAY;
    const wd = weekdayIn(new Date(t), tz);
    if (wd !== 0 && wd !== 6) whole--;
  }
  t += frac * DAY;
  // Never land on a weekend (guard against DST-edge loops with a cap).
  for (let i = 0; i < 3; i++) {
    const wd = weekdayIn(new Date(t), tz);
    if (wd !== 0 && wd !== 6) break;
    t += DAY;
  }
  return new Date(t);
}

export function withJitter(d: Date, rand: () => number = Math.random): Date {
  return new Date(d.getTime() + Math.floor(rand() * FOLLOW_UP_JITTER_MINUTES) * 60_000);
}

// Consumer mailbox providers: a reply from one @gmail.com address says
// nothing about other @gmail.com recipients, so never group these.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "zoho.com", "zohomail.in", "gmx.com", "gmx.de", "web.de", "mail.com", "yandex.com",
  "yandex.ru", "rediffmail.com", "qq.com", "163.com", "126.com", "hey.com", "fastmail.com",
]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

export function isCompanyDomain(domain: string | null): domain is string {
  return !!domain && !FREE_MAIL_DOMAINS.has(domain);
}

import "server-only";
import * as chrono from "chrono-node";

// Dates people put in replies, turned into when to write next:
//   - out-of-office: "I'm back on Monday 14 Oct" → resume the day after.
//   - "not now": "circle back in Q3" / "try again in 3 months" → then.
// chrono-node handles the phrasing; everything here is about picking the
// right date and keeping it sane (never in the past, never absurdly far).

const DAY = 86_400_000;

// Calendar quarters chrono doesn't know: "Q3", "next quarter".
function quarterDate(text: string, ref: Date): Date | null {
  const q = text.match(/\bQ([1-4])(?:\s*(?:'|20)?(\d{2}))?\b/i);
  if (q) {
    const quarter = Number(q[1]);
    let year = q[2] ? 2000 + Number(q[2]) : ref.getUTCFullYear();
    const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1, 9));
    if (!q[2] && start.getTime() < ref.getTime()) {
      year += 1;
      return new Date(Date.UTC(year, (quarter - 1) * 3, 1, 9));
    }
    return start;
  }
  if (/\bnext quarter\b/i.test(text)) {
    const nextQ = Math.floor(ref.getUTCMonth() / 3) + 1;
    return new Date(Date.UTC(ref.getUTCFullYear() + (nextQ > 3 ? 1 : 0), (nextQ % 4) * 3, 1, 9));
  }
  if (/\b(next|new) year\b/i.test(text)) return new Date(Date.UTC(ref.getUTCFullYear() + 1, 0, 8, 9));
  return null;
}

function futureDates(text: string, ref: Date): Date[] {
  return chrono
    .parse(text, ref, { forwardDate: true })
    .map((r) => r.start.date())
    .filter((d) => d.getTime() > ref.getTime() + 3_600_000);
}

// Out-of-office: the return date from the auto-reply, or null (caller falls
// back to its fixed pause). We resume the day after they're back, so the
// follow-up doesn't land in a pile of first-day-back mail. Up to a year out:
// someone on months of leave shouldn't be emailed a week later.
export function oooResumeDate(subject: string | null, body: string | null, receivedAt: Date): Date | null {
  const text = `${subject ?? ""}\n${body ?? ""}`.slice(0, 2000);
  // Prefer the phrase that says when they're back.
  const near = text.match(
    /(?:back|return(?:ing)?|in the office|available|away|out(?: of (?:the )?office)?)[^.\n]{0,80}?(?:on|until|till|through|thru|from|after|by)\s+([^.\n]{3,60})/i
  );
  const candidates = [
    ...(near ? futureDates(near[1], receivedAt) : []),
    ...futureDates(text, receivedAt),
  ];
  const back = candidates.find((d) => d.getTime() - receivedAt.getTime() <= 365 * DAY);
  if (!back) return null;
  const resume = new Date(back.getTime() + DAY);
  resume.setUTCHours(Math.max(resume.getUTCHours(), 9), 0, 0, 0);
  return resume;
}

// "Not now": when they suggested we get back in touch, or null. 7–365 days.
export function notNowDate(body: string | null, receivedAt: Date): Date | null {
  const text = (body ?? "").slice(0, 2000);
  if (!text.trim()) return null;
  const candidates = [quarterDate(text, receivedAt), ...futureDates(text, receivedAt)].filter(
    (d): d is Date => !!d
  );
  const ok = candidates.find((d) => {
    const ahead = d.getTime() - receivedAt.getTime();
    return ahead >= 7 * DAY && ahead <= 365 * DAY;
  });
  return ok ?? null;
}

// Conservative 14-day warmup ramp for new Gmail senders.
// Day 1 = 10, ..., Day 14 = 400; after that, the sender's normal daily_cap applies.
const RAMP = [10, 20, 40, 60, 100, 150, 200, 250, 300, 350, 400, 400, 400, 400];

export type WarmupSender = {
  warmup_enabled?: boolean | null;
  warmup_started_at?: string | null;
};

// Returns the warmup-imposed cap for a sender today, or Infinity if warmup is
// off / complete. The tick takes min(campaign.daily_cap, warmupCap).
export function warmupCapForSender(sender: WarmupSender, now: Date = new Date()): number {
  if (!sender.warmup_enabled || !sender.warmup_started_at) return Infinity;
  const startMs = new Date(sender.warmup_started_at).getTime();
  if (!Number.isFinite(startMs)) return Infinity;
  const daysSinceStart = Math.floor((now.getTime() - startMs) / 86_400_000);
  if (daysSinceStart < 0) return 0; // warmup not yet started
  if (daysSinceStart >= RAMP.length) return Infinity;
  return RAMP[daysSinceStart];
}

export function warmupDayInfo(sender: WarmupSender, now: Date = new Date()) {
  if (!sender.warmup_enabled || !sender.warmup_started_at) {
    return { active: false, day: null, cap: null, remainingDays: 0 };
  }
  const startMs = new Date(sender.warmup_started_at).getTime();
  const daysSinceStart = Math.max(0, Math.floor((now.getTime() - startMs) / 86_400_000));
  const active = daysSinceStart < RAMP.length;
  return {
    active,
    day: active ? daysSinceStart + 1 : RAMP.length,
    cap: active ? RAMP[daysSinceStart] : null,
    remainingDays: Math.max(0, RAMP.length - daysSinceStart),
  };
}

export const WARMUP_RAMP = RAMP;

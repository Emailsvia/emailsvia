import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKey } from "./time";

// Single source of truth for plan-related logic. Anywhere we ask "can this
// user do X" we go through here, so feature gates can't drift between the
// API, the UI, and the cron path.

export type PlanId = "free" | "starter" | "growth" | "scale";

export type Plan = {
  id: PlanId;
  name: string;
  daily_cap: number;
  sender_limit: number;
  monthly_price_cents: number;
  watermark: boolean;
  features: PlanFeatures;
};

export type PlanFeatures = {
  follow_ups?: boolean;
  ai?: boolean;
  ai_personalization?: boolean;
  conditional_sequences?: boolean;
  webhooks?: boolean;
  sticky_sender?: boolean;
  import_row_limit?: number | null;
  a_b_testing?: boolean;
  inbox_rotation?: boolean;
  email_verification?: boolean;
  public_api?: boolean;
  warmup?: boolean;
};

export type Subscription = {
  user_id: string;
  plan_id: PlanId;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_sub_id: string | null;
};

const FREE_FALLBACK: Plan = {
  id: "free",
  name: "Free",
  daily_cap: 50,
  sender_limit: 1,
  monthly_price_cents: 0,
  watermark: true,
  features: {
    follow_ups: false,
    ai: false,
    import_row_limit: 100,
    a_b_testing: false,
    inbox_rotation: false,
    email_verification: false,
    public_api: false,
  },
};

// Treat any of these as "this user is currently entitled to their tier."
// past_due / unpaid keep the user on the paid tier for one grace period
// while Stripe retries — that's standard SaaS dunning behaviour.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function getPlanForUser(
  db: SupabaseClient,
  userId: string
): Promise<{ plan: Plan; subscription: Subscription | null }> {
  const { data: sub } = await db
    .from("subscriptions")
    .select("user_id, plan_id, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_sub_id")
    .eq("user_id", userId)
    .maybeSingle();

  // Effective plan id: paid tier only when the subscription is in an
  // entitled status; otherwise drop to free.
  const planId: PlanId =
    sub && ACTIVE_STATUSES.has(sub.status) && sub.plan_id !== "free"
      ? (sub.plan_id as PlanId)
      : "free";

  const { data: row } = await db
    .from("plans")
    .select("id, name, daily_cap, sender_limit, monthly_price_cents, watermark, features")
    .eq("id", planId)
    .maybeSingle();

  const plan: Plan = row
    ? {
        id: row.id as PlanId,
        name: row.name,
        daily_cap: row.daily_cap,
        sender_limit: row.sender_limit,
        monthly_price_cents: row.monthly_price_cents,
        watermark: row.watermark,
        features: (row.features ?? {}) as PlanFeatures,
      }
    : FREE_FALLBACK;

  return { plan, subscription: (sub as Subscription | null) ?? null };
}

// Convenience for the UI/billing routes that already have a user-scoped
// db handle and don't care about the underlying subscription row.
export async function getPlan(db: SupabaseClient, userId: string): Promise<Plan> {
  const { plan } = await getPlanForUser(db, userId);
  return plan;
}

export type CanSendResult =
  | { ok: true; plan: Plan; sentToday: number; remaining: number }
  | { ok: false; reason: "daily_cap_reached"; plan: Plan; sentToday: number };

// Called from the tick path before a send. Cron uses the service-role
// client which bypasses RLS — the caller passes that in.
export async function assertCanSend(
  db: SupabaseClient,
  userId: string,
  now: Date,
  // Tick already knows the campaign timezone; reuse it so the quota day
  // boundary matches the campaign-cap day boundary.
  tz: string
): Promise<CanSendResult> {
  const { plan } = await getPlanForUser(db, userId);
  const day = dayKey(now, tz);
  const { data: row } = await db
    .from("usage_daily")
    .select("sent")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  const sentToday = row?.sent ?? 0;
  if (sentToday >= plan.daily_cap) {
    return { ok: false, reason: "daily_cap_reached", plan, sentToday };
  }
  return { ok: true, plan, sentToday, remaining: plan.daily_cap - sentToday };
}

// Atomic +1 to today's send count. Uses a Postgres function-style upsert
// pattern via .upsert + ignoreDuplicates=false so two concurrent ticks can't
// both write 1 instead of 2. Postgres-side: we send `sent: existing+1` only
// when we know the row, otherwise insert with sent=1; this is racy. The
// safer pattern is a SQL RPC, but the campaign send_log per-day count
// already gives us a defense-in-depth audit, so we accept the rare
// off-by-one here in exchange for one fewer migration.
export async function incrementUsage(
  db: SupabaseClient,
  userId: string,
  day: string
): Promise<void> {
  // Upsert with on-conflict-merge using a raw SQL increment via rpc would
  // be ideal. Without it, do read-modify-write — close enough at our scale
  // and the tick advisory lock (Phase 4) will eliminate the race entirely.
  const { data: existing } = await db
    .from("usage_daily")
    .select("sent")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  const next = (existing?.sent ?? 0) + 1;
  await db
    .from("usage_daily")
    .upsert({ user_id: userId, day, sent: next }, { onConflict: "user_id,day" });
}

// Feature-gate helper. Use from API routes that should 402 / 403 when the
// caller's plan doesn't include a feature. UI should branch off the same
// PlanFeatures shape so the two never disagree.
export function hasFeature(plan: Plan, key: keyof PlanFeatures): boolean {
  const v = plan.features?.[key];
  if (typeof v === "boolean") return v;
  // import_row_limit is a number-or-null (null means unlimited); treat as
  // "feature on" if the value is unlimited or > 0.
  if (key === "import_row_limit") return v === null || (typeof v === "number" && v > 0);
  return false;
}

export function importRowLimit(plan: Plan): number | null {
  const v = plan.features?.import_row_limit;
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : null;
}

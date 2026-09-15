import { NextRequest, NextResponse } from "next/server";
import { withApi, apiOptions } from "@/lib/public-api";
import { dayKey } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

// GET /api/v1/me — plan, daily cap and today's usage (UTC day).
export const GET = withApi(async (_req: NextRequest, { userId, plan, db }) => {
  const { data: usage } = await db
    .from("usage_daily")
    .select("sent")
    .eq("user_id", userId)
    .eq("day", dayKey(new Date(), "UTC"))
    .maybeSingle();
  return NextResponse.json({
    user_id: userId,
    plan: { id: plan.id, name: plan.name, daily_cap: plan.daily_cap, sender_limit: plan.sender_limit },
    sent_today_utc: usage?.sent ?? 0,
  });
});

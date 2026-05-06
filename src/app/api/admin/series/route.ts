import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Time-series endpoint for the operator dashboard. Returns one row per day
// for the requested window: sends, errors, signups. Computed in JS from
// raw rows because Supabase doesn't expose date_trunc through PostgREST and
// we don't want to ship per-day RPCs for a single page.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !isAdminUser(u.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const days = Math.max(7, Math.min(90, Number(req.nextUrl.searchParams.get("days") ?? 30)));
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const db = supabaseAdmin();

  const [sendRows, signupRows, replyRows] = await Promise.all([
    db
      .from("send_log")
      .select("sent_at, error_class")
      .gte("sent_at", sinceIso)
      .range(0, 99999),
    db
      .from("subscriptions")
      .select("created_at, plan_id")
      .gte("created_at", sinceIso)
      .range(0, 9999),
    db
      .from("replies")
      .select("created_at, intent")
      .gte("created_at", sinceIso)
      .range(0, 9999),
  ]);

  const buckets = new Map<string, {
    day: string;
    sends: number;
    errors: number;
    signups_free: number;
    signups_paid: number;
    replies: number;
    interested: number;
  }>();

  // Pre-fill so empty days still render a zero on the chart.
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      day: key,
      sends: 0,
      errors: 0,
      signups_free: 0,
      signups_paid: 0,
      replies: 0,
      interested: 0,
    });
  }

  for (const r of sendRows.data ?? []) {
    const key = (r.sent_at as string).slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (r.error_class) b.errors += 1;
    else b.sends += 1;
  }
  for (const r of signupRows.data ?? []) {
    const key = (r.created_at as string).slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (r.plan_id === "free") b.signups_free += 1;
    else b.signups_paid += 1;
  }
  for (const r of replyRows.data ?? []) {
    const key = (r.created_at as string).slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    b.replies += 1;
    if (r.intent === "interested") b.interested += 1;
  }

  const series = Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
  return NextResponse.json({ days, series });
}

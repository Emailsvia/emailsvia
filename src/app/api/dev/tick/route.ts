import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// DEV ONLY. Lets the in-app "Run tick" button trigger the cron handler
// without a real scheduler hitting localhost. Server-side proxies to
// /api/tick with the CRON_SECRET so the secret never reaches the browser.
//
// Returns 404 in production — the route literally does not respond there.
//
// Body params (optional):
//   { burst?: number = 1 }  — call /api/tick up to `burst` times (max 30),
//   stopping early if the tick returns anything other than "sent" (e.g.
//   "all_throttled", "claim_lost", "campaign_finished"). Useful for
//   processing a small list in one click without 60 curl calls.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cron = process.env.CRON_SECRET;
  if (!cron) {
    return NextResponse.json(
      { error: "CRON_SECRET not set in .env.local" },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { burst?: number };
  const burst = Math.max(1, Math.min(30, Math.floor(body.burst ?? 1)));

  const tickUrl = new URL("/api/tick", req.nextUrl.origin);
  const results: Array<{ status?: string; to?: string; [k: string]: unknown }> = [];

  for (let i = 0; i < burst; i++) {
    const r = await fetch(tickUrl, {
      headers: { Authorization: `Bearer ${cron}` },
      cache: "no-store",
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    results.push(data as { status?: string });
    // Stop when there's nothing left to send. "sent" / "send_failed_will_retry"
    // mean we made progress and should loop again; everything else means
    // we've hit a wall (gap, cap, no recipients, lock held by another tick).
    const status = String(data.status ?? "");
    if (status !== "sent" && status !== "send_failed_will_retry") break;
    // Tiny jitter so we don't immediately collide with the per-campaign
    // gap_seconds check (which the tick enforces).
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  return NextResponse.json({
    ok: true,
    iterations: results.length,
    sent: sentCount,
    last: results[results.length - 1] ?? null,
  });
}

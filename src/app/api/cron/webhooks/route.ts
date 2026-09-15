import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cronBearerOk } from "@/lib/tokens";
import { deliverDue } from "@/lib/webhooks";
import { retryFailedSyncs } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every minute: deliver queued webhook events (the send loop only queues),
// retry failed deliveries on their backoff schedule, and retry failed
// HubSpot / Pipedrive / Slack pushes.
const LOCK_KEY = "emailsvia:webhooks";

export async function GET(req: NextRequest) {
  if (!cronBearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: gotLock, error: lockErr } = await db.rpc("try_tick_lock", { lock_key: LOCK_KEY, ttl_seconds: 70 });
  if (!lockErr && gotLock !== true) return NextResponse.json({ status: "lock_held" });
  try {
    const out = await deliverDue(db, { limit: 200, budgetMs: 30_000 });
    // Same cadence: retry failed CRM / Slack pushes.
    const integrations = await retryFailedSyncs(db, { limit: 50, budgetMs: 15_000 });
    return NextResponse.json({ status: "ok", ...out, integrations });
  } finally {
    if (!lockErr) await db.rpc("release_tick_lock", { lock_key: LOCK_KEY });
  }
}

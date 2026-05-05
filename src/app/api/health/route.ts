import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness probe. Vercel + uptime monitors hit this to confirm the app is
// responsive AND the database round-trip works. Returns 200 when both are
// healthy, 503 when DB is down. Public — no auth — but only emits boolean
// status, not version/build/secrets.
export async function GET() {
  const start = Date.now();
  let dbOk = false;
  let dbError: string | null = null;
  try {
    // Cheapest possible read: count(*) on a tiny table with a server-side
    // limit. plans is seeded at migration time so this always returns ≥4.
    const { error, count } = await supabaseAdmin()
      .from("plans")
      .select("*", { count: "exact", head: true });
    if (error) dbError = error.message;
    else if ((count ?? 0) === 0) dbError = "plans empty (migrations not applied?)";
    else dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const ok = dbOk;
  return NextResponse.json(
    {
      ok,
      db: dbOk ? "ok" : "fail",
      db_error: dbError,
      latency_ms: Date.now() - start,
    },
    { status: ok ? 200 : 503 }
  );
}

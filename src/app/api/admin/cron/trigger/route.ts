import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { isAdminUser, logAdminAction } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual cron trigger. Operator-side button to fire /api/tick or
// /api/check-replies on demand without waiting for the next pg_cron pulse.
// Re-uses the CRON_SECRET so the downstream handler can authenticate.
export async function POST(req: NextRequest) {
  const me = await getUser();
  if (!me || !isAdminUser(me.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { target?: string };
  const target = body.target ?? "tick";
  if (!["tick", "check-replies"].includes(target)) {
    return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "cron_secret_missing" }, { status: 500 });
  }

  const baseUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const url = `${baseUrl}/api/${target}`;
  const started = Date.now();
  let result: { ok: boolean; status: number; body: unknown };
  try {
    const r = await fetch(url, {
      method: target === "tick" ? "GET" : "POST",
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // text fallback fine
    }
    result = { ok: r.ok, status: r.status, body: parsed };
  } catch (e) {
    result = {
      ok: false,
      status: 0,
      body: { error: e instanceof Error ? e.message : "unknown" },
    };
  }

  await logAdminAction(me.id, `cron.trigger.${target}`, null, {
    duration_ms: Date.now() - started,
    result,
  });

  return NextResponse.json({
    target,
    duration_ms: Date.now() - started,
    ...result,
  });
}

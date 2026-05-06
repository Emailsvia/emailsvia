import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser, logAdminAction } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle a tenant's suspended_at. Suspended tenants can still log in (so
// they can fix billing or contact us) but the cron path skips their
// campaigns and the API rejects writes that would queue more sends.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me || !isAdminUser(me.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { suspend?: boolean };
  const suspend = body.suspend !== false; // default true
  const db = supabaseAdmin();

  const { error } = await db
    .from("subscriptions")
    .update({ suspended_at: suspend ? new Date().toISOString() : null })
    .eq("user_id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await logAdminAction(me.id, suspend ? "user.suspend" : "user.unsuspend", {
    type: "user",
    id,
  });

  return NextResponse.json({ ok: true });
}

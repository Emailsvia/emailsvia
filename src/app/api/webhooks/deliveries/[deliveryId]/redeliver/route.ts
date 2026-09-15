import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/auth-server";
import { redeliver } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Send one delivery again now. webhook_deliveries is read-only for users,
// so this runs as service role with an explicit owner check in redeliver().
export async function POST(_req: NextRequest, ctx: { params: Promise<{ deliveryId: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { deliveryId } = await ctx.params;
  const ok = await redeliver(supabaseAdmin(), u.id, deliveryId);
  return NextResponse.json({ ok });
}

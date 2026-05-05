import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { mapWithLimit, validateEmail } from "@/lib/email-validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Validates pending recipients' emails via DNS MX lookup.
// Marks invalid ones as status='bounced' with a helpful error message.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const { data: pending } = await db
    .from("recipients")
    .select("id, email, domain")
    .eq("campaign_id", id)
    .eq("status", "pending")
    .limit(300);

  if (!pending || pending.length === 0) return NextResponse.json({ checked: 0, invalid: 0 });

  const results = await mapWithLimit(pending, 20, async (r) => ({
    id: r.id,
    email: r.email,
    result: await validateEmail(r.email),
  }));

  const bad = results.filter((r) => !r.result.ok);
  if (bad.length > 0) {
    // batch-update invalid ones
    for (const b of bad) {
      await db
        .from("recipients")
        .update({ status: "bounced", error: `invalid: ${b.result.ok === false ? b.result.reason : "unknown"}` })
        .eq("id", b.id);
    }
  }

  return NextResponse.json({
    checked: results.length,
    invalid: bad.length,
    invalid_emails: bad.slice(0, 20).map((b) => b.email),
  });
}

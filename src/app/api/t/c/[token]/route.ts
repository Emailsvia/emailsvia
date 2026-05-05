import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const urlStr = req.nextUrl.searchParams.get("u");
  const target = urlStr && /^https?:\/\//i.test(urlStr) ? urlStr : "/";
  const id = verifyToken("c", token);
  if (id) {
    try {
      const db = supabaseAdmin();
      const { data: r } = await db
        .from("recipients")
        .select("id, campaign_id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (r) {
        await db.from("tracking_events").insert({
          recipient_id: r.id,
          campaign_id: r.campaign_id,
          user_id: r.user_id,
          kind: "click",
          url: urlStr ?? null,
          user_agent: req.headers.get("user-agent") ?? null,
        });
      }
    } catch {}
  }
  return NextResponse.redirect(target, 302);
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken, verifyClickUrl, appUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const urlStr = req.nextUrl.searchParams.get("u");
  const id = verifyToken("c", token);
  // Only follow destinations we signed at send time; anything else would make
  // this route an open redirect for anyone holding one valid click token.
  const signed =
    !!id && !!urlStr && /^https?:\/\//i.test(urlStr) &&
    verifyClickUrl(token, urlStr, req.nextUrl.searchParams.get("s"));
  if (!signed) return NextResponse.redirect(new URL("/", appUrl()), 302);
  const target = urlStr as string;
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

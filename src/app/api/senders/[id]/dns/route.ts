import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { checkDomainAuth } from "@/lib/dns-auth";
import { emailDomain } from "@/lib/sequence-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPF / DKIM / DMARC / MX report for the domain a sender's mail appears to
// come from (the send-as alias when set, since that's what receivers align).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data: sender } = await db
    .from("senders")
    .select("email, send_as_email")
    .eq("id", id)
    .maybeSingle();
  if (!sender) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const domain = emailDomain(sender.send_as_email || sender.email);
  if (!domain) return NextResponse.json({ error: "bad_sender_email" }, { status: 400 });
  const report = await checkDomainAuth(domain);
  return NextResponse.json({ report });
}

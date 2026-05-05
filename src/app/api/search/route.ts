import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Used by the command palette. Returns top matches across campaigns, senders,
// recipients and replies for a short query string. Case-insensitive, matches
// any column that's relevant.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ campaigns: [], senders: [], recipients: [], replies: [] });
  }
  const like = `%${q}%`;
  const db = await supabaseUser();

  const [campaigns, senders, recipients, replies] = await Promise.all([
    db.from("campaigns")
      .select("id, name, subject, status")
      .or(`name.ilike.${like},subject.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(8),
    db.from("senders")
      .select("id, label, email, from_name")
      .or(`label.ilike.${like},email.ilike.${like},from_name.ilike.${like}`)
      .limit(8),
    db.from("recipients")
      .select("id, name, email, company, campaign_id, status")
      .or(`name.ilike.${like},email.ilike.${like},company.ilike.${like}`)
      .limit(10),
    db.from("replies")
      .select("id, from_email, subject, snippet, campaign_id, received_at, created_at")
      .or(`from_email.ilike.${like},subject.ilike.${like},snippet.ilike.${like}`)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(8),
  ]);

  // Enrich recipients + replies with campaign names
  const campaignIds = new Set<string>();
  (recipients.data ?? []).forEach((r) => campaignIds.add(r.campaign_id));
  (replies.data ?? []).forEach((r) => r.campaign_id && campaignIds.add(r.campaign_id));
  const campaignNames = new Map<string, string>();
  if (campaignIds.size > 0) {
    const { data: cs } = await db
      .from("campaigns")
      .select("id, name")
      .in("id", Array.from(campaignIds));
    for (const c of cs ?? []) campaignNames.set(c.id, c.name);
  }

  return NextResponse.json({
    campaigns: campaigns.data ?? [],
    senders: senders.data ?? [],
    recipients: (recipients.data ?? []).map((r) => ({ ...r, campaign_name: campaignNames.get(r.campaign_id) ?? "" })),
    replies: (replies.data ?? []).map((r) => ({
      ...r,
      campaign_name: r.campaign_id ? campaignNames.get(r.campaign_id) ?? "" : "",
    })),
  });
}

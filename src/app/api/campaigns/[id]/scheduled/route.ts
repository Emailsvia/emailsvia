import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Follow-ups scheduled for people who already replied ("not now"
// re-engagement, stalled-thread nudges), for the campaign page: what's
// waiting for approval, what's coming up, and what recently happened.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data, error } = await db
    .from("scheduled_followups")
    .select(`
      id, kind, status, due_at, due_source, requires_approval, approved_at, cancel_reason, sent_at, error, created_at,
      recipient:recipients(id, name, email, company),
      email:follow_up_rule_emails(subject, template),
      rule:follow_up_rules(name)
    `)
    .eq("campaign_id", id)
    .order("due_at", { ascending: true })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

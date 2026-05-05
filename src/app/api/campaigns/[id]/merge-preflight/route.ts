import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { extractTags, missingMergeFields } from "@/lib/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pre-flight check for the campaign editor: tells the user how many pending
// rows would be skipped by strict_merge before they hit "Run". Returns one
// bucket per tag with the count and a sample of affected emails.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const { data: campaign } = await db
    .from("campaigns")
    .select("subject, template, strict_merge")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const subjectTags = extractTags(campaign.subject ?? "");
  const bodyTags = extractTags(campaign.template ?? "");
  const allTags = Array.from(new Set([...subjectTags, ...bodyTags]));

  if (allTags.length === 0) {
    return NextResponse.json({
      strict_merge: campaign.strict_merge !== false,
      tags: [],
      total_pending: 0,
      affected_total: 0,
      by_tag: [],
    });
  }

  // Only check pending rows — already-sent ones can't be retroactively
  // skipped, and follow-ups handle their own gating in the tick.
  const { data: pending } = await db
    .from("recipients")
    .select("id, email, name, company, vars")
    .eq("campaign_id", id)
    .eq("status", "pending")
    .range(0, 99999);

  const rows = pending ?? [];
  const SAMPLE = 5;
  const buckets = new Map<string, { tag: string; count: number; sample: string[] }>();
  let affectedRows = 0;

  for (const r of rows) {
    const vars = {
      ...((r.vars ?? {}) as Record<string, string>),
      Name: r.name ?? "",
      Company: r.company ?? "",
    };
    const missing = missingMergeFields(
      `${campaign.subject ?? ""}\n${campaign.template ?? ""}`,
      vars
    );
    if (missing.length > 0) affectedRows++;
    for (const tag of missing) {
      const b = buckets.get(tag) ?? { tag, count: 0, sample: [] };
      b.count++;
      if (b.sample.length < SAMPLE) b.sample.push(r.email);
      buckets.set(tag, b);
    }
  }

  const byTag = Array.from(buckets.values()).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    strict_merge: campaign.strict_merge !== false,
    tags: allTags,
    total_pending: rows.length,
    affected_total: affectedRows,
    by_tag: byTag,
  });
}

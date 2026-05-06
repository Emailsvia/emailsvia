import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// A/B test variants on a campaign. Each variant is one combination of
// (subject, template). At first-send time the tick picks a variant for
// the recipient, records `recipients.variant_id`, and uses that variant's
// content. Follow-ups inherit the recipient's pinned variant by default
// — easier mental model than "split each follow-up step too" in v1.
//
// When `campaigns.ab_winner_id` is set (manually or auto-picked once
// `ab_winner_threshold` is hit), every new send goes to the winner —
// already-sent recipients keep their original variant.

export type Variant = {
  id: string;        // user-provided short slug (eg "A", "B", "v1")
  weight: number;    // pickVariant uses weighted random; default 1
  subject: string;
  template: string;
};

export function isVariantArray(v: unknown): v is Variant[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every(
      (x) =>
        x &&
        typeof x === "object" &&
        typeof (x as Variant).id === "string" &&
        typeof (x as Variant).subject === "string" &&
        typeof (x as Variant).template === "string"
    )
  );
}

// Weighted random pick. If a winner is set, return it directly (and a
// follow-up call to find() will return undefined when the winner_id no
// longer exists in the variants array, falling back to default content).
export function pickVariant(variants: Variant[], winnerId: string | null = null): Variant | null {
  if (!isVariantArray(variants)) return null;
  if (winnerId) {
    const winner = variants.find((v) => v.id === winnerId);
    if (winner) return winner;
  }
  const totalWeight = variants.reduce((s, v) => s + Math.max(0, v.weight ?? 1), 0);
  if (totalWeight <= 0) return variants[0];
  let pick = Math.random() * totalWeight;
  for (const v of variants) {
    pick -= Math.max(0, v.weight ?? 1);
    if (pick <= 0) return v;
  }
  return variants[variants.length - 1];
}

export type VariantStat = {
  id: string;
  sent: number;
  replied: number;
  reply_rate: number;
};

// Per-variant breakdown for the campaign-detail page. Filters out
// already-failed sends so reply_rate reflects deliverable cohort.
export async function variantBreakdown(
  db: SupabaseClient,
  campaignId: string
): Promise<VariantStat[]> {
  const { data: rows } = await db
    .from("recipients")
    .select("variant_id, status")
    .eq("campaign_id", campaignId)
    .not("variant_id", "is", null)
    .range(0, 99_999);
  const buckets = new Map<string, { sent: number; replied: number }>();
  for (const r of (rows ?? []) as Array<{ variant_id: string; status: string }>) {
    const b = buckets.get(r.variant_id) ?? { sent: 0, replied: 0 };
    if (r.status === "sent" || r.status === "replied") b.sent++;
    if (r.status === "replied") b.replied++;
    buckets.set(r.variant_id, b);
  }
  const out: VariantStat[] = [];
  for (const [id, b] of buckets) {
    out.push({
      id,
      sent: b.sent,
      replied: b.replied,
      reply_rate: b.sent > 0 ? Math.round((b.replied / b.sent) * 1000) / 10 : 0,
    });
  }
  return out.sort((a, b) => b.reply_rate - a.reply_rate);
}

// Auto-pick a winner: returns the id if the lead is statistically
// material AND the volume threshold is hit. Conservative — only fires
// when the leader's reply rate is at least 50% better than the runner-up
// AND each variant has at least `threshold / variants` sends.
export function pickAutoWinner(
  stats: VariantStat[],
  threshold: number
): string | null {
  if (stats.length < 2) return null;
  const totalSent = stats.reduce((s, v) => s + v.sent, 0);
  if (totalSent < threshold) return null;
  // Each variant needs at least its fair share of the volume to be
  // judged. Stops noise-driven flips when a variant got 5 sends and
  // another got 200.
  const fairShare = threshold / stats.length;
  if (stats.some((v) => v.sent < fairShare)) return null;
  const [first, second] = stats; // already sorted desc by reply_rate
  if (first.reply_rate <= 0) return null;
  if (first.reply_rate < second.reply_rate * 1.5) return null;
  return first.id;
}

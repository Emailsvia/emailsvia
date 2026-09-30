import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDomain, isCompanyDomain } from "./sequence-schedule";
import { emitCampaignPaused } from "./events";
import { recordEvents } from "./activity";

// Company-level stop: someone at acme.com replied, so nobody else at
// acme.com in this campaign should get another email from it. Contacted
// recipients lose their pending follow-ups; not-yet-contacted ones are
// skipped. Free-mail domains are never grouped. Returns rows affected.
export async function stopDomainAfterReply(
  db: SupabaseClient,
  campaignId: string,
  replied: { id: string; email: string }
): Promise<number> {
  const domain = emailDomain(replied.email);
  if (!isCompanyDomain(domain)) return 0;
  // ilike wildcards: escape _ and % that could appear in odd domains.
  const pattern = `%@${domain.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  const [{ data: sent }, { data: pending }] = await Promise.all([
    db
      .from("recipients")
      .update({ next_follow_up_at: null, stop_reason: "domain_replied" })
      .eq("campaign_id", campaignId)
      .eq("status", "sent")
      .neq("id", replied.id)
      .ilike("email", pattern)
      .not("next_follow_up_at", "is", null)
      .select("id, user_id, follow_up_count"),
    db
      .from("recipients")
      .update({ status: "skipped", stop_reason: "domain_replied", next_retry_at: null })
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .neq("id", replied.id)
      .ilike("email", pattern)
      .select("id, user_id"),
  ]);
  const detail = { reason: "domain_replied", colleague: replied.email, colleague_recipient_id: replied.id };
  await recordEvents(db, [
    ...(sent ?? []).map((r) => ({
      user_id: r.user_id,
      campaign_id: campaignId,
      recipient_id: r.id,
      type: "sequence_stopped" as const,
      data: detail,
      dedupe_key: `stopped:domain_replied:${r.follow_up_count ?? 0}`,
    })),
    ...(pending ?? []).map((r) => ({
      user_id: r.user_id,
      campaign_id: campaignId,
      recipient_id: r.id,
      type: "skipped" as const,
      data: detail,
      dedupe_key: "skipped:domain_replied",
    })),
  ]);
  return (sent?.length ?? 0) + (pending?.length ?? 0);
}

// Per-user do-not-contact check: exact address or its whole domain.
export async function findSuppression(
  db: SupabaseClient,
  userId: string,
  email: string
): Promise<{ kind: "email" | "domain"; reason: string } | null> {
  const lower = email.trim().toLowerCase();
  const domain = emailDomain(lower);
  const { data } = await db
    .from("suppressions")
    .select("kind, value, reason")
    .eq("user_id", userId)
    .or(
      domain
        ? `and(kind.eq.email,value.eq."${lower}"),and(kind.eq.domain,value.eq."${domain}")`
        : `and(kind.eq.email,value.eq."${lower}")`
    )
    .limit(1)
    .maybeSingle();
  return data ? { kind: data.kind as "email" | "domain", reason: data.reason } : null;
}

export async function suppressEmail(
  db: SupabaseClient,
  userId: string,
  email: string,
  reason: "bounced" | "manual" | "not_interested" | "import",
  campaignId?: string | null
): Promise<void> {
  await db.from("suppressions").upsert(
    {
      user_id: userId,
      kind: "email",
      value: email.trim().toLowerCase(),
      reason,
      source_campaign_id: campaignId ?? null,
    },
    { onConflict: "user_id,kind,value", ignoreDuplicates: true }
  );
}

// Bounce Shield: once a campaign has contacted BOUNCE_SHIELD_MIN_SENT people,
// pause it if more than BOUNCE_SHIELD_MAX_RATE of them bounced. A dirty list
// burns the sender's domain reputation fast (providers start junking or
// rejecting above ~2%), so we stop and let the user clean the list.
export const BOUNCE_SHIELD_MIN_SENT = 40;
export const BOUNCE_SHIELD_MAX_RATE = 0.05;

export async function maybePauseForBounces(
  db: SupabaseClient,
  campaignId: string
): Promise<boolean> {
  const count = async (statuses: string[]) => {
    const { count } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", statuses);
    return count ?? 0;
  };
  const [contacted, bounced] = await Promise.all([
    count(["sent", "replied", "bounced", "unsubscribed"]),
    count(["bounced"]),
  ]);
  if (contacted < BOUNCE_SHIELD_MIN_SENT || bounced / contacted <= BOUNCE_SHIELD_MAX_RATE) return false;
  const { data } = await db
    .from("campaigns")
    .update({ status: "paused", paused_reason: "bounce_rate" })
    .eq("id", campaignId)
    .eq("status", "running")
    .select("id, user_id, name");
  if (data?.[0]) await emitCampaignPaused(db, data[0], "bounce_rate");
  return (data?.length ?? 0) > 0;
}

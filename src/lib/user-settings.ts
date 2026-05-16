import { supabaseAdmin } from "./supabase";

export type UserSettings = {
  tracking_enabled_default: boolean;
  poll_replies: boolean;
};

const DEFAULTS: UserSettings = {
  tracking_enabled_default: false,
  poll_replies: false,
};

// Returns the user's saved settings, or the all-off defaults when no row
// exists yet. Missing row is the common case — users only get inserted on
// first PATCH from /app/settings.
export async function loadUserSettings(userId: string): Promise<UserSettings> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("user_settings")
    .select("tracking_enabled_default, poll_replies")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULTS;
  return {
    tracking_enabled_default: !!data.tracking_enabled_default,
    poll_replies: !!data.poll_replies,
  };
}

// Bulk-load `poll_replies` for a set of user ids. Used by /api/check-replies
// to skip senders whose owner hasn't opted into reply polling. Returns a
// Set of user ids that have it ON.
export async function loadReplyPollUserIds(userIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data } = await db
    .from("user_settings")
    .select("user_id")
    .in("user_id", unique)
    .eq("poll_replies", true);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

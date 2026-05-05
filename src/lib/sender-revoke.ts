import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSenderRevokedNotice } from "./transactional";
import { appUrl } from "./tokens";

// Mark a sender as revoked AND fire the user notification — but only when
// this is the first detection (status was 'ok' before). Idempotent across
// repeated calls so the tick / check-replies / refresh-tokens cron paths
// can all call it without spamming the user.
//
// Uses a conditional UPDATE that only matches rows where oauth_status='ok',
// so the second tick that sees the same revoked state finds zero rows and
// skips the email.
export async function markSenderRevoked(
  db: SupabaseClient,
  args: { sender_id: string; sender_email: string; user_id: string }
): Promise<{ flipped: boolean; emailed: boolean }> {
  const { data, error } = await db
    .from("senders")
    .update({ oauth_status: "revoked" })
    .eq("id", args.sender_id)
    .eq("oauth_status", "ok")
    .select("id");
  if (error || !data || data.length === 0) {
    // Either the row was already revoked (someone else flipped it first) or
    // the update raced. Either way, no notification needed.
    return { flipped: false, emailed: false };
  }

  const userEmail = await fetchUserEmail(db, args.user_id);
  if (!userEmail) return { flipped: true, emailed: false };

  const res = await sendSenderRevokedNotice({
    to: userEmail,
    senderEmail: args.sender_email,
    appUrl: appUrl(),
  });
  return { flipped: true, emailed: res.ok };
}

async function fetchUserEmail(db: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

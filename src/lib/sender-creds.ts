import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto";
import { serversFromRow, SENDER_SERVER_COLUMNS, type SenderCreds } from "./mail";
import type { RefreshResult } from "./gmail";

// Load a sender row and turn it into SenderCreds for sendMail / inbox reads.
// `db` decides the scope: supabaseUser() for user-initiated routes (RLS
// hides other tenants' senders), supabaseAdmin() for cron paths.
export async function loadSenderCreds(
  db: SupabaseClient,
  senderId: string
): Promise<{ id: string; userId: string; email: string; oauthRevoked: boolean; creds: SenderCreds | null } | null> {
  const { data: row } = await db
    .from("senders")
    .select(
      `id, user_id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, oauth_status, ${SENDER_SERVER_COLUMNS}`
    )
    .eq("id", senderId)
    .maybeSingle();
  if (!row) return null;
  let creds: SenderCreds | null = null;
  if (row.auth_method === "oauth" && row.oauth_refresh_token) {
    creds = {
      authMethod: "oauth",
      email: row.email,
      fromName: row.from_name,
      refreshToken: decryptSecret(row.oauth_refresh_token),
      accessToken: row.oauth_access_token ? decryptSecret(row.oauth_access_token) : null,
      expiresAt: row.oauth_expires_at ? new Date(row.oauth_expires_at) : null,
      sendAs: row.send_as_email ?? null,
    };
  } else if (row.app_password) {
    creds = {
      authMethod: "app_password",
      email: row.email,
      fromName: row.from_name,
      appPassword: decryptSecret(row.app_password),
      sendAs: row.send_as_email ?? null,
      ...serversFromRow(row),
    };
  }
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    oauthRevoked: row.auth_method === "oauth" && row.oauth_status !== "ok",
    creds,
  };
}

// Persist an OAuth access token Gmail refreshed mid-call. Token columns are
// server-managed, so this always goes through the service-role client.
export async function persistRefreshedToken(
  admin: SupabaseClient,
  senderId: string,
  t: RefreshResult | null | undefined
): Promise<void> {
  if (!t) return;
  await admin
    .from("senders")
    .update({
      oauth_access_token: encryptSecret(t.accessToken),
      oauth_expires_at: t.expiresAt.toISOString(),
    })
    .eq("id", senderId);
}

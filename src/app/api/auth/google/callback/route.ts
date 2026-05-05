import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { oauth2ClientWithRedirect, verifyGmailAccess } from "@/lib/gmail";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";
import { appUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sender Gmail OAuth callback. Exchanges the auth code for tokens, verifies
// they actually grant Gmail access, and upserts a senders row owned by the
// state-payload user_id.
//
// We use supabaseAdmin (service-role) instead of supabaseUser here. The
// state's HMAC already proves the user_id is real and unforgeable, and at
// callback time the Supabase session cookie is reliably present too — but
// the upsert needs to set user_id explicitly anyway, so admin is simpler
// and avoids one round-trip through getUser().
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  const fail = (reason: string, next = "/app/senders") => {
    const url = new URL(next, appUrl());
    url.searchParams.set("oauth_error", reason);
    return NextResponse.redirect(url);
  };

  if (error) return fail(error);
  if (!code || !stateRaw) return fail("missing_code_or_state");

  const state = verifyOAuthState(stateRaw);
  if (!state) return fail("bad_state");

  const redirectUri = `${appUrl()}/api/auth/google/callback`;
  const oauth = oauth2ClientWithRedirect(redirectUri);

  let tokens;
  try {
    const tr = await oauth.getToken(code);
    tokens = tr.tokens;
  } catch (e) {
    return fail(`exchange_failed:${e instanceof Error ? e.message : "unknown"}`, state.next);
  }

  if (!tokens.refresh_token) {
    // Google only returns refresh_token on first consent unless we force
    // prompt=consent (the connect route does). If it's still missing the
    // user has likely revoked + reconnected without the prompt — bail.
    return fail("no_refresh_token", state.next);
  }
  if (!tokens.access_token) return fail("no_access_token", state.next);

  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + 50 * 60 * 1000);

  const verify = await verifyGmailAccess({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt,
  });
  if (!verify.ok) return fail(`gmail_check_failed:${verify.error}`, state.next);

  const email = verify.email.toLowerCase();
  const db = supabaseAdmin();

  // Upsert by (user_id, email). If this user already connected the same
  // address (e.g. re-auth, or migrating from app password) update in place.
  const { data: existing } = await db
    .from("senders")
    .select("id, is_default")
    .eq("user_id", state.uid)
    .eq("email", email)
    .maybeSingle();

  const row = {
    user_id: state.uid,
    label: state.label || email,
    email,
    auth_method: "oauth" as const,
    app_password: null,
    oauth_refresh_token: encryptSecret(tokens.refresh_token),
    oauth_access_token: encryptSecret(tokens.access_token),
    oauth_expires_at: expiresAt.toISOString(),
    oauth_status: "ok" as const,
    is_default: existing?.is_default ?? false,
  };

  if (existing) {
    const { error: upErr } = await db
      .from("senders")
      .update(row)
      .eq("id", existing.id);
    if (upErr) return fail(`db_update_failed:${upErr.message}`, state.next);
  } else {
    const { error: insErr } = await db.from("senders").insert(row);
    if (insErr) return fail(`db_insert_failed:${insErr.message}`, state.next);
  }

  const ok = new URL(state.next || "/app/senders", appUrl());
  ok.searchParams.set("connected", email);
  return NextResponse.redirect(ok);
}

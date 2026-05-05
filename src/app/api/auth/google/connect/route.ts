import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { GMAIL_OAUTH_SCOPES, oauth2ClientWithRedirect } from "@/lib/gmail";
import { signOAuthState } from "@/lib/oauth-state";
import { appUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sender-side Gmail OAuth — distinct from /api/auth/google which kicks off
// Supabase-managed *app login* OAuth. This route grants gmail.send +
// gmail.readonly so the app can send mail and poll replies as the user.
//
// Caller must already be signed in. We sign the state param with the app's
// encryption secret so the callback can trust the user_id without taking
// it from query-string input.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const label = (req.nextUrl.searchParams.get("label") ?? "").slice(0, 100);
  const next = req.nextUrl.searchParams.get("next") ?? "/app/senders";

  const redirectUri = `${appUrl()}/api/auth/google/callback`;
  const oauth = oauth2ClientWithRedirect(redirectUri);

  const state = signOAuthState({ uid: u.id, label, next, ts: Date.now() });
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",         // force a refresh_token even on re-auth
    scope: GMAIL_OAUTH_SCOPES,
    state,
    include_granted_scopes: true,
  });
  return NextResponse.redirect(url);
}

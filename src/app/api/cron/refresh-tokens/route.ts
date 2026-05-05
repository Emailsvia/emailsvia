import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshAccessToken } from "@/lib/gmail";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { cronBearerOk } from "@/lib/tokens";
import { classifyError } from "@/lib/errors";
import { markSenderRevoked } from "@/lib/sender-revoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly cron: refresh OAuth access tokens that expire within the next 2h.
// Without this, every tick that lands on an expiring sender pays a refresh
// round-trip in the hot path (slow + occasional failure right when we want
// to send). Doing it preemptively keeps the tick fast and lets us catch
// invalid_grant in a low-stakes context — we email the user once and mark
// the sender revoked so the tick gate skips it cleanly.
export async function GET(req: NextRequest) {
  if (!cronBearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const { data: senders, error } = await db
    .from("senders")
    .select("id, user_id, email, oauth_refresh_token, oauth_expires_at, oauth_status")
    .eq("auth_method", "oauth")
    .eq("oauth_status", "ok")
    .not("oauth_refresh_token", "is", null)
    .lte("oauth_expires_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!senders || senders.length === 0) {
    return NextResponse.json({ status: "ok", refreshed: 0, revoked: 0, total: 0 });
  }

  let refreshed = 0;
  let revoked = 0;
  const failures: Array<{ sender_id: string; reason: string }> = [];

  for (const s of senders) {
    try {
      const result = await refreshAccessToken(decryptSecret(s.oauth_refresh_token!));
      await db
        .from("senders")
        .update({
          oauth_access_token: encryptSecret(result.accessToken),
          oauth_expires_at: result.expiresAt.toISOString(),
        })
        .eq("id", s.id);
      refreshed++;
    } catch (e) {
      const errorClass = classifyError(e);
      failures.push({ sender_id: s.id, reason: errorClass });
      Sentry.captureException(e, {
        tags: { route: "refresh_tokens", error_class: errorClass },
        contexts: { sender: { id: s.id, email: s.email } },
      });
      if (errorClass === "auth_revoked") {
        // markSenderRevoked is conditional on previous oauth_status='ok',
        // so the user gets at most one revoked email even if tick + this
        // cron + check-replies all detect the same revocation in the same
        // window.
        const out = await markSenderRevoked(db, {
          sender_id: s.id,
          sender_email: s.email,
          user_id: s.user_id,
        });
        if (out.flipped) revoked++;
      }
    }
  }

  return NextResponse.json({
    status: "ok",
    total: senders.length,
    refreshed,
    revoked,
    failures,
  });
}

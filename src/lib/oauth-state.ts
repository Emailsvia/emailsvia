import crypto from "crypto";

// Compact HMAC-signed state for OAuth flows. Carries the initiating user_id
// (so the callback can write rows scoped to the right tenant), an optional
// label, the next-URL to redirect to, and a timestamp for replay defense.

export type StatePayload = {
  uid: string;
  label: string;
  next: string;
  ts: number;
};

function key() {
  const s = process.env.ENCRYPTION_SECRET ?? process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ENCRYPTION_SECRET not set");
  return s;
}

export function signOAuthState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", key())
    .update(body)
    .digest("base64url")
    .slice(0, 24);
  return `${body}.${sig}`;
}

export function verifyOAuthState(token: string, maxAgeMs = 15 * 60 * 1000): StatePayload | null {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx < 1) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", key())
    .update(body)
    .digest("base64url")
    .slice(0, 24);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as StatePayload;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

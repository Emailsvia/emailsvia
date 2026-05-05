import crypto from "crypto";

function secret() {
  const s = process.env.ENCRYPTION_SECRET ?? process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ENCRYPTION_SECRET not set (need 32+ chars)");
  return s;
}

// tokens are `<id>.<16-char-hmac>` so we don't need a lookup table
export function signToken(kind: "u" | "o" | "c", id: string) {
  const sig = crypto
    .createHmac("sha256", secret())
    .update(`${kind}:${id}`)
    .digest("base64url")
    .slice(0, 16);
  return `${id}.${sig}`;
}

export function verifyToken(kind: "u" | "o" | "c", token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx < 1 || idx >= token.length - 1) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${kind}:${id}`)
    .digest("base64url")
    .slice(0, 16);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    return crypto.timingSafeEqual(a, b) ? id : null;
  } catch {
    return null;
  }
}

export function appUrl() {
  const url = process.env.APP_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      // Without APP_URL, every tracking pixel and unsubscribe link
      // generated this request would 404 silently. Fail loud in prod —
      // dev still gets the localhost default.
      throw new Error("APP_URL not set in production");
    }
    return "http://localhost:3000";
  }
  return url.replace(/\/$/, "");
}

// Constant-time equality for the cron bearer header.
export function cronBearerOk(authHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const given = authHeader ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

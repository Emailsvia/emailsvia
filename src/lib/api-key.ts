import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

// Personal access tokens for the public API (Sheets add-on, eventually
// CLI / curl). Stripe-style format: "eav_live_<32 chars of base32>".
//
// We store SHA-256(token) — the raw token is shown to the user exactly
// once at creation time and never recoverable after that. Verification
// is constant-time hash comparison.
//
// Lookup is done by SHA-256(token) directly (the column is unique +
// indexed) so a single equality query authenticates a request — no
// per-row decrypt loop.

const PREFIX = "eav_live_";

export type GeneratedKey = {
  raw: string;        // shown once
  prefix: string;     // first 11 chars, safe to display
  hash: string;       // sha256 hex
};

export function generateApiKey(): GeneratedKey {
  // 32 bytes -> 52 chars base32; we keep ~32 to stay readable. base32
  // (Crockford) avoids ambiguous chars (no 0/O/1/I) so users can read
  // a key off a screenshot without typos.
  const body = base32(crypto.randomBytes(20)).slice(0, 32).toLowerCase();
  const raw = `${PREFIX}${body}`;
  return {
    raw,
    prefix: raw.slice(0, 11),
    hash: hashKey(raw),
  };
}

export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Crockford base32 alphabet (no 0/O/1/I/L confusion).
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Pull the raw token from an Authorization header. Accepts both
// "Bearer eav_live_..." and the bare key, so curl users can send
// either. Returns null on shape mismatch — never throws.
export function extractApiKey(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  const candidate = trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
  if (!candidate.startsWith(PREFIX)) return null;
  if (candidate.length < PREFIX.length + 16 || candidate.length > 100) return null;
  return candidate;
}

// Lookup the api_key row by hashed token. Returns null if no match (i.e.
// invalid / revoked key). Uses the service-role client because the request
// arrives without a Supabase session — we're authing the request itself.
export async function authenticateApiKey(
  rawToken: string
): Promise<{ user_id: string; key_id: string } | null> {
  const db: SupabaseClient = supabaseAdmin();
  const { data } = await db
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", hashKey(rawToken))
    .maybeSingle();
  if (!data) return null;
  // Update last_used_at synchronously. Tempting to fire-and-forget for
  // latency, but Vercel kills the Lambda the moment the response is
  // returned — the unawaited write would silently never land. Worth the
  // ~5ms.
  await db
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { user_id: data.user_id, key_id: data.id };
}

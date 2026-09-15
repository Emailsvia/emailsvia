import "server-only";

// Optional paid mailbox verification. Syntax/MX checks can't tell whether
// jane@acme.com actually exists, or whether acme.com accepts everything
// ("catch-all"). That needs an SMTP-level probe, which cloud hosts block on
// port 25, so we call a verification API. Configure one:
//   EMAIL_VERIFIER_PROVIDER = zerobounce | neverbounce | millionverifier
//   EMAIL_VERIFIER_API_KEY  = …
// Plan-gated (email_verification) because every lookup costs money.

export type MailboxVerdict = "valid" | "invalid" | "catch_all" | "unknown" | "risky";

type Provider = "zerobounce" | "neverbounce" | "millionverifier";

export function verifierConfigured(): Provider | null {
  const p = (process.env.EMAIL_VERIFIER_PROVIDER ?? "").trim().toLowerCase();
  if (!process.env.EMAIL_VERIFIER_API_KEY) return null;
  return p === "zerobounce" || p === "neverbounce" || p === "millionverifier" ? p : null;
}

async function getJson(url: string, timeoutMs = 10_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`verifier HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Throws on provider/network failure (caller leaves the row unverified so
// it can be retried later, and nothing is marked invalid on a hiccup).
export async function verifyMailbox(email: string): Promise<MailboxVerdict> {
  const provider = verifierConfigured();
  const key = process.env.EMAIL_VERIFIER_API_KEY ?? "";
  if (!provider) throw new Error("no email verifier configured");
  const e = encodeURIComponent(email);

  if (provider === "zerobounce") {
    const j = await getJson(`https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${e}&ip_address=`);
    if (j?.error) throw new Error(`zerobounce: ${j.error}`);
    switch (String(j?.status ?? "").toLowerCase()) {
      case "valid": return "valid";
      case "invalid": return "invalid";
      case "catch-all": return "catch_all";
      case "spamtrap":
      case "abuse":
      case "do_not_mail": return "risky";
      default: return "unknown";
    }
  }
  if (provider === "neverbounce") {
    const j = await getJson(`https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${e}`);
    if (j?.status && j.status !== "success") throw new Error(`neverbounce: ${j.message ?? j.status}`);
    switch (String(j?.result ?? "").toLowerCase()) {
      case "valid": return "valid";
      case "invalid": return "invalid";
      case "disposable": return "risky";
      case "catchall": return "catch_all";
      default: return "unknown";
    }
  }
  const j = await getJson(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${e}&timeout=10`);
  if (j?.error) throw new Error(`millionverifier: ${j.error}`);
  switch (String(j?.result ?? "").toLowerCase()) {
    case "ok": return "valid";
    case "invalid": return "invalid";
    case "catch_all": return "catch_all";
    case "disposable": return "risky";
    default: return "unknown";
  }
}

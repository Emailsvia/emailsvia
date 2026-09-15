import dns from "dns";

const RFC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function syntaxValid(email: string) {
  return RFC_RE.test(email);
}

export async function hasMx(domain: string, timeoutMs = 4000): Promise<boolean> {
  return (await mailDomainStatus(domain, timeoutMs)) !== "no_mail";
}

// "accepts": MX records, or no MX but an A/AAAA record (RFC 5321 implicit
// MX). "no_mail": the domain definitively has neither (NXDOMAIN / NODATA).
// "unknown": timeout or resolver error; callers must not treat that as
// invalid, or one DNS hiccup would discard every address at that domain.
export type MailDomainStatus = "accepts" | "no_mail" | "unknown";

function lookup<T>(fn: (cb: (err: NodeJS.ErrnoException | null, v: T) => void) => void, timeoutMs: number) {
  return new Promise<{ ok: true; value: T } | { ok: false; definitive: boolean }>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, definitive: false }), timeoutMs);
    fn((err, value) => {
      clearTimeout(timer);
      if (!err) return resolve({ ok: true, value });
      resolve({ ok: false, definitive: err.code === "ENOTFOUND" || err.code === "ENODATA" });
    });
  });
}

export async function mailDomainStatus(domain: string, timeoutMs = 4000): Promise<MailDomainStatus> {
  const mx = await lookup<dns.MxRecord[]>((cb) => dns.resolveMx(domain, cb), timeoutMs);
  if (mx.ok) {
    // RFC 7505 null MX ("." priority 0) = explicitly accepts no mail.
    if (mx.value.length === 1 && (mx.value[0].exchange === "" || mx.value[0].exchange === ".")) return "no_mail";
    return mx.value.length > 0 ? "accepts" : "no_mail";
  }
  if (!mx.definitive) return "unknown";
  const a = await lookup<string[]>((cb) => dns.resolve4(domain, cb), timeoutMs);
  if (a.ok && a.value.length > 0) return "accepts";
  if (!a.ok && !a.definitive) return "unknown";
  return "no_mail";
}

// Throwaway-inbox providers: addresses here are never a real prospect and
// often turn into bounces or spam traps.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com", "yopmail.net",
  "trashmail.com", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com",
  "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com",
  "tempinbox.com", "spamgourmet.com", "burnermail.io", "moakt.com", "tempail.com", "mailcatch.com",
  "trbvm.com", "grr.la", "inboxkitten.com", "tempr.email", "discard.email", "mail.tm", "33mail.com",
]);

// Shared mailboxes: deliverable, but cold email to them rarely reaches a
// decision-maker and draws more spam complaints. Reported, not removed.
const ROLE_LOCAL_PARTS = new Set([
  "info", "contact", "hello", "support", "sales", "admin", "office", "team", "help", "enquiries",
  "inquiries", "marketing", "hr", "jobs", "careers", "billing", "accounts", "noreply", "no-reply",
  "webmaster", "postmaster", "abuse", "privacy", "legal", "press", "media", "service",
]);

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return ROLE_LOCAL_PARTS.has(local);
}

export type ValidationResult =
  | { ok: true; role: boolean; uncertain?: boolean }
  | { ok: false; reason: "bad_syntax" | "no_mx" | "disposable" };

// `mxCache` lets a caller validating a whole list look each domain up once.
// Only definitive answers stay cached; an "unknown" is dropped from the cache
// so the next address at that domain tries again.
export async function validateEmail(
  email: string,
  mxCache?: Map<string, Promise<MailDomainStatus>>
): Promise<ValidationResult> {
  const e = email.trim().toLowerCase();
  if (!syntaxValid(e)) return { ok: false, reason: "bad_syntax" };
  const domain = e.split("@")[1];
  if (!domain) return { ok: false, reason: "bad_syntax" };
  if (DISPOSABLE_DOMAINS.has(domain)) return { ok: false, reason: "disposable" };
  let pending = mxCache?.get(domain);
  if (!pending) {
    pending = mailDomainStatus(domain);
    mxCache?.set(domain, pending);
  }
  const status = await pending;
  if (status === "unknown") {
    mxCache?.delete(domain);
    return { ok: true, role: isRoleAddress(e), uncertain: true };
  }
  if (status === "no_mail") return { ok: false, reason: "no_mx" };
  return { ok: true, role: isRoleAddress(e) };
}

// Simple concurrency limiter
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

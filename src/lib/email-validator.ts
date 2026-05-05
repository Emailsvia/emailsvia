import dns from "dns";

const RFC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function syntaxValid(email: string) {
  return RFC_RE.test(email);
}

export async function hasMx(domain: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    dns.resolveMx(domain, (err, records) => {
      clearTimeout(timer);
      if (err || !records || records.length === 0) return resolve(false);
      resolve(true);
    });
  });
}

export async function validateEmail(email: string) {
  if (!syntaxValid(email)) return { ok: false as const, reason: "bad_syntax" };
  const domain = email.split("@")[1];
  if (!domain) return { ok: false as const, reason: "bad_syntax" };
  const mx = await hasMx(domain);
  if (!mx) return { ok: false as const, reason: "no_mx" };
  return { ok: true as const };
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

import "server-only";
import { promises as dns } from "dns";
import { isCompanyDomain } from "./sequence-schedule";
import { mapWithLimit } from "./email-validator";

// Sender-domain authentication check: SPF, DKIM, DMARC, MX. Gmail (since
// Nov 2025) and Outlook.com (since May 2025) reject mail from domains that
// fail these, so a campaign from a misconfigured domain bounces instead of
// landing in spam. Free-mail domains (gmail.com etc.) are Google's problem,
// not the user's, and are reported as "managed".

export type CheckStatus = "pass" | "warn" | "fail";

export type DomainAuthReport = {
  domain: string;
  managed: boolean; // free-mail domain; nothing for the user to configure
  mx: { status: CheckStatus; hosts: string[] };
  spf: { status: CheckStatus; record: string | null; note: string };
  dkim: { status: CheckStatus; selectors: string[]; note: string };
  dmarc: { status: CheckStatus; record: string | null; policy: string | null; note: string };
  score: CheckStatus; // worst of the four
  provider: "google" | "microsoft" | "zoho" | "other" | null;
};

const TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), TIMEOUT_MS);
  });
  try {
    return await Promise.race([p.catch(() => fallback), t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// TXT records for `name`: [] when the name genuinely has none, null when the
// lookup itself failed or timed out (so we don't report "missing" records
// that are really just a slow resolver).
async function txt(name: string): Promise<string[] | null> {
  const LOOKUP_FAILED = Symbol("lookup_failed");
  const rows = await withTimeout<string[][] | typeof LOOKUP_FAILED>(
    dns.resolveTxt(name).catch((e: NodeJS.ErrnoException) =>
      e?.code === "ENODATA" || e?.code === "ENOTFOUND" ? [] : LOOKUP_FAILED
    ),
    LOOKUP_FAILED
  );
  if (rows === LOOKUP_FAILED) return null;
  return rows.map((chunks) => chunks.join(""));
}

// Selectors used by the common mailbox / sending providers. When the MX
// tells us the provider we only probe its selectors: firing a dozen TXT
// lookups at once makes some resolvers time out and report false misses.
const DKIM_SELECTORS_BY_PROVIDER: Record<string, string[]> = {
  google: ["google"],
  microsoft: ["selector1", "selector2"],
  zoho: ["zmail", "zoho"],
};
const DKIM_SELECTORS_GENERIC = ["default", "mail", "dkim", "k1", "s1", "s2", "google", "selector1"];

function detectProvider(mxHosts: string[]): DomainAuthReport["provider"] {
  const joined = mxHosts.join(" ").toLowerCase();
  if (!joined) return null;
  if (/google\.com|googlemail\.com/.test(joined)) return "google";
  if (/outlook\.com|protection\.outlook/.test(joined)) return "microsoft";
  if (/zoho\./.test(joined)) return "zoho";
  return "other";
}

const SPF_INCLUDE: Record<string, string> = {
  google: "include:_spf.google.com",
  microsoft: "include:spf.protection.outlook.com",
  zoho: "include:zoho.com",
};

export async function checkDomainAuth(domain: string): Promise<DomainAuthReport> {
  const d = domain.trim().toLowerCase();
  const managed = !isCompanyDomain(d);

  const mxRecords = await withTimeout(dns.resolveMx(d), [] as { exchange: string; priority: number }[]);
  const mxHosts = mxRecords.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  const provider = detectProvider(mxHosts);

  if (managed) {
    const ok = { status: "pass" as const };
    return {
      domain: d,
      managed: true,
      mx: { ...ok, hosts: mxHosts },
      spf: { ...ok, record: null, note: "Handled by your mail provider." },
      dkim: { ...ok, selectors: [], note: "Handled by your mail provider." },
      dmarc: { ...ok, record: null, policy: null, note: "Handled by your mail provider." },
      score: "pass",
      provider,
    };
  }

  const dkimSelectors = (provider && DKIM_SELECTORS_BY_PROVIDER[provider]) || DKIM_SELECTORS_GENERIC;
  const [rootTxt, dmarcTxt] = await Promise.all([txt(d), txt(`_dmarc.${d}`)]);
  const dkimResults = await mapWithLimit(dkimSelectors, 3, (sel) => txt(`${sel}._domainkey.${d}`));

  // ---- SPF ----
  const spfRecords = (rootTxt ?? []).filter((r) => /^v=spf1\b/i.test(r));
  const spfRecord = spfRecords[0] ?? null;
  let spf: DomainAuthReport["spf"];
  if (rootTxt === null) {
    spf = { status: "warn", record: null, note: "Couldn't look up SPF right now (DNS timeout). Try again." };
  } else if (spfRecords.length === 0) {
    const hint = provider && SPF_INCLUDE[provider] ? ` e.g. "v=spf1 ${SPF_INCLUDE[provider]} ~all"` : "";
    spf = { status: "fail", record: null, note: `No SPF record. Add a TXT record on ${d}${hint}.` };
  } else if (spfRecords.length > 1) {
    spf = { status: "fail", record: spfRecord, note: "Multiple SPF records. Receivers treat that as invalid; merge them into one." };
  } else if (provider && SPF_INCLUDE[provider] && !spfRecord!.toLowerCase().includes(SPF_INCLUDE[provider])) {
    spf = { status: "warn", record: spfRecord, note: `SPF doesn't include your mail provider (${SPF_INCLUDE[provider]}).` };
  } else if (/\+all\b/i.test(spfRecord!)) {
    spf = { status: "warn", record: spfRecord, note: "SPF ends in +all, which lets anyone send as your domain. Use ~all or -all." };
  } else {
    spf = { status: "pass", record: spfRecord, note: "SPF found." };
  }

  // ---- DKIM ----
  // A published key has a non-empty p= (empty p= means "revoked", and some
  // domains answer every selector with that via a wildcard record).
  const selectors = dkimSelectors.filter((_, i) =>
    (dkimResults[i] ?? []).some((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(r))
  );
  const dkim: DomainAuthReport["dkim"] =
    selectors.length > 0
      ? { status: "pass", selectors, note: `DKIM key found (${selectors.join(", ")}).` }
      : {
          status: "warn",
          selectors: [],
          note:
            provider === "google"
              ? "No DKIM key at google._domainkey. Turn on DKIM in Google Admin → Apps → Gmail → Authenticate email."
              : "No DKIM key at the common selectors. If your provider uses a custom selector this may be a false alarm; otherwise enable DKIM signing with your mail provider.",
        };

  // ---- DMARC ----
  const dmarcRecord = (dmarcTxt ?? []).find((r) => /^v=DMARC1\b/i.test(r)) ?? null;
  const policy = dmarcRecord?.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
  const dmarc: DomainAuthReport["dmarc"] = dmarcTxt === null
    ? { status: "warn", record: null, policy: null, note: "Couldn't look up DMARC right now (DNS timeout). Try again." }
    : !dmarcRecord
    ? {
        status: "fail",
        record: null,
        policy: null,
        note: `No DMARC record. Gmail, Yahoo and Outlook require one for volume senders. Add TXT on _dmarc.${d}: "v=DMARC1; p=none; rua=mailto:dmarc@${d}".`,
      }
    : { status: "pass", record: dmarcRecord, policy, note: `DMARC found (p=${policy ?? "?"}).` };

  // ---- MX ----
  const mx: DomainAuthReport["mx"] =
    mxHosts.length > 0
      ? { status: "pass", hosts: mxHosts }
      : { status: "fail", hosts: [] };

  const order: CheckStatus[] = ["pass", "warn", "fail"];
  const score = [mx.status, spf.status, dkim.status, dmarc.status].reduce<CheckStatus>(
    (worst, s) => (order.indexOf(s) > order.indexOf(worst) ? s : worst),
    "pass"
  );

  return { domain: d, managed: false, mx, spf, dkim, dmarc, score, provider };
}

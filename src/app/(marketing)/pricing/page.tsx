import Link from "next/link";
import MarketingShell from "@/components/MarketingShell";

export const metadata = {
  title: "Pricing — EmailsVia",
  description:
    "Free 50 sends/day forever. Starter $9/mo · Growth $19/mo · Scale $39/mo. Warmup included from $9.",
};

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cap: "50 sends / day",
    senders: "1 sender",
    highlights: [
      "1 sender",
      "EmailsVia watermark",
      "100-row imports",
      "Tracking + scheduling",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    id: "starter",
    name: "Starter",
    price: "$9",
    cap: "500 sends / day",
    senders: "1 sender",
    highlights: [
      "Threaded follow-ups",
      "Warmup included",
      "Tracking + scheduling",
      "No watermark",
      "Unlimited row imports",
    ],
    cta: "Start free → upgrade",
    href: "/signup",
    highlight: true,
  },
  {
    id: "growth",
    name: "Growth",
    price: "$19",
    cap: "1,500 sends / day",
    senders: "3 senders",
    highlights: [
      "AI reply triage",
      "AI personalization",
      "A/B testing",
      "Conditional sequences",
      "Everything in Starter",
    ],
    cta: "Start free → upgrade",
    href: "/signup",
  },
  {
    id: "scale",
    name: "Scale",
    price: "$39",
    cap: "5,000 sends / day",
    senders: "10 senders",
    highlights: [
      "Inbox rotation across 10 Gmails",
      "Email verification",
      "Public API",
      "Priority support",
      "Everything in Growth",
    ],
    cta: "Start free → upgrade",
    href: "/signup",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-10 text-center">
        <h1 className="text-[40px] font-bold tracking-tight">Simple pricing.</h1>
        <p className="text-[15px] text-ink-600 mt-3">
          Free forever for 50 sends/day. Paid tiers unlock warmup, follow-ups, AI, and
          inbox rotation. Cancel anytime &mdash; no trial timers.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {TIERS.map((t) => (
            <div
              key={t.id}
              className={
                "sheet p-5 flex flex-col " +
                (t.highlight ? "border-ink ring-1 ring-ink relative" : "")
              }
            >
              {t.highlight && (
                <span className="absolute -top-2 left-4 text-[10px] uppercase tracking-wider bg-ink text-paper px-2 py-0.5 rounded">
                  Most popular
                </span>
              )}
              <div className="text-[14px] font-semibold">{t.name}</div>
              <div className="mt-2">
                <span className="text-[34px] font-bold tracking-tight">{t.price}</span>
                <span className="text-[13px] text-ink-500">{t.id === "free" ? "" : " / mo"}</span>
              </div>
              <div className="text-[13px] text-ink-600 mt-1">{t.cap}</div>
              <div className="text-[12px] text-ink-500">{t.senders}</div>
              <ul className="text-[13px] text-ink-700 mt-4 space-y-1.5 flex-1">
                {t.highlights.map((h) => (
                  <li key={h}>· {h}</li>
                ))}
              </ul>
              <Link
                href={t.href}
                className={(t.highlight ? "btn-accent" : "btn-ghost") + " mt-5 text-center"}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 text-[12px] text-ink-500 text-center">
          Tax is calculated automatically by Stripe. Prices in USD.
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-[22px] font-semibold tracking-tight mb-4">FAQ</h2>
        <div className="space-y-5 text-[14px]">
          <Faq q="Why is warmup on the $9 tier?">
            Mailmeteor only ships warmup at $24.99/mo. If you got Gmail-blocked on a lower-tier
            Mailmeteor plan, that&rsquo;s why &mdash; you were sending too fast from a cold address.
            We made it standard from the cheapest paid tier.
          </Faq>
          <Faq q="Will EmailsVia send from your domain or mine?">
            Yours. We log into your Gmail via OAuth (or app password) and call the Gmail API.
            Your domain reputation stays with you &mdash; tracking links use a separate
            sub-domain (t.emailsvia.com) so a tracking-domain block never affects your inbox.
          </Faq>
          <Faq q="Can I cancel anytime?">
            Yes. You keep paid features until the end of the current period, then drop to Free.
          </Faq>
          <Faq q="What about Google verification?">
            Gmail OAuth is in submission for Google&rsquo;s Sensitive-Scope review. Until
            approved you can still connect with the app-password fallback &mdash; the same
            campaigns flow either way.
          </Faq>
        </div>
      </section>
    </MarketingShell>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-medium">{q}</div>
      <p className="text-ink-600 mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

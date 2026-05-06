import Link from "next/link";
import MarketingShell from "@/components/MarketingShell";
import GridSpotlight from "@/components/marketing/GridSpotlight";
import Reveal from "@/components/marketing/Reveal";
import PricingCards from "@/components/marketing/PricingCards";
import FAQAccordion from "@/components/marketing/FAQAccordion";

export const metadata = {
  title: "Pricing — EmailsVia",
  description:
    "Free 50 sends/day forever. Starter $9 · Growth $19 · Scale $39. Warmup included from $9. No card. No trial timer.",
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <Hero />
      <Cards />
      <Compare />
      <FAQ />
      <FinalCTA />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="relative">
      <GridSpotlight />
      <div className="relative mx-auto max-w-3xl px-5 sm:px-8 pt-12 sm:pt-20 pb-10 text-center">
        <Reveal>
          <span className="m-pill mx-auto">
            <span className="m-pill-dot" />
            <span>Pricing</span>
          </span>
        </Reveal>
        <Reveal delayMs={80}>
          <h1 className="m-display text-[44px] sm:text-[68px] mt-6 leading-[0.98]">
            Pricing that <span className="m-gradient-text">respects you.</span>
          </h1>
        </Reveal>
        <Reveal delayMs={140}>
          <p className="mt-6 m-body text-[16px] sm:text-[17px] max-w-xl mx-auto">
            Free forever for 50 sends a day. Paid tiers unlock warmup, follow-ups, AI, and rotation.
            Cancel anytime — we don&rsquo;t make you call anyone.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Cards() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 pb-10">
        <Reveal>
          <PricingCards />
        </Reveal>

        <Reveal delayMs={140} className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[13px] text-[rgb(161_161_170)]">
          <span className="inline-flex items-center gap-2">
            <Bullet /> Annual: pay 10, get 12
          </span>
          <span className="inline-flex items-center gap-2">
            <Bullet /> 14-day money-back, no exit interview
          </span>
          <span className="inline-flex items-center gap-2">
            <Bullet /> Tax handled by Stripe. USD.
          </span>
        </Reveal>
      </div>
    </section>
  );
}

function Bullet() {
  return <span className="w-1 h-1 rounded-full bg-[rgb(255_140_140)]" />;
}

function Compare() {
  return (
    <section id="compare" className="py-24 sm:py-28 relative">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> How we compare
          </span>
          <h2 className="m-h2 text-[32px] sm:text-[44px] mt-5">
            Honest matrix.
            <br />
            <span className="text-[rgb(161_161_170)]">Updated whenever they change theirs.</span>
          </h2>
        </Reveal>

        <Reveal delayMs={120} className="mt-10">
          <div className="m-glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[rgb(255_255_255/0.06)]">
                    <th className="text-left p-4 m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] font-medium">Feature</th>
                    <th className="text-left p-4 m-mono text-[11px] uppercase tracking-wider text-[rgb(255_140_140)] font-medium">EmailsVia</th>
                    <th className="text-left p-4 m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] font-medium">Mailmeteor</th>
                    <th className="text-left p-4 m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] font-medium">GMass</th>
                    <th className="text-left p-4 m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] font-medium">Instantly</th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label="Lowest paid tier"        evia="$9/mo"           a="$9.99/mo"      b="$19.95/mo"   c="$37/mo" highlightUs />
                  <CompareRow label="Warmup included"         evia="✓ from $9"       a="$24.99 add-on" b="Add-on"      c="Included" highlightUs />
                  <CompareRow label="Sends from your Gmail"   evia="✓"               a="✓"             b="✓"           c="Their infra" />
                  <CompareRow label="Strict-merge validation" evia="✓ hard-fail"     a="—"             b="—"           c="—"        highlightUs />
                  <CompareRow label="AI reply triage"         evia="✓ Growth+"       a="—"             b="—"           c="✓"        />
                  <CompareRow label="Inbox rotation"          evia="✓ at $39"        a="—"             b="—"           c="✓ ($97+)" highlightUs />
                  <CompareRow label="Public API + webhooks"   evia="✓ Scale"         a="—"             b="—"           c="✓"        />
                  <CompareRow label="Free forever tier"       evia="✓ 50/day"        a="✓ low cap"     b="—"           c="—"        highlightUs />
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={200} className="mt-6">
          <p className="text-[12.5px] text-[rgb(113_113_122)] text-center max-w-xl mx-auto">
            Last verified May 2026 against their public pricing pages. Got a correction?
            Email <a href="mailto:hello@emailsvia.com" className="text-[rgb(244_244_245)] underline decoration-[rgb(255_99_99/0.5)] underline-offset-[3px] hover:decoration-[rgb(255_99_99)] transition">hello@emailsvia.com</a> and we&rsquo;ll fix it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function CompareRow({
  label,
  evia,
  a,
  b,
  c,
  highlightUs = false,
}: {
  label: string;
  evia: string;
  a: string;
  b: string;
  c: string;
  highlightUs?: boolean;
}) {
  return (
    <tr className="border-b border-[rgb(255_255_255/0.04)] last:border-0 hover:bg-[rgb(255_255_255/0.02)] transition-colors">
      <td className="p-4 text-[rgb(244_244_245)]">{label}</td>
      <td className={`p-4 m-mono text-[13px] ${highlightUs ? "text-[rgb(255_140_140)]" : "text-[rgb(244_244_245)]"}`}>{evia}</td>
      <td className="p-4 m-mono text-[13px] text-[rgb(161_161_170)]">{a}</td>
      <td className="p-4 m-mono text-[13px] text-[rgb(161_161_170)]">{b}</td>
      <td className="p-4 m-mono text-[13px] text-[rgb(161_161_170)]">{c}</td>
    </tr>
  );
}

function FAQ() {
  return (
    <section id="faq" className="py-20 sm:py-28 relative">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <Reveal>
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> FAQ
          </span>
          <h2 className="m-h2 text-[32px] sm:text-[44px] mt-5">
            The honest answers.
          </h2>
        </Reveal>
        <Reveal delayMs={120} className="mt-10">
          <FAQAccordion />
        </Reveal>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-20 sm:py-28 relative overflow-hidden">
      <div className="absolute inset-0 m-grid-bg opacity-50" aria-hidden />
      <div className="m-orb m-orb-coral" style={{ width: 500, height: 500, left: "50%", top: "20%", transform: "translateX(-50%)" }} />
      <div className="relative mx-auto max-w-2xl px-5 sm:px-8 text-center">
        <Reveal>
          <h2 className="m-display text-[36px] sm:text-[56px] leading-[1]">
            Try it for nothing.
          </h2>
        </Reveal>
        <Reveal delayMs={100}>
          <p className="mt-5 m-body text-[15px]">
            50 sends a day, free forever. Upgrade only when you outgrow it.
          </p>
        </Reveal>
        <Reveal delayMs={160} className="mt-8">
          <Link href="/signup" className="m-btn m-btn-primary text-[15px] py-2.5 px-5">
            Start free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

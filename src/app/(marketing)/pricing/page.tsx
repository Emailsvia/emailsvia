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
            <Bullet /> Cancel any time from the dashboard
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

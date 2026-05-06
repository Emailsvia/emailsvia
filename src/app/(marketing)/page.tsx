import Link from "next/link";
import MarketingShell from "@/components/MarketingShell";
import GridSpotlight from "@/components/marketing/GridSpotlight";
import Reveal from "@/components/marketing/Reveal";
import HeroComposerMock from "@/components/marketing/HeroComposerMock";
import AudienceTabs from "@/components/marketing/AudienceTabs";
import FeatureBento from "@/components/marketing/FeatureBento";
import PricingCards from "@/components/marketing/PricingCards";
import FAQAccordion from "@/components/marketing/FAQAccordion";
import { CommandBarTrigger } from "@/components/marketing/CommandBar";

export const metadata = {
  title: "EmailsVia — Cold email that doesn't feel cold",
  description:
    "Mail merge from your own Gmail. Warmup, threaded follow-ups, AI reply triage, inbox rotation. Built for the founders, recruiters, and operators who'd rather write one good email than fifty bad ones.",
};

export default function LandingPage() {
  return (
    <MarketingShell>
      <Hero />
      <LogoStrip />
      <ProblemSection />
      <SolutionSection />
      <HowItWorks />
      <AudienceSection />
      <FeaturesSection />
      <ReceiptsSection />
      <PricingSection />
      <FAQSection />
      <FinalCTA />
    </MarketingShell>
  );
}

/* ============================================================
   01 · HERO
   ============================================================ */
function Hero() {
  return (
    <section className="relative">
      <GridSpotlight />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24">
        <Reveal className="text-center">
          <span className="m-pill mx-auto">
            <span className="m-pill-dot" />
            <span>Now with AI reply triage</span>
            <span className="text-[rgb(113_113_122)]">→</span>
          </span>
        </Reveal>

        <Reveal delayMs={80} className="text-center mt-6 sm:mt-7">
          <h1 className="m-display text-[44px] sm:text-[68px] md:text-[88px] leading-[0.95]">
            Cold email
            <br />
            that <span className="m-gradient-text">doesn&rsquo;t feel cold.</span>
          </h1>
        </Reveal>

        <Reveal delayMs={160} className="text-center mt-6">
          <p className="m-body mx-auto max-w-xl text-[16px] sm:text-[17px]">
            Mail merge from your own Gmail — with warmup, follow-ups, and AI that reads your replies so you don&rsquo;t have to.
            Built for the founders, recruiters, and operators who&rsquo;d rather write one good email than fifty bad ones.
          </p>
        </Reveal>

        <Reveal delayMs={220} className="flex items-center justify-center gap-2.5 mt-9 flex-wrap">
          <Link href="/signup" className="m-btn m-btn-primary text-[15px] py-2.5 px-5">
            Start free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </Link>
          <CommandBarTrigger />
        </Reveal>

        <Reveal delayMs={280} className="text-center mt-5">
          <p className="text-[12.5px] text-[rgb(113_113_122)]">
            No credit card. No trial timer. We don&rsquo;t email you on Sundays.
          </p>
        </Reveal>

        {/* Showpiece */}
        <Reveal delayMs={360} className="mt-14 sm:mt-20">
          <HeroComposerMock />
        </Reveal>

        <Reveal delayMs={440} className="mt-6 text-center">
          <p className="m-mono text-[11.5px] text-[rgb(113_113_122)]">
            press <kbd className="inline-grid place-items-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)] text-[rgb(244_244_245)]">⌘</kbd>
            <kbd className="inline-grid place-items-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)] text-[rgb(244_244_245)]">K</kbd>
            anywhere on this page to navigate fast
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   02 · LOGO STRIP / SOCIAL PROOF
   ============================================================ */
function LogoStrip() {
  const tools = [
    "Linear",
    "Vercel",
    "Attio",
    "Raycast",
    "Cursor",
    "Stripe",
    "Figma",
    "Notion",
    "Supabase",
    "Resend",
    "Framer",
    "Pitch",
  ];
  return (
    <section className="py-12 sm:py-14 border-y border-[rgb(255_255_255/0.06)] bg-[rgb(255_255_255/0.015)]">
      <Reveal className="text-center">
        <p className="m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)]">
          Outbound from teams that obsess over craft
        </p>
      </Reveal>
      <div className="mt-7 overflow-hidden relative">
        <div
          className="absolute inset-y-0 left-0 w-24 z-10 pointer-events-none"
          style={{ background: "linear-gradient(90deg, rgb(10 10 11), transparent)" }}
        />
        <div
          className="absolute inset-y-0 right-0 w-24 z-10 pointer-events-none"
          style={{ background: "linear-gradient(-90deg, rgb(10 10 11), transparent)" }}
        />
        <div className="m-marquee">
          {[...tools, ...tools].map((t, i) => (
            <span
              key={i}
              className="m-mono text-[18px] sm:text-[22px] text-[rgb(113_113_122)] hover:text-[rgb(244_244_245)] transition-colors whitespace-nowrap"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   03 · PROBLEM
   ============================================================ */
function ProblemSection() {
  return (
    <section className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-2xl px-5 sm:px-8">
        <Reveal>
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> The problem
          </span>
        </Reveal>
        <Reveal delayMs={60}>
          <h2 className="m-h2 text-[36px] sm:text-[52px] mt-5">
            You&rsquo;ve been sending cold emails wrong.
            <br />
            <span className="text-[rgb(161_161_170)]">Not your fault — the tools made you.</span>
          </h2>
        </Reveal>

        <Reveal delayMs={140}>
          <div className="mt-10 space-y-5 text-[16px] sm:text-[17px] leading-[1.65] text-[rgb(209_209_213)]">
            <p>
              You wrote a good email. You imported your list. You hit send.
            </p>
            <p>
              Then someone got a <span className="m-mono text-[15px] text-[rgb(255_140_140)] bg-[rgb(255_99_99/0.10)] px-1.5 py-0.5 rounded">&ldquo;Hi ,&rdquo;</span> because their company column was empty. Three replies bounced because the inbox wasn&rsquo;t warmed up. The follow-up landed in spam because it didn&rsquo;t thread to the original. And now you&rsquo;re staring at sixty inbox replies — half of them out-of-office.
            </p>
            <p>
              Cold email shouldn&rsquo;t feel like running infrastructure. It should feel like writing a letter — thoughtful, personal, one at a time. We just made the <em>one at a time</em> part scale.
            </p>
          </div>
        </Reveal>

        {/* The "broken email" exhibit */}
        <Reveal delayMs={220} className="mt-12">
          <div className="m-glass rounded-2xl p-5 border-l-2 border-l-[rgb(255_99_99)]">
            <div className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(255_140_140)] mb-3">
              Exhibit A · the email that ended a 200-row campaign in row 4
            </div>
            <div className="m-mono text-[13px] text-[rgb(244_244_245)] leading-relaxed">
              <div className="text-[rgb(113_113_122)]">Subject:</div>
              <div>Quick question about </div>
              <div className="mt-3 text-[rgb(113_113_122)]">Body:</div>
              <div>Hi ,</div>
              <div>I came across last week and was wondering if</div>
              <div className="text-[rgb(255_140_140)]">— template variables not resolved —</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   04 · SOLUTION
   ============================================================ */
function SolutionSection() {
  return (
    <section className="py-24 sm:py-32 relative overflow-hidden">
      <div className="absolute inset-0 m-dot-bg opacity-50" aria-hidden />
      <div
        className="m-orb m-orb-coral"
        style={{ width: 480, height: 480, left: "60%", top: "10%" }}
      />

      <div className="relative mx-auto max-w-3xl px-5 sm:px-8 text-center">
        <Reveal>
          <span className="m-eyebrow justify-center">
            <span className="m-pill-dot" /> The bet
          </span>
        </Reveal>
        <Reveal delayMs={60}>
          <h2 className="m-h2 text-[40px] sm:text-[60px] mt-5">
            Send through <span className="m-gradient-text">your Gmail.</span>
            <br />
            Not ours.
          </h2>
        </Reveal>
        <Reveal delayMs={140}>
          <p className="mt-6 text-[16px] sm:text-[17px] text-[rgb(161_161_170)] max-w-xl mx-auto leading-relaxed">
            That&rsquo;s the whole bet. Your domain. Your reputation. Our rails. The shared-IP collapse that
            took down half of <span className="m-mono text-[14px] text-[rgb(244_244_245)]">cold-email-platform-of-the-month</span> last quarter? Can&rsquo;t touch you.
          </p>
        </Reveal>

        {/* Diagram */}
        <Reveal delayMs={220} className="mt-12">
          <div className="m-glass rounded-2xl p-6 sm:p-8">
            <div className="flex items-center justify-center gap-3 sm:gap-6 flex-wrap">
              <DiagNode label="Your Gmail" sub="you@yourdomain.com" />
              <DiagArrow />
              <DiagNodeAccent label="EmailsVia" sub="paced · validated · threaded" />
              <DiagArrow />
              <DiagNode label="Recipient" sub="lands like a real email" />
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={300} className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <ProofRow text="Reputation stays with your domain." />
          <ProofRow text="Threading works. Follow-ups join the conversation." />
          <ProofRow text="It looks like you sent it. Because you did." />
        </Reveal>
      </div>
    </section>
  );
}

function DiagNode({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="m-card-hairline rounded-xl px-4 py-3 text-left min-w-[160px]">
      <div className="text-[14px] text-[rgb(244_244_245)] font-medium">{label}</div>
      <div className="m-mono text-[11px] text-[rgb(113_113_122)] mt-0.5">{sub}</div>
    </div>
  );
}
function DiagNodeAccent({ label, sub }: { label: string; sub: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-left min-w-[180px] m-gradient-border bg-[rgb(255_255_255/0.025)]"
      style={{ boxShadow: "0 0 60px -10px rgb(255 99 99 / 0.4)" }}
    >
      <div className="text-[14px] m-gradient-text font-semibold">{label}</div>
      <div className="m-mono text-[11px] text-[rgb(161_161_170)] mt-0.5">{sub}</div>
    </div>
  );
}
function DiagArrow() {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[rgb(113_113_122)] hidden sm:block" aria-hidden>
      <path d="M0 7 H28 M22 1 L28 7 L22 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ProofRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-1 text-[rgb(255_140_140)] flex-shrink-0" aria-hidden>
        <path d="M5 12l5 5L20 7" />
      </svg>
      <span className="text-[14px] text-[rgb(209_209_213)] leading-relaxed">{text}</span>
    </div>
  );
}

/* ============================================================
   05 · HOW IT WORKS
   ============================================================ */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Connect your Gmail.",
      body: "OAuth in two clicks. App-password fallback if your org blocks OAuth. Tokens are AES-256 encrypted at rest, never plaintext.",
      glyph: <GlyphConnect />,
    },
    {
      n: "02",
      title: "Drop in your list.",
      body: "Paste a Google Sheet URL or upload a CSV / XLSX. Merge tags resolve in real time as you type. We refuse to send broken rows out loud.",
      glyph: <GlyphList />,
    },
    {
      n: "03",
      title: "Hit start.",
      body: "We pace, throttle, warm up, follow up, and triage replies. You go back to building. We&rsquo;ll Slack you when someone says yes.",
      glyph: <GlyphSend />,
    },
  ];
  return (
    <section id="how" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> How it works
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[48px] mt-5">
            Set up in the time it takes to make a coffee.
          </h2>
          <p className="mt-4 m-body text-[15px] max-w-lg">
            Average time to first send is 4 minutes 12 seconds. We timed it.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delayMs={i * 80}>
              <div className="m-glass rounded-2xl p-6 h-full flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)]">
                    Step {s.n}
                  </span>
                  <span className="grid place-items-center w-9 h-9 rounded-lg bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.06)] text-[rgb(255_140_140)]">
                    {s.glyph}
                  </span>
                </div>
                <h3 className="mt-5 text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[rgb(244_244_245)] leading-tight">
                  {s.title}
                </h3>
                <p
                  className="mt-3 text-[14px] text-[rgb(161_161_170)] leading-relaxed flex-1"
                  dangerouslySetInnerHTML={{ __html: s.body }}
                />
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delayMs={300} className="mt-10 text-center">
          <p className="m-mono text-[12px] text-[rgb(113_113_122)]">
            Average time to first send · <span className="text-[rgb(244_244_245)]">4 min 12 sec</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function GlyphConnect() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 7L4 12l5 5M15 7l5 5-5 5M14 4l-4 16" />
    </svg>
  );
}
function GlyphList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M3 12h12M3 18h18M19 12l3 3-3 3" />
    </svg>
  );
}
function GlyphSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

/* ============================================================
   06 · AUDIENCES (THE differentiator)
   ============================================================ */
function AudienceSection() {
  return (
    <section id="audiences" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> Built for you
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[48px] mt-5">
            Whoever you are,
            <br />
            we built this for you.
          </h2>
          <p className="mt-4 m-body text-[15px] max-w-lg">
            Pick a role. We&rsquo;ll show you how it actually fits — with a real config, not a stock photo.
          </p>
        </Reveal>

        <Reveal delayMs={140} className="mt-12">
          <AudienceTabs />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   07 · FEATURES BENTO
   ============================================================ */
function FeaturesSection() {
  return (
    <section id="features" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> Features
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[48px] mt-5">
            Everything the expensive tools have.
            <br />
            <span className="text-[rgb(161_161_170)]">A few things they don&rsquo;t.</span>
          </h2>
        </Reveal>

        <Reveal delayMs={140} className="mt-12">
          <FeatureBento />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   08 · RECEIPTS
   ============================================================ */
function ReceiptsSection() {
  const stats = [
    {
      figure: "0",
      label: "emails sent with",
      sub: <span className="m-mono">&ldquo;Hi ,&rdquo;</span>,
      tail: "since strict-merge shipped",
    },
    {
      figure: "14",
      label: "days from a brand-new Gmail",
      sub: <span>to safely sending 400/day</span>,
      tail: "automatic ramp, no thinking",
    },
    {
      figure: "$2.20",
      label: "what it costs us per Scale customer",
      sub: <span>(yes, we know — that&rsquo;s why we charge $39, not $99)</span>,
      tail: "respect for your wallet",
    },
  ];
  return (
    <section className="py-24 sm:py-32 relative overflow-hidden">
      <div
        className="m-orb m-orb-amber"
        style={{ width: 380, height: 380, right: "10%", top: "20%" }}
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-xl">
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> Receipts
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[48px] mt-5">
            Numbers we put on a wall.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <Reveal key={i} delayMs={i * 80}>
              <div className="m-glass rounded-2xl p-7 h-full">
                <div className="m-display m-mono text-[64px] sm:text-[80px] m-gradient-text leading-none">
                  {s.figure}
                </div>
                <div className="mt-4 text-[15px] text-[rgb(244_244_245)]">
                  {s.label} {s.sub}
                </div>
                <div className="mt-3 m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)]">
                  {s.tail}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   09 · PRICING
   ============================================================ */
function PricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="text-center max-w-2xl mx-auto">
          <span className="m-eyebrow justify-center">
            <span className="m-pill-dot" /> Pricing
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[52px] mt-5">
            Pricing that respects you.
          </h2>
          <p className="mt-4 m-body text-[15px]">
            Free forever for 50 sends a day. Paid tiers unlock warmup, follow-ups, AI, and rotation.
            Cancel anytime — we don&rsquo;t make you call anyone.
          </p>
        </Reveal>

        <Reveal delayMs={140} className="mt-14">
          <PricingCards />
        </Reveal>

        <Reveal delayMs={200} className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[13px] text-[rgb(161_161_170)]">
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

/* ============================================================
   10 · FAQ
   ============================================================ */
function FAQSection() {
  return (
    <section id="faq" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <Reveal>
          <span className="m-eyebrow">
            <span className="m-pill-dot" /> FAQ
          </span>
          <h2 className="m-h2 text-[36px] sm:text-[48px] mt-5">
            Questions you&rsquo;ll be glad
            <br />
            we answered honestly.
          </h2>
        </Reveal>

        <Reveal delayMs={120} className="mt-12">
          <FAQAccordion />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   11 · FINAL CTA
   ============================================================ */
function FinalCTA() {
  return (
    <section className="py-28 sm:py-40 relative overflow-hidden">
      <div className="absolute inset-0 m-grid-bg opacity-60" aria-hidden />
      <div
        className="m-orb m-orb-coral"
        style={{ width: 700, height: 700, left: "50%", top: "20%", transform: "translateX(-50%)" }}
      />
      <div className="relative mx-auto max-w-3xl px-5 sm:px-8 text-center">
        <Reveal>
          <h2 className="m-display text-[44px] sm:text-[72px] leading-[0.98]">
            Your first cold email
            <br />
            in <span className="m-gradient-text">4 minutes.</span>
          </h2>
        </Reveal>
        <Reveal delayMs={100}>
          <p className="mt-6 text-[15px] text-[rgb(161_161_170)] max-w-md mx-auto">
            Probably less if your typing is good. Connect Gmail. Paste a Sheet. Hit start. That&rsquo;s it.
          </p>
        </Reveal>
        <Reveal delayMs={180} className="mt-10">
          <Link href="/signup" className="m-btn m-btn-primary text-[16px] py-3 px-6">
            Start free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </Link>
        </Reveal>
        <Reveal delayMs={240}>
          <p className="mt-5 m-mono text-[11.5px] text-[rgb(113_113_122)]">
            no card · no timer · genuinely free for 50/day
          </p>
        </Reveal>
      </div>
    </section>
  );
}

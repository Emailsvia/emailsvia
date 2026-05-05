import Link from "next/link";
import MarketingShell from "@/components/MarketingShell";

export const metadata = {
  title: "EmailsVia — Cold email that actually lands",
  description:
    "Mail merge from Gmail with built-in warmup, threaded follow-ups, and AI reply triage. Send 50 / day free, scale up to 5,000 / day from $9/mo.",
};

export default function LandingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
        <p className="text-[12px] uppercase tracking-wider text-ink-500 mb-4">
          Mailmeteor with cold-outreach DNA
        </p>
        <h1 className="text-[44px] sm:text-[56px] font-bold tracking-tight leading-[1.05]">
          Cold email that<br />actually lands.
        </h1>
        <p className="text-[16px] text-ink-600 mt-5 max-w-xl mx-auto">
          Mail merge from your own Gmail. Built-in warmup on every paid plan, threaded
          follow-ups, AI reply triage, and inbox rotation for 10K-row lists.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
          <Link href="/signup" className="btn-accent">Start free &mdash; 50/day</Link>
          <Link href="/pricing" className="btn-ghost">See pricing</Link>
        </div>
        <p className="text-[12px] text-ink-500 mt-4">
          No credit card. No trial timer. Free forever for 50 sends/day.
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Feature
            title="Warmup on every paid tier"
            body="Mailmeteor charges $24.99/mo for warmup. We include it from $9. Brand-new Gmails ramp safely from 10/day to 400/day over 14 days."
          />
          <Feature
            title="Hard-fail merge validation"
            body="Send a row missing {{Company}} and we skip it loudly instead of mailing 'Hey ,'. The #1 complaint about Mailmeteor on G2."
          />
          <Feature
            title="Inbox rotation, $39/mo"
            body="Split a 10,000-row campaign across 10 connected Gmails — each stays under its safe daily limit. No competitor at our price-point ships this."
          />
          <Feature
            title="Threaded follow-ups"
            body="Replies thread to the original message via In-Reply-To. Gmail groups them like a normal conversation, not a re-pitch."
          />
          <Feature
            title="AI reply triage"
            body="Inbound replies get classified as interested / not now / question / OOO / bounce. Filter them in one click instead of triaging 50 'thanks' replies."
          />
          <Feature
            title="OAuth, app-password fallback"
            body="Connect Gmail in two clicks. App-password sign-in stays available for accounts where OAuth is blocked by org policy."
          />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="text-[28px] font-semibold tracking-tight">Why &ldquo;via&rdquo;?</h2>
        <p className="text-[14px] text-ink-600 mt-3">
          Your campaigns send through your own Gmail address. EmailsVia is the rail, not the
          return-path. Reputation stays with your domain &mdash; the way deliverability is
          supposed to work.
        </p>
        <div className="mt-8">
          <Link href="/signup" className="btn-accent">Create free account</Link>
        </div>
      </section>
    </MarketingShell>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="sheet p-5">
      <div className="text-[14px] font-semibold mb-1.5">{title}</div>
      <p className="text-[13px] text-ink-600 leading-relaxed">{body}</p>
    </div>
  );
}

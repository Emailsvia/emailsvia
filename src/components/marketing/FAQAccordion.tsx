"use client";

import { useState } from "react";

type QA = { q: string; a: React.ReactNode };

// NOTE: keep `q` as plain Unicode — JSX renders HTML entities only inside
// markup, not inside string literals. Smart quotes go in directly.
const ITEMS: QA[] = [
  {
    q: "Will Google flag my account if I send 500 a day?",
    a: (
      <>
        Not if you ramp. Brand-new Gmails go from 10/day to 400/day over 14 days
        automatically. Established mailboxes can opt out. We pace below the throttling
        line — our whole job is to keep your inbox in good standing.
      </>
    ),
  },
  {
    q: "What happens at 50/day on the Free plan?",
    a: (
      <>
        Sending pauses for the day. Your campaign isn&rsquo;t dropped, your card
        isn&rsquo;t charged, and we don&rsquo;t email you 17 times begging you to upgrade.
        It just resumes tomorrow. Or you upgrade. Either is fine.
      </>
    ),
  },
  {
    q: "Can I cancel?",
    a: (
      <>
        From your dashboard, one click. No call. No exit interview. You keep paid
        features until the end of the billing period, then drop to Free.
      </>
    ),
  },
  {
    q: "Why “via your Gmail” — what’s the catch?",
    a: (
      <>
        No catch. Cold-email tools that send from <em>their</em> infrastructure are
        sharing IPs with the spammer two tenants over. Your domain reputation should
        live on your domain, not theirs. We just wired the rails.
      </>
    ),
  },
  {
    q: "Does AI reply triage actually work, or is it marketing-speak?",
    a: (
      <>
        It&rsquo;s real. Every inbound reply is classified into 7 intents
        (interested, not now, question, OOO, bounce, unsubscribe, other) with a
        confidence score. We default to the cheapest provider you&rsquo;ve configured
        — Groq, Gemini, or Claude — and prompt-cache so a 50K-reply month costs us
        about $2.
      </>
    ),
  },
  {
    q: "What about Google’s OAuth verification?",
    a: (
      <>
        We&rsquo;re in submission for Sensitive-Scope review. Until that&rsquo;s
        approved you&rsquo;ll see the &ldquo;unverified app&rdquo; warning on first
        connect — totally normal for a young product. App-password sign-in is
        available as a fallback and gets the same campaigns out the door.
      </>
    ),
  },
  {
    q: "Do you have a CRM?",
    a: (
      <>
        No. We&rsquo;re a sending engine, not a pipeline tool. Bring HubSpot, Attio,
        Notion — whatever you already use. Webhooks fire on every reply so your
        system of record stays in sync.
      </>
    ),
  },
  {
    q: "Can I import from a CSV or Excel file?",
    a: (
      <>
        Yes. Drop in a <code className="m-mono text-[12px]">.csv</code> or{" "}
        <code className="m-mono text-[12px]">.xlsx</code>, or paste a Google Sheets
        URL — same flow either way. Headers become merge tags, you preview the first
        few rows before sending.
      </>
    ),
  },
  {
    q: "How does inbox rotation actually work?",
    a: (
      <>
        On Scale, one campaign can send across up to 10 connected Gmails. We pick
        the least-loaded eligible sender for each recipient, and stick the same
        sender to that recipient for follow-ups so threading never breaks. No
        per-sender quota math on your end.
      </>
    ),
  },
  {
    q: "Can I use my own domain for tracking links?",
    a: (
      <>
        Yes on Scale. Custom tracking subdomain (like <code className="m-mono text-[12px]">t.yourdomain.com</code>),
        signed pixel, signed click wrapper. So a tracking-domain block can&rsquo;t
        affect your inbox.
      </>
    ),
  },
];

export default function FAQAccordion() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="border-t border-[rgb(255_255_255/0.06)]">
      {ITEMS.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="border-b border-[rgb(255_255_255/0.06)]">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer group"
              aria-expanded={isOpen}
            >
              <span className="text-[16px] sm:text-[17px] text-[rgb(244_244_245)] tracking-[-0.01em] group-hover:text-[rgb(255_140_140)] transition-colors">
                {it.q}
              </span>
              <span
                className={`flex-shrink-0 grid place-items-center w-7 h-7 rounded-full border border-[rgb(255_255_255/0.08)] text-[rgb(161_161_170)] transition-transform duration-300 ${
                  isOpen ? "rotate-45 bg-[rgb(255_99_99/0.10)] border-[rgb(255_99_99/0.25)] text-[rgb(255_140_140)]" : ""
                }`}
                aria-hidden
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M6 2v8M2 6h8" />
                </svg>
              </span>
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div className="pb-5 pr-12 text-[14.5px] leading-relaxed text-[rgb(161_161_170)]">
                  {it.a}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

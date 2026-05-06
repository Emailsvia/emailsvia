"use client";

import { useEffect, useState } from "react";

/**
 * Built-for-you tab switcher. Reads the URL ?role= param on mount via the
 * router (handled by parent if needed) — for now just controls local state.
 * Voice tone: catchy, heart-to-heart, what they actually want to hear.
 */

type Persona = {
  id: string;
  label: string;
  pain: string;
  copy: string[];
  sample: { caption: string; subject: string; pill: string; metric: string };
  plan: { name: string; price: string };
};

const PERSONAS: Persona[] = [
  {
    id: "jobseekers",
    label: "Job seekers",
    pain: "Stop refreshing your inbox at 11pm.",
    copy: [
      "You wrote forty thoughtful cold emails to hiring managers this week. Two replied. Three bounced. The rest sit in some VP's inbox, marked unread, until they aren't.",
      "We thread your follow-ups so the second touch shows up <em>under the original</em>, not as a fresh pitch they have to remember. Track who opens. Tell you the moment a reply lands. Your search ends faster.",
    ],
    sample: {
      caption: "Job hunt · 40 hiring managers · 3-step",
      subject: "Senior PM at {{Company}} — quick intro",
      pill: "Step 2 fires: no reply in 3 days",
      metric: "28% open rate",
    },
    plan: { name: "Free", price: "50/day" },
  },
  {
    id: "founders",
    label: "Founders",
    pain: "You're the salesperson now.",
    copy: [
      "You didn't start the company to babysit a spreadsheet. But here you are at 11pm, copy-pasting into Gmail, hoping you got the company name right this time.",
      "Connect Gmail. Paste the Sheet. Hit start. We'll pace it, follow up two days later if they ghost, and slack you the moment someone says <em>let's talk</em>. You go back to building.",
    ],
    sample: {
      caption: "Founder outreach · 50 design partners · 4-step sequence",
      subject: "How {{Company}} thinks about {{Problem}}",
      pill: "AI marked 3 as interested",
      metric: "9% reply rate",
    },
    plan: { name: "Starter", price: "$9/mo" },
  },
  {
    id: "sales",
    label: "Sales / SDRs",
    pain: "Your tool charges extra for the basics.",
    copy: [
      "Other outbound tools charge for warmup, gate inbox rotation behind enterprise tiers, and lock you into a quarterly contract before you&rsquo;ve even sent your first 200 prospects. You wanted to pilot a list this Tuesday — not negotiate a procurement cycle.",
      "Run the pilot on us. Inbox rotation across 10 Gmails when you scale. Strict-merge so you never burn a row on <em>Hi ,</em>. AI triage that makes Monday morning feel like Friday.",
    ],
    sample: {
      caption: "SDR sequence · 1,500/day cap · 3-sender rotation",
      subject: "Quick question about {{Company}}'s outbound stack",
      pill: "OOO replies: auto-trashed",
      metric: "1,243 sent today",
    },
    plan: { name: "Growth", price: "$19/mo" },
  },
  {
    id: "recruiters",
    label: "Recruiters",
    pain: "You're sourcing 300 a week. You can't read every reply.",
    copy: [
      "Half your follow-ups never threaded right and now candidates think you're spam. The good ones already accepted somewhere else by the time you got back to them.",
      "We pre-warm your inbox so you don't get throttled, thread the second touch via In-Reply-To (so it lands as a reply, not a re-pitch), and surface every <em>interested</em> at the top of your dashboard.",
    ],
    sample: {
      caption: "Passive-candidate outreach · senior PM · 2-step",
      subject: "{{FirstName}}, saw your work at {{Previous}}",
      pill: "12 interested · 4 questions",
      metric: "21% reply rate",
    },
    plan: { name: "Growth", price: "$19/mo" },
  },
  {
    id: "marketers",
    label: "Marketers",
    pain: "Newsletter platforms can't do 1:1. Sales tools can't do copy.",
    copy: [
      "Mailchimp is for the 50,000-person list. Outreach is for the SDR floor. You have 500 partners, 200 influencers, a launch on Tuesday — and nothing in between.",
      "Run a 1:1-feeling campaign with two A/B variants. Auto-promote the winner after twelve replies. Watch click-through and reply-rate side by side. Pretend it took you three hours, not three.",
    ],
    sample: {
      caption: "Launch outreach · 500 contacts · A/B 50/50",
      subject: "A · Quick intro    B · A small thing for {{Industry}}",
      pill: "Winner: variant B (52% lift)",
      metric: "11.4% click",
    },
    plan: { name: "Growth", price: "$19/mo" },
  },
  {
    id: "support",
    label: "Customer support",
    pain: "Half your check-ins land in spam.",
    copy: [
      "<em>Is anyone there?</em> No, your follow-up just didn't thread to the original ticket. They saw a fresh email from a no-reply alias and assumed you'd given up.",
      "Send proactive check-ins, NPS asks, and launch heads-ups <em>from a real person's Gmail</em>. We classify what comes back — questions, intent, OOO — so you triage in seconds.",
    ],
    sample: {
      caption: "Proactive 30-day check-in · 800 customers",
      subject: "How's {{Product}} treating you so far?",
      pill: "Intent: question · 47 replies",
      metric: "39% reply rate",
    },
    plan: { name: "Starter", price: "$9/mo" },
  },
  {
    id: "freelancers",
    label: "Freelancers",
    pain: "You went from one client to twelve. The pipeline is duct-taped.",
    copy: [
      "Your CRM is a Notes app. Your follow-up system is a calendar reminder you snooze. You can't justify Pipedrive and you shouldn't have to.",
      "EmailsVia is a $9 line item that lets you reach old clients for repeat work, prospect new ones, and keep every thread tidy in your own Gmail. No CRM. No sales team. Just you, a list, and a tool that respects it.",
    ],
    sample: {
      caption: "Past-client repeat-work outreach · 80 contacts",
      subject: "Following up on the {{Project}} we shipped",
      pill: "5 booked discovery calls",
      metric: "4 days end-to-end",
    },
    plan: { name: "Starter", price: "$9/mo" },
  },
];

export default function AudienceTabs() {
  const [active, setActive] = useState(PERSONAS[0].id);
  const persona = PERSONAS.find((p) => p.id === active) ?? PERSONAS[0];

  // Sync with the URL: ?role=founders sets the initial tab. Also listens for
  // the `emv:role` event the CommandBar fires when navigating in-page.
  useEffect(() => {
    const ids = new Set(PERSONAS.map((p) => p.id));
    const apply = (raw: string | null) => {
      if (raw && ids.has(raw)) setActive(raw);
    };
    apply(new URLSearchParams(window.location.search).get("role"));

    const onRole = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      apply(detail ?? null);
    };
    window.addEventListener("emv:role", onRole);
    return () => window.removeEventListener("emv:role", onRole);
  }, []);

  return (
    <div>
      {/* Tabs row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-8">
        {PERSONAS.map((p) => {
          const isActive = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(p.id)}
              className={`m-mono text-[12px] px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
                isActive
                  ? "bg-[rgb(244_244_245)] text-[rgb(10_10_11)]"
                  : "bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)] hover:bg-[rgb(255_255_255/0.08)] hover:text-[rgb(244_244_245)]"
              }`}
              aria-pressed={isActive}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12 items-start">
        {/* Left: narrative */}
        <div key={persona.id} className="space-y-5">
          <div className="m-eyebrow">
            <span className="m-pill-dot" /> Built for {persona.label.toLowerCase()}
          </div>
          <h3 className="m-h2 text-[34px] sm:text-[40px]">{persona.pain}</h3>
          <div className="space-y-4 m-body text-[15px] max-w-xl">
            {persona.copy.map((line, i) => (
              <p key={i} dangerouslySetInnerHTML={{ __html: line }} />
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="m-pill">
              Recommended: <span className="text-[rgb(244_244_245)] ml-1">{persona.plan.name}</span>
              <span className="text-[rgb(113_113_122)] ml-1">· {persona.plan.price}</span>
            </span>
          </div>
        </div>

        {/* Right: sample mock */}
        <div className="m-glass rounded-2xl p-5 md:p-6 m-gradient-border">
          <div className="m-mono text-[11px] uppercase tracking-wider text-[rgb(113_113_122)] mb-4">
            {persona.sample.caption}
          </div>
          <div className="space-y-3">
            <div>
              <div className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)]">Subject</div>
              <div className="m-mono text-[13px] text-[rgb(244_244_245)] mt-0.5 break-words">{persona.sample.subject}</div>
            </div>
            <div className="m-hairline" />
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[12px] text-[rgb(244_244_245)]">
                <span className="m-pill-dot" />
                {persona.sample.pill}
              </span>
              <span className="m-mono text-[12px] text-[rgb(255_140_140)]">{persona.sample.metric}</span>
            </div>
            <div className="m-hairline" />
            <SampleSparkline />
          </div>
        </div>
      </div>
    </div>
  );
}

/* Tiny SVG sparkline — no library, deterministic */
function SampleSparkline() {
  const pts = [3, 5, 4, 7, 6, 9, 8, 11, 10, 14, 13, 17];
  const max = Math.max(...pts);
  const W = 320;
  const H = 56;
  const step = W / (pts.length - 1);
  const path = pts
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${H - (v / max) * (H - 8) - 4}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgb(255 99 99)" />
          <stop offset="100%" stopColor="rgb(255 159 67)" />
        </linearGradient>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(255 99 99 / 0.18)" />
          <stop offset="100%" stopColor="rgb(255 99 99 / 0)" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#sparkFill)" />
      <path d={path} fill="none" stroke="url(#spark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

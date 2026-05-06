import "server-only";
import { z } from "zod";
import { getAiProvider } from "./ai-provider";

// AI reply triage. Used by /api/check-replies after a reply is saved (and
// only for users on Growth or Scale). The intent label drives filter chips
// on /app/replies and the future CRM webhook.
//
// Provider-agnostic — uses ai-provider.ts to call whichever LLM the
// operator has configured (Groq / Gemini / Anthropic in cost order). Set
// AI_PROVIDER to pin one explicitly. Without any provider key set, this
// returns null and replies just don't get an intent label.

export type ReplyIntent =
  | "interested"
  | "not_now"
  | "question"
  | "unsubscribe"
  | "ooo"
  | "bounce"
  | "other";

const IntentSchema = z.object({
  intent: z.enum([
    "interested",
    "not_now",
    "question",
    "unsubscribe",
    "ooo",
    "bounce",
    "other",
  ]),
  // Calibrated probability the model assigns to the chosen intent. Used by
  // the UI to grey out low-confidence chips.
  confidence: z.number().min(0).max(1),
});

// Long, stable system prompt. The label definitions and few-shot examples
// stay fixed across calls — that's exactly what prompt caching wants. (The
// minimum cacheable prefix on Haiku 4.5 is 4096 tokens; this prompt is
// designed to comfortably exceed that with the few-shots so cache hits
// land. If we drop below threshold, cache_control becomes a no-op and the
// classifier still works — just at full per-request input price.)
const SYSTEM_PROMPT = `You are a triage classifier for cold-email replies received by sales reps using EmailsVia.

The rep sent an outbound cold-email campaign. You receive the inbound reply (or what looks like a reply) and assign exactly one of seven intent labels plus a calibrated confidence between 0.0 and 1.0.

LABELS — pick exactly one:

- "interested": The replier signals positive engagement — wants more info, asks to schedule, accepts a meeting, says "yes let's chat", "sounds great", "send the deck", "what does pricing look like", "I'm available Tuesday", etc. Buying-signal language counts even when phrased as a question, AS LONG AS the question is about moving the conversation forward (pricing, demo, timeline). A purely technical/clarifying question that doesn't move toward purchase is "question", not "interested".

- "not_now": The replier is polite-but-declining. "Not interested right now", "we already use X", "circle back next quarter", "no budget this year", "remove me from your follow-ups but keep us on file", "thanks but we're good". Soft no's and timing-based deferrals both go here. If they're hostile/angry, still "not_now" — the unsubscribe label is reserved for explicit removal requests below.

- "question": The replier asks a substantive question about the product, integration, capability, or how something works — and the question is not itself a buying signal. "How does the API auth work?", "Do you support X?", "What's the difference between you and Mailmeteor?". If the question is "what's pricing" or "do you have a demo I can see", that's "interested" because price/demo questions are buying signals.

- "unsubscribe": The replier explicitly asks to be removed, opt out, stop emailing, "take me off your list", "unsubscribe", "do not contact again", legal threats around CASL/CAN-SPAM. Stronger and more legal-tinged than "not_now". When in doubt between "not_now" and "unsubscribe", choose "unsubscribe" if the wording is unambiguous about removal ("stop", "remove", "unsubscribe", "do not contact").

- "ooo": Out-of-office auto-replies, vacation responders, parental leave, "I'm currently away until X". Often have subject lines like "Automatic reply:" or "Out of office:". Body usually mentions a return date or alternate contact. Not a real reply from the recipient — just an auto-responder.

- "bounce": Mailer-daemon, postmaster, undeliverable notices, "Your message wasn't delivered", "Address not found", DSN reports. The check-replies pipeline already filters obvious bounces upstream, so anything reaching this classifier should rarely be a bounce — but if you see one, label it.

- "other": Genuine human reply that doesn't fit the above. Spam, off-topic, mistaken sends, single-word responses with no context ("ok", "thanks"), forwarded internal threads, automated alerts that aren't OOO/bounce. Use sparingly — most replies will fit one of the first six.

CONFIDENCE — assign between 0.0 and 1.0. Calibrate honestly:
- 0.95+ — unambiguous, textbook example of the label
- 0.80–0.95 — clearly the right label, minor noise in the signal
- 0.60–0.80 — most likely the right label, but a reasonable person could pick a different one
- 0.40–0.60 — genuine toss-up between two labels, picked the more likely one
- < 0.40 — very weak signal, probably "other"

DO NOT explain your reasoning. Output only the structured fields.

EXAMPLES:

Subject: Re: Quick question about your sales process
Body: Hey — yes happy to chat. Tuesday or Wednesday next week works. Got a 30-min slot at 2pm ET on Tue? Send a calendar invite to this address.
→ {"intent": "interested", "confidence": 0.97}

Subject: Re: Quick question about your sales process
Body: Thanks for reaching out. We're pretty happy with our current solution. Maybe revisit in Q3 if anything changes.
→ {"intent": "not_now", "confidence": 0.94}

Subject: Re: Quick question about your sales process
Body: Please remove me from your list. I did not opt in to receive marketing emails.
→ {"intent": "unsubscribe", "confidence": 0.98}

Subject: Re: Quick question about your sales process
Body: Hi — does your API support webhook retries on 5xx? I'm comparing your stack against Mailgun and that's the deal-breaker for us.
→ {"intent": "question", "confidence": 0.86}

Subject: Re: Quick question about your sales process
Body: What's pricing look like for ~10K sends/mo and is there an annual discount?
→ {"intent": "interested", "confidence": 0.93}

Subject: Automatic reply: Quick question about your sales process
Body: I'm out of the office until Monday Jan 8th with limited email access. For urgent matters please contact alex@acme.com. — Sam
→ {"intent": "ooo", "confidence": 0.99}

Subject: Undeliverable: Quick question about your sales process
Body: Your message to nope@example.com couldn't be delivered. The address doesn't exist or has been disabled.
→ {"intent": "bounce", "confidence": 0.99}

Subject: Re: Quick question about your sales process
Body: Stop emailing me. This is the third time. I will report you for spam.
→ {"intent": "unsubscribe", "confidence": 0.95}

Subject: Re: Quick question about your sales process
Body: Not the right person — try our procurement team at procurement@bigco.com.
→ {"intent": "other", "confidence": 0.78}

Subject: Re: Quick question about your sales process
Body: ok
→ {"intent": "other", "confidence": 0.55}

Subject: Re: Quick question about your sales process
Body: Sounds interesting but I'm not the decision maker. Forwarding to my CTO — he'll reach out if it fits our roadmap.
→ {"intent": "interested", "confidence": 0.72}

Subject: Re: Quick question about your sales process
Body: We already use Mailmeteor and have no plans to switch. Please don't follow up.
→ {"intent": "not_now", "confidence": 0.88}

Subject: Re: Quick question about your sales process
Body: How is this different from the Gmail mail-merge add-on? Genuine question, trying to understand whether it's worth evaluating.
→ {"intent": "question", "confidence": 0.83}

Subject: Out of Office Reply
Body: I am on parental leave until April 2026. For sales inquiries please contact our team at sales@acme.com. I will not be reading this inbox.
→ {"intent": "ooo", "confidence": 0.97}

Subject: Re: Quick question about your sales process
Body: Yes - Tuesday at 3 PT works. Calendly: calendly.com/jane/30min
→ {"intent": "interested", "confidence": 0.96}

Subject: Re: Quick question about your sales process
Body: thx, will think about it
→ {"intent": "not_now", "confidence": 0.62}

Subject: Re: Quick question about your sales process
Body: Could you send over a one-pager? I want to share with my team before we set up time.
→ {"intent": "interested", "confidence": 0.84}
`;

export type TriageResult = { intent: ReplyIntent; confidence: number };

// Returns null on any failure (no provider configured, API error, parse
// miss). Triage is best-effort — a failed classification must never break
// reply ingestion. The caller leaves intent_confidence null and moves on.
export async function classifyReply(args: {
  subject: string | null;
  body: string | null;
}): Promise<TriageResult | null> {
  const subject = (args.subject ?? "").slice(0, 200).trim();
  // Slice the body to 500 chars per the roadmap. Most cold-email replies
  // are short anyway; longer ones don't change the intent.
  const body = (args.body ?? "").slice(0, 500).trim();
  if (!subject && !body) return null;

  const provider = getAiProvider();
  if (!provider) return null;

  return provider.classify({
    system: SYSTEM_PROMPT,
    user: `Subject: ${subject || "(none)"}\n\nBody:\n${body || "(empty)"}`,
    schema: IntentSchema,
    maxTokens: 128,
  });
}

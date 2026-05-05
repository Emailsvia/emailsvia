import MarketingShell from "@/components/MarketingShell";

export const metadata = {
  title: "Terms of Service — EmailsVia",
  description: "The terms you agree to when using EmailsVia.",
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16 text-[14px] leading-relaxed text-ink-700">
        <h1 className="text-[32px] font-bold tracking-tight text-ink mb-2">Terms of Service</h1>
        <p className="text-[12px] text-ink-500 mb-8">Last updated: 2026-05-04</p>

        <Section title="Agreement">
          By creating an EmailsVia account or sending email through the service you agree to
          these terms. If you don&rsquo;t agree, don&rsquo;t use the service.
        </Section>

        <Section title="What EmailsVia is">
          A self-serve mail-merge tool that sends from <i>your own</i> Gmail account via the
          Gmail API or SMTP app password. Replies arrive in your own inbox; we surface a
          mirror inside the dashboard for triage.
        </Section>

        <Section title="Acceptable use">
          You agree not to use EmailsVia to:
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>Send unsolicited commercial mail to addresses you have no relationship with.</li>
            <li>Impersonate another person or business.</li>
            <li>Send anything illegal, defamatory, threatening, sexually explicit involving minors, or that infringes intellectual property.</li>
            <li>Distribute malware or phishing payloads.</li>
            <li>
              Bypass deliverability safeguards (e.g. disabling warmup the day you connect a
              brand-new Gmail and blasting 5,000 sends).
            </li>
          </ul>
          We reserve the right to pause campaigns showing spam-like patterns (sudden bounce
          spikes, abuse complaints, Google-side blocks) and to terminate accounts that
          repeatedly violate these rules.
        </Section>

        <Section title="Your responsibilities">
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>Recipient consent. You confirm you have a legitimate basis to email everyone you upload.</li>
            <li>Local compliance (CAN-SPAM, CASL, GDPR, ePrivacy, etc.). The unsubscribe footer is a tool we provide; using it correctly is on you.</li>
            <li>Keeping your Gmail account secure (2FA, recovery options, etc.).</li>
            <li>Truthful billing information.</li>
          </ul>
        </Section>

        <Section title="Plans, billing, and refunds">
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>The Free tier is, well, free.</li>
            <li>
              Paid plans are billed monthly via Stripe. Sales tax / VAT / GST is calculated
              automatically by Stripe Tax and added at checkout.
            </li>
            <li>Cancel anytime &mdash; you keep paid features until the end of the period, then drop to Free.</li>
            <li>
              Refunds are not automatic. If something goes seriously wrong (we charged you while
              the service was down, etc.) email{" "}
              <a className="text-ink underline" href="mailto:hello@emailsvia.com">hello@emailsvia.com</a>
              {" "}and we&rsquo;ll sort it out.
            </li>
            <li>
              We may change pricing on future billing cycles &mdash; you&rsquo;ll get at least
              14 days&rsquo; notice via email before any change applies to you.
            </li>
          </ul>
        </Section>

        <Section title="Service availability">
          We aim for high availability but make no SLA guarantees on the Free tier. Paid
          plans get best-effort uptime; planned maintenance windows are announced in-app.
        </Section>

        <Section title="Termination">
          You can delete your account at any time (from inside the app, or by emailing us).
          We can suspend or terminate accounts for violations of the Acceptable Use section,
          for non-payment, or if continuing to serve you would put other users&rsquo;
          deliverability at risk.
        </Section>

        <Section title="Liability">
          The service is provided &ldquo;as is&rdquo;. To the maximum extent permitted by law
          our liability is capped at what you paid us in the 12 months preceding the claim.
          We&rsquo;re not liable for lost profits, lost mail-server reputation, or
          consequential damages arising from your use of the service.
        </Section>

        <Section title="Changes to these terms">
          If we change these terms materially we&rsquo;ll send a heads-up email at least 14
          days before the change takes effect. Continuing to use EmailsVia after the change
          counts as agreement.
        </Section>

        <Section title="Contact">
          <a className="text-ink underline" href="mailto:hello@emailsvia.com">hello@emailsvia.com</a>
        </Section>
      </article>
    </MarketingShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[18px] font-semibold text-ink mt-2 mb-2">{title}</h2>
      {children}
    </section>
  );
}

import MarketingShell from "@/components/MarketingShell";

export const metadata = {
  title: "Privacy Policy — EmailsVia",
  description: "How EmailsVia collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16 text-[14px] leading-relaxed text-ink-700">
        <h1 className="text-[32px] font-bold tracking-tight text-ink mb-2">Privacy Policy</h1>
        <p className="text-[12px] text-ink-500 mb-8">Last updated: 2026-05-04</p>

        <Section title="What this policy covers">
          EmailsVia (&ldquo;we&rdquo;) is a self-serve mail-merge product operated by the
          author of <a className="text-ink underline" href="https://emailsvia.com">emailsvia.com</a>.
          This policy explains what data we collect when you use the service, how we use it,
          and how to remove it.
        </Section>

        <Section title="Data we collect">
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>
              <b>Account data</b>: email, password hash (or Google OAuth identity), the
              subscriptions / billing rows tied to your account.
            </li>
            <li>
              <b>Sender authorization</b>: when you connect a Gmail address, we store a
              long-lived OAuth refresh token (encrypted with AES-GCM) plus a short-lived
              access token. We never see or store your Google password.
            </li>
            <li>
              <b>Campaign content</b>: the recipient lists (CSVs / Sheets you upload), email
              templates, attachments, and per-recipient send/open/click/reply history you
              create inside the product.
            </li>
            <li>
              <b>Usage data</b>: send counts per day, error logs, basic request metadata
              (IP, user-agent) for security and abuse-detection purposes.
            </li>
            <li>
              <b>Payment data</b>: handled entirely by Stripe. We store a customer id and
              the plan you&rsquo;re on. We never see your card number.
            </li>
          </ul>
        </Section>

        <Section title="Use of Google APIs (Gmail send + read)">
          <p>
            EmailsVia&rsquo;s use and transfer of information received from Google APIs to any
            other app will adhere to the{" "}
            <a
              className="text-ink underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mt-3">
            <li>
              We request the <code>gmail.send</code> scope to send your campaigns from your own
              Gmail address (the &ldquo;via&rdquo; in EmailsVia: messages route through your
              outbox, not ours).
            </li>
            <li>
              We request the <code>gmail.readonly</code> scope to detect inbound replies to
              campaigns you sent and surface them in the Replies inbox. We only read messages
              dated after a reply-detection window (currently 7 days).
            </li>
            <li>
              We do not use Gmail data to train models, do not sell or share it with
              advertisers, and do not allow humans to read it except (a) with your explicit
              permission for support, (b) for security investigations, or (c) to comply with
              applicable law.
            </li>
            <li>
              You can revoke access at any time at{" "}
              <a
                className="text-ink underline"
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/permissions
              </a>
              {" "}or by deleting the sender from your EmailsVia dashboard.
            </li>
          </ul>
        </Section>

        <Section title="How we use the data">
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>To deliver the product features you signed up for.</li>
            <li>To bill you (via Stripe) for paid plans.</li>
            <li>To detect and stop abuse (e.g. spam, sudden bounce-rate spikes).</li>
            <li>To send transactional email (receipts, security alerts, password resets).</li>
          </ul>
          <p className="mt-3">
            We do not sell your data, and we do not use it for advertising.
          </p>
        </Section>

        <Section title="Sub-processors">
          <p>We rely on a small set of vendors to operate the service:</p>
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li><b>Supabase</b> &mdash; Postgres database, file storage, auth provider.</li>
            <li><b>Vercel</b> &mdash; hosting and edge runtime.</li>
            <li><b>Stripe</b> &mdash; payment processing and tax calculation.</li>
            <li><b>Google</b> &mdash; for the Gmail API integration you authorize per sender.</li>
          </ul>
        </Section>

        <Section title="Retention and deletion">
          <p>
            You can delete any piece of campaign data from inside the app at any time.
            Deleting your account removes all associated rows (campaigns, recipients,
            tracking events, replies, senders, subscriptions) and revokes Gmail access.
            Backups are retained for at most 30 days. To delete an account email{" "}
            <a className="text-ink underline" href="mailto:hello@emailsvia.com">
              hello@emailsvia.com
            </a>
            {" "}from the address attached to the account.
          </p>
        </Section>

        <Section title="Security">
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li>All traffic is HTTPS only.</li>
            <li>Sender Gmail credentials are encrypted at rest with AES-256-GCM.</li>
            <li>Tracking and unsubscribe URLs are HMAC-signed; tampering invalidates them.</li>
            <li>
              Database access is scoped per-tenant via Postgres RLS policies; one user
              cannot read another user&rsquo;s rows.
            </li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions or data-deletion requests:{" "}
            <a className="text-ink underline" href="mailto:hello@emailsvia.com">
              hello@emailsvia.com
            </a>
            .
          </p>
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

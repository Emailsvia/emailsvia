import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";
import UnsubscribeClient from "./UnsubscribeClient";
import Logo from "@/components/Logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyToken("u", token);

  if (!id) {
    return (
      <Shell>
        <Card
          eyebrow="Link issue"
          title="Invalid link"
          body="This link isn't valid or has expired. If you'd like to stop receiving emails, reply to the sender directly — they'll handle it."
          tone="warn"
        />
      </Shell>
    );
  }

  const db = supabaseAdmin();
  const { data: recipient } = await db
    .from("recipients")
    .select("email, campaign_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!recipient) {
    return (
      <Shell>
        <Card
          eyebrow="Not found"
          title="We couldn't find that subscription"
          body="Looks like this email was never on our list — or has already been removed."
          tone="warn"
        />
      </Shell>
    );
  }

  const already = recipient.status === "unsubscribed";

  return (
    <Shell>
      {already ? (
        <Card
          eyebrow="Already unsubscribed"
          title="You're all set"
          body={
            <>
              No more messages will reach{" "}
              <span className="text-[rgb(244_244_245)] font-mono text-[13.5px]">{recipient.email}</span>.
              Sorry for the noise it took to get there.
            </>
          }
          tone="ok"
        />
      ) : (
        <div className="m-glass rounded-2xl p-6 sm:p-7 m-gradient-border">
          <span className="m-pill mb-4">
            <span className="m-pill-dot" />
            <span>One click</span>
          </span>
          <h1 className="m-display text-[28px] sm:text-[32px] leading-[1.05]">
            Unsubscribe?
          </h1>
          <p className="m-body text-[14.5px] mt-3">
            We&rsquo;ll stop emailing{" "}
            <span className="text-[rgb(244_244_245)] font-mono text-[13.5px]">{recipient.email}</span>{" "}
            from this sender — including any scheduled follow-ups.
          </p>
          <div className="mt-6">
            <UnsubscribeClient token={token} email={recipient.email} />
          </div>
          <p className="text-[11.5px] text-[rgb(113_113_122)] mt-5 text-center">
            We don&rsquo;t make you log in. We don&rsquo;t ask why. One click, done.
          </p>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-canvas min-h-screen relative overflow-hidden flex items-center justify-center p-5 sm:p-8">
      <div
        className="m-orb m-orb-coral pointer-events-none"
        style={{ width: 460, height: 460, left: "-10%", top: "-15%", opacity: 0.35 }}
        aria-hidden
      />
      <div
        className="m-orb m-orb-amber pointer-events-none"
        style={{ width: 380, height: 380, right: "-12%", bottom: "-10%", opacity: 0.30 }}
        aria-hidden
      />

      <Link
        href="/"
        className="absolute top-5 left-5 inline-flex items-center gap-2 text-[rgb(244_244_245)] hover:opacity-90 transition-opacity"
      >
        <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)]">
          <Logo size={16} />
        </span>
        <span className="font-semibold text-[14px] tracking-[-0.01em]">EmailsVia</span>
      </Link>

      <div className="relative w-full max-w-[460px]">{children}</div>
    </div>
  );
}

function Card({
  eyebrow, title, body, tone,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  tone: "ok" | "warn";
}) {
  const styles = tone === "ok"
    ? { border: "rgb(16 185 129 / 0.30)", bg: "rgb(16 185 129 / 0.06)", icon: "rgb(110 231 183)", iconBg: "rgb(16 185 129 / 0.18)" }
    : { border: "rgb(255 159 67 / 0.30)", bg: "rgb(255 159 67 / 0.06)", icon: "rgb(255 180 110)", iconBg: "rgb(255 159 67 / 0.18)" };
  return (
    <div
      className="rounded-2xl p-6 sm:p-7 border"
      style={{ borderColor: styles.border, background: styles.bg }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid place-items-center w-7 h-7 rounded-full shrink-0"
          style={{ background: styles.iconBg, color: styles.icon }}
          aria-hidden
        >
          {tone === "ok" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" />
            </svg>
          )}
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-[rgb(161_161_170)]">
            {eyebrow}
          </div>
          <h1 className="m-display text-[24px] sm:text-[28px] leading-[1.1] mt-1.5">{title}</h1>
          <p className="text-[14px] text-[rgb(209_209_213)] mt-3 leading-relaxed">{body}</p>
        </div>
      </div>
      <div className="mt-6 pt-5 border-t border-[rgb(255_255_255/0.06)]">
        <Link
          href="/"
          className="m-btn m-btn-ghost text-[13px] py-2 inline-flex"
        >
          Back to EmailsVia
        </Link>
      </div>
    </div>
  );
}

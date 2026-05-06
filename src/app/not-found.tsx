import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Not found — EmailsVia",
};

// Catches anything outside the marketing/auth/app zones, plus orphaned
// /app/* paths after a campaign or sender id was deleted. Reuses the
// marketing canvas so it never looks like a crash.
export default function NotFound() {
  return (
    <div className="marketing-canvas min-h-screen relative overflow-hidden flex items-center justify-center p-5 sm:p-8">
      <div
        className="m-orb m-orb-coral pointer-events-none"
        style={{ width: 540, height: 540, left: "50%", top: "20%", transform: "translateX(-50%)", opacity: 0.4 }}
        aria-hidden
      />
      <div className="absolute inset-0 m-grid-bg opacity-50" aria-hidden />

      <Link
        href="/"
        className="absolute top-5 left-5 inline-flex items-center gap-2 text-[rgb(244_244_245)] hover:opacity-90 transition-opacity"
      >
        <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)]">
          <Logo size={16} />
        </span>
        <span className="font-semibold text-[14px] tracking-[-0.01em]">EmailsVia</span>
      </Link>

      <div className="relative text-center max-w-md">
        <span className="m-pill mx-auto">
          <span className="m-pill-dot" />
          <span>Lost in the void</span>
        </span>

        <h1 className="m-display text-[88px] sm:text-[112px] leading-[0.95] mt-6">
          <span className="m-gradient-text">404</span>
        </h1>

        <p className="text-[15px] text-[rgb(161_161_170)] mt-4">
          That page either moved, never existed, or you found a link we should know about.
        </p>

        <div className="flex items-center justify-center gap-2 mt-8 flex-wrap">
          <Link href="/" className="m-btn m-btn-ghost text-[14px] py-2.5 px-4">
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 2L3 6l4 4" />
            </svg>
            Back to site
          </Link>
          <Link href="/app" className="m-btn m-btn-primary text-[14px] py-2.5 px-4">
            Go to app
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </Link>
        </div>

        <p className="m-mono text-[11.5px] text-[rgb(113_113_122)] mt-8">
          Found a broken link? Reply to <a href="mailto:hello@emailsvia.com" className="text-[rgb(244_244_245)] underline decoration-[rgb(255_99_99/0.5)] underline-offset-[3px] hover:decoration-[rgb(255_99_99)] transition-colors">hello@emailsvia.com</a>.
        </p>
      </div>
    </div>
  );
}

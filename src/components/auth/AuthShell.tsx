"use client";

import Link from "next/link";
import Logo from "@/components/Logo";

/**
 * Shared shell for /login, /signup, /forgot.
 *
 * Split-screen on lg+, centered on mobile. Left panel is the brand pillar
 * (passed as `side`) and is hidden below lg so the form is always primary
 * on small screens. The whole shell forces dark mode via .marketing-canvas.
 */
export default function AuthShell({
  children,
  side,
}: {
  children: React.ReactNode;
  side?: React.ReactNode;
}) {
  const split = Boolean(side);
  return (
    <div className="marketing-canvas min-h-screen relative overflow-hidden">
      {/* Quiet ambient orbs — less busy than the landing hero */}
      <div
        className="m-orb m-orb-coral pointer-events-none"
        style={{ width: 520, height: 520, left: "-10%", top: "-15%", opacity: 0.4 }}
      />
      <div
        className="m-orb m-orb-amber pointer-events-none"
        style={{ width: 460, height: 460, right: "-12%", bottom: "-10%", opacity: 0.35 }}
      />

      {/* Top brand strip */}
      <header className="absolute top-0 left-0 right-0 z-30 px-5 sm:px-7 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[rgb(244_244_245)] hover:opacity-90 transition-opacity"
        >
          <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)]">
            <Logo size={16} />
          </span>
          <span className="font-semibold text-[15px] tracking-[-0.01em]">EmailsVia</span>
        </Link>
        <Link
          href="/"
          className="text-[13px] text-[rgb(161_161_170)] hover:text-[rgb(244_244_245)] transition-colors inline-flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 2L3 6l4 4" />
          </svg>
          Back to site
        </Link>
      </header>

      <div
        className={`relative min-h-screen ${
          split
            ? "grid grid-cols-1 lg:grid-cols-[1.05fr_1fr]"
            : "flex items-center justify-center"
        }`}
      >
        {split && (
          <aside className="hidden lg:flex relative items-center justify-center px-12 xl:px-16 py-16 border-r border-[rgb(255_255_255/0.06)]">
            <div className="absolute inset-0 m-grid-bg opacity-60" aria-hidden />
            <div className="relative z-10 w-full max-w-md">{side}</div>
          </aside>
        )}

        <div className="relative flex items-center justify-center px-5 sm:px-8 py-24 lg:py-16">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import CommandBar, { CommandBarTrigger } from "@/components/marketing/CommandBar";

/**
 * Marketing shell — dark canvas, floating glass nav, command bar wired in.
 * Used by /, /pricing, /privacy, /terms.
 */
export default function MarketingShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="marketing-canvas min-h-screen flex flex-col">
      <CommandBar />

      {/* Floating glass nav */}
      <header className="fixed top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-50 pointer-events-none">
        <div
          className={`pointer-events-auto mx-auto max-w-6xl rounded-2xl transition-all duration-300 ${
            scrolled
              ? "bg-[rgb(10_10_11/0.78)] border border-[rgb(255_255_255/0.06)] backdrop-blur-xl"
              : "bg-transparent border border-transparent"
          }`}
        >
          <div className="px-3 sm:px-4 h-14 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 text-[rgb(244_244_245)] hover:opacity-90 transition-opacity">
              <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)]">
                <Logo size={16} />
              </span>
              <span className="font-semibold text-[15px] tracking-[-0.01em]">EmailsVia</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1 text-[13px]">
              <NavLink href="#features">Features</NavLink>
              <NavLink href="#audiences">Use cases</NavLink>
              <NavLink href="/pricing">Pricing</NavLink>
              <NavLink href="#faq">FAQ</NavLink>
            </nav>

            <div className="flex items-center gap-2">
              <CommandBarTrigger className="hidden sm:inline-flex" />
              <Link
                href="/login"
                className="hidden sm:inline-flex m-btn-link text-[13px] px-3 py-1.5 text-[rgb(161_161_170)] hover:text-[rgb(244_244_245)] cursor-pointer"
              >
                Sign in
              </Link>
              <Link href="/signup" className="m-btn m-btn-primary text-[13px] py-1.5 px-3">
                Start free
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-24">{children}</main>

      <Footer />
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-lg text-[rgb(161_161_170)] hover:text-[rgb(244_244_245)] hover:bg-[rgb(255_255_255/0.04)] transition-colors cursor-pointer"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="mt-32 pt-14 pb-10 border-t border-[rgb(255_255_255/0.06)]">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-12 pb-12">
          <div className="col-span-2">
            <Link href="/" className="inline-flex items-center gap-2 text-[rgb(244_244_245)]">
              <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] border border-[rgb(255_255_255/0.08)]">
                <Logo size={16} />
              </span>
              <span className="font-semibold text-[15px] tracking-[-0.01em]">EmailsVia</span>
            </Link>
            <p className="mt-3 text-[13px] text-[rgb(161_161_170)] max-w-xs leading-relaxed">
              Cold email that doesn&rsquo;t feel cold. Sends through your own Gmail, paced like a human, read like one too.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 m-pill">
              <span className="m-pill-dot" style={{ background: "rgb(16 185 129)" }} />
              <span>All systems normal</span>
            </div>
          </div>

          <FooterCol title="Product">
            <FooterLink href="/#features">Features</FooterLink>
            <FooterLink href="/#audiences">Use cases</FooterLink>
            <FooterLink href="/pricing">Pricing</FooterLink>
            <FooterLink href="/#faq">FAQ</FooterLink>
          </FooterCol>

          <FooterCol title="Resources">
            <FooterLink href="/#how">How it works</FooterLink>
            <FooterLink href="mailto:hello@emailsvia.com">Get support</FooterLink>
          </FooterCol>

          <FooterCol title="Company">
            <FooterLink href="/privacy">Privacy</FooterLink>
            <FooterLink href="/terms">Terms</FooterLink>
            <FooterLink href="mailto:hello@emailsvia.com">Contact</FooterLink>
          </FooterCol>
        </div>

        <div className="border-t border-[rgb(255_255_255/0.06)] pt-6 flex items-center justify-between flex-wrap gap-3 text-[12px] text-[rgb(113_113_122)]">
          <span>&copy; {new Date().getFullYear()} EmailsVia. Built with care.</span>
          <span className="m-mono">Made for people who&rsquo;d rather write one good email than fifty bad ones.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)] mb-3">
        {title}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-[13px] text-[rgb(161_161_170)] hover:text-[rgb(244_244_245)] transition-colors w-fit cursor-pointer"
    >
      {children}
    </Link>
  );
}

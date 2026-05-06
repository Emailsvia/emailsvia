"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import CommandPalette from "@/components/CommandPalette";
import AppAlerts from "@/components/AppAlerts";

const NAV = [
  { href: "/app", label: "Campaigns", icon: CampaignIcon },
  { href: "/app/replies", label: "Replies", icon: ReplyIcon },
  { href: "/app/senders", label: "Senders", icon: MailIcon },
  { href: "/app/billing", label: "Billing", icon: BillingIcon },
  { href: "/app/keys", label: "API keys", icon: KeyIcon },
  { href: "/app/webhooks", label: "Webhooks", icon: WebhookIcon },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/app") {
      // Campaigns lives at /app and /app/campaigns/* — both should highlight
      // the Campaigns nav entry without also matching /app/senders, etc.
      return pathname === "/app" || pathname.startsWith("/app/campaigns");
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="min-h-screen flex bg-paper text-ink">
      {/* sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-surface border-r border-ink-200 flex flex-col
          transform transition-transform md:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink">
            <Logo size={22} />
            <span className="font-semibold text-[14px] tracking-tight">EmailsVia</span>
          </div>
          <button className="md:hidden btn-quiet p-1" onClick={() => setMobileOpen(false)}>
            <Icon path="M6 6l12 12M6 18L18 6" />
          </button>
        </div>

        <div className="px-2 flex-1 overflow-y-auto">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 px-2 pt-2 pb-1">
            Workspace
          </div>
          <nav className="space-y-0.5">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`side-link ${isActive(n.href) ? "side-link-active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 px-2 pt-5 pb-1">
            Actions
          </div>
          <Link
            href="/app/campaigns/new"
            className="side-link"
            onClick={() => setMobileOpen(false)}
          >
            <Icon path="M12 5v14M5 12h14" />
            <span>New campaign</span>
          </Link>
        </div>

        <div className="p-2 border-t border-ink-200 space-y-0.5">
          <ThemeToggle />
          <button onClick={logout} className="side-link w-full text-left">
            <Icon path="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-12 bg-paper border-b border-ink-200 z-30 flex items-center justify-between px-4">
        <button onClick={() => setMobileOpen(true)} className="btn-quiet p-1">
          <Icon path="M4 6h16M4 12h16M4 18h16" />
        </button>
        <div className="flex items-center gap-1.5 text-ink">
          <Logo size={18} />
          <span className="font-semibold text-[14px] tracking-tight">EmailsVia</span>
        </div>
        <div className="w-7" />
      </div>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* main */}
      <main className="flex-1 md:ml-60 pt-12 md:pt-0 min-w-0">
        <AppAlerts />
        {children}
      </main>

      <CommandPalette />
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function CampaignIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15L19 4M18 7l3 3M15 10l3 3" />
    </svg>
  );
}

function WebhookIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77l-7.13-4.15c.05-.21.09-.42.09-.65s-.04-.44-.09-.65l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .23.04.44.09.65l-7.05 4.11C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.2-.08.41-.08.62 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.91-2.92-2.91z" />
    </svg>
  );
}

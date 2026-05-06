"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

// Operator-only chrome. Mirrors AppShell's structure so the navigation
// pattern is familiar, but every link goes to /admin/*. There's no
// crossover into /app — the middleware enforces zone separation.
const NAV = [
  { href: "/admin", label: "Overview", icon: OverviewIcon },
  { href: "/admin/users", label: "Users", icon: UserIcon },
  { href: "/admin/campaigns", label: "Campaigns", icon: CampaignIcon },
  { href: "/admin/senders", label: "Senders", icon: MailIcon },
  { href: "/admin/replies", label: "Replies", icon: ReplyIcon },
  { href: "/admin/billing", label: "Billing & MRR", icon: BillingIcon },
  { href: "/admin/webhooks", label: "Webhook log", icon: WebhookIcon },
  { href: "/admin/system", label: "System", icon: SystemIcon },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="min-h-screen flex bg-paper text-ink">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-surface border-r border-ink-200 flex flex-col
          transform transition-transform md:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink">
            <Logo size={20} />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">EmailsVia</div>
              <div className="text-[10px] uppercase tracking-wider text-amber-700">Operator</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 -mr-1.5 text-ink-500 hover:text-ink rounded"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 px-2 pb-1">
            Operator
          </div>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={
                "side-link " +
                (isActive(item.href) ? "side-link-active" : "")
              }
            >
              <item.icon />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t border-ink-100 px-2 py-3">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[12px] text-ink-500">Theme</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full text-left side-link text-ink-600 hover:text-red-700"
          >
            <SignOutIcon />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-3 left-3 z-30 p-2 bg-paper border border-ink-200 rounded shadow-sm text-ink-600"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <main className="flex-1 md:ml-60 px-6 md:px-10 py-8 md:py-12 max-w-[1400px] w-full">
        {children}
      </main>
    </div>
  );
}

function OverviewIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
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
function MailIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
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
function BillingIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
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
function SystemIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.36.16.64.41.84.7" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

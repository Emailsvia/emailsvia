import Link from "next/link";
import Logo from "@/components/Logo";

// Top + bottom chrome shared by every public-facing marketing page (landing,
// pricing, privacy, terms). Auth state isn't checked here — signed-in users
// see the same nav and can click "Open app" to head to /app.
export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <header className="border-b border-ink-100">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-ink">
            <Logo size={24} />
            <span className="font-semibold text-[15px] tracking-tight">EmailsVia</span>
          </Link>
          <nav className="flex items-center gap-5 text-[13px] text-ink-700">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/signup" className="btn-accent text-[12px] px-3 py-1.5">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-ink-100 py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-[12px] text-ink-500 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Logo size={16} />
            <span>&copy; {new Date().getFullYear()} EmailsVia</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <a href="mailto:hello@emailsvia.com" className="hover:text-ink">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

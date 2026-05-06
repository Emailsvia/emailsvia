import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Not found — EmailsVia",
};

// Catches anything outside the marketing/auth/app zones, plus orphaned
// /app/* paths after a campaign or sender id was deleted. Same chrome as
// the marketing pages so it doesn't feel like a crash.
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper text-ink">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Logo size={28} />
          <span className="font-semibold text-[16px] tracking-tight">EmailsVia</span>
        </div>
        <h1 className="text-[44px] font-bold tracking-tight">404</h1>
        <p className="text-[14px] text-ink-500 mt-2 mb-8">
          That page either moved or never existed.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/" className="btn-ghost">Back to site</Link>
          <Link href="/app" className="btn-accent">Go to app</Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(body?.error === "password_too_short" ? "Password must be at least 8 characters." : "Couldn't create account.");
      return;
    }
    if (body.needsConfirmation) {
      setNeedsConfirm(true);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  function onGoogle() {
    window.location.href = "/api/auth/google?next=/app";
  }

  if (needsConfirm) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center gap-2 mb-10 text-ink">
            <Logo size={28} />
            <span className="font-semibold text-[16px] tracking-tight">EmailsVia</span>
          </div>
          <h1 className="text-xl font-semibold mb-3">Check your inbox</h1>
          <p className="text-[13px] text-ink-500">
            We sent a confirmation link to <span className="text-ink">{email}</span>. Click it to finish signing up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10 text-ink">
          <Logo size={28} />
          <span className="font-semibold text-[16px] tracking-tight">EmailsVia</span>
        </div>

        <h1 className="text-xl font-semibold mb-1">Create your account</h1>
        <p className="text-[13px] text-ink-500 mb-8">Free 50 emails / day, no card required.</p>

        <button type="button" onClick={onGoogle} className="btn-ghost w-full mb-5">
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-5 text-[12px] text-ink-500">
          <div className="h-px flex-1 bg-ink-200" />
          <span>or</span>
          <div className="h-px flex-1 bg-ink-200" />
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="signup-email" className="label-cap">Email</label>
            <input
              id="signup-email"
              className="field-boxed"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="signup-password" className="label-cap">Password</label>
            <input
              id="signup-password"
              className="field-boxed"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          {err && <p className="text-[13px] text-red-600">{err}</p>}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-accent w-full"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>

          <p className="text-[13px] text-ink-500 text-center">
            Already have an account? <Link href="/login" className="text-ink hover:underline">Sign in</Link>
          </p>
        </div>
      </form>
    </div>
  );
}

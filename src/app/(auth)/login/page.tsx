"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function nextParam() {
    return new URLSearchParams(window.location.search).get("next") || "/app";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setErr("Wrong email or password.");
      return;
    }
    router.push(nextParam());
    router.refresh();
  }

  function onGoogle() {
    window.location.href = `/api/auth/google?next=${encodeURIComponent(nextParam())}`;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10 text-ink">
          <Logo size={28} />
          <span className="font-semibold text-[16px] tracking-tight">EmailsVia</span>
        </div>

        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-[13px] text-ink-500 mb-8">
          Welcome back. <Link href="/" className="text-ink hover:underline">Back to site</Link>
        </p>

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
            <label htmlFor="login-email" className="label-cap">Email</label>
            <input
              id="login-email"
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
            <label htmlFor="login-password" className="label-cap">Password</label>
            <input
              id="login-password"
              className="field-boxed"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {err && <p className="text-[13px] text-red-600">{err}</p>}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-accent w-full"
          >
            {loading ? "Signing in…" : "Continue"}
          </button>

          <div className="flex items-center justify-between text-[13px] text-ink-500">
            <Link href="/forgot" className="hover:text-ink">Forgot password?</Link>
            <Link href="/signup" className="hover:text-ink">Sign up</Link>
          </div>
        </div>
      </form>
    </div>
  );
}

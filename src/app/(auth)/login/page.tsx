"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/auth/AuthShell";
import AuthSidePanel from "@/components/auth/AuthSidePanel";
import {
  AuthLabel,
  AuthInput,
  AuthPasswordInput,
  AuthPrimaryButton,
  AuthDivider,
  AuthError,
  GoogleButton,
} from "@/components/auth/AuthForm";

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
    <AuthShell side={<AuthSidePanel variant="welcome-back" />}>
      <form onSubmit={onSubmit} className="space-y-6">
        <header>
          <h1 className="m-display text-[32px] sm:text-[36px] leading-[1.05]">Sign in</h1>
          <p className="m-body text-[14px] mt-2">
            Welcome back. We missed you a normal amount.
          </p>
        </header>

        <GoogleButton onClick={onGoogle} />

        <AuthDivider>or with email</AuthDivider>

        <div className="space-y-4">
          <div>
            <AuthLabel htmlFor="login-email">Email</AuthLabel>
            <AuthInput
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.com"
              hasError={Boolean(err)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <AuthLabel htmlFor="login-password">Password</AuthLabel>
              <Link
                href="/forgot"
                className="text-[11px] text-[rgb(161_161_170)] hover:text-[rgb(255_140_140)] transition-colors cursor-pointer"
              >
                Forgot password?
              </Link>
            </div>
            <AuthPasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              hasError={Boolean(err)}
            />
          </div>

          <AuthError>{err}</AuthError>

          <AuthPrimaryButton
            disabled={!email || !password}
            loading={loading}
          >
            Sign in
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </AuthPrimaryButton>
        </div>

        <p className="text-center text-[13px] text-[rgb(161_161_170)]">
          New here?{" "}
          <Link
            href="/signup"
            className="text-[rgb(244_244_245)] underline decoration-[rgb(255_99_99/0.5)] underline-offset-[3px] hover:decoration-[rgb(255_99_99)] transition-colors cursor-pointer"
          >
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

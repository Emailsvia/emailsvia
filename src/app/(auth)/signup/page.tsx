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
      setErr(
        body?.error === "password_too_short"
          ? "Password needs at least 8 characters."
          : "Couldn't create the account. Try again?",
      );
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
      <AuthShell>
        <div className="text-center space-y-5">
          <div className="mx-auto grid place-items-center w-14 h-14 rounded-2xl m-glass">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[rgb(255_140_140)]" aria-hidden>
              <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
            </svg>
          </div>
          <h1 className="m-display text-[28px] leading-tight">Check your inbox.</h1>
          <p className="m-body text-[14px]">
            We sent a confirmation link to{" "}
            <span className="text-[rgb(244_244_245)] m-mono text-[13px]">{email}</span>.
            Click it to finish signing up — usually arrives in a minute, sometimes less.
          </p>
          <div className="m-pill mx-auto">
            <span className="m-pill-dot" />
            <span>Tip: check spam if it doesn&rsquo;t show in 2 mins</span>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell side={<AuthSidePanel variant="join" />}>
      <form onSubmit={onSubmit} className="space-y-6">
        <header>
          <h1 className="m-display text-[32px] sm:text-[36px] leading-[1.05]">
            Create your account
          </h1>
          <p className="m-body text-[14px] mt-2">
            Free for 50 emails a day. No card. Takes 60 seconds.
          </p>
        </header>

        <GoogleButton onClick={onGoogle} />

        <AuthDivider>or with email</AuthDivider>

        <div className="space-y-4">
          <div>
            <AuthLabel htmlFor="signup-email">Email</AuthLabel>
            <AuthInput
              id="signup-email"
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
            <AuthLabel htmlFor="signup-password">Password</AuthLabel>
            <AuthPasswordInput
              id="signup-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              hasError={Boolean(err)}
            />
          </div>

          <AuthError>{err}</AuthError>

          <AuthPrimaryButton
            disabled={!email || !password}
            loading={loading}
          >
            Start free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </AuthPrimaryButton>

          <p className="text-[11.5px] text-[rgb(113_113_122)] text-center leading-relaxed">
            By creating an account you agree to our{" "}
            <Link
              href="/terms"
              className="underline decoration-[rgb(255_255_255/0.2)] underline-offset-[3px] hover:text-[rgb(244_244_245)] hover:decoration-[rgb(255_99_99/0.5)] transition-colors cursor-pointer"
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="underline decoration-[rgb(255_255_255/0.2)] underline-offset-[3px] hover:text-[rgb(244_244_245)] hover:decoration-[rgb(255_99_99/0.5)] transition-colors cursor-pointer"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        <p className="text-center text-[13px] text-[rgb(161_161_170)] pt-2 border-t border-[rgb(255_255_255/0.06)]">
          <span className="block pt-4">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[rgb(244_244_245)] underline decoration-[rgb(255_99_99/0.5)] underline-offset-[3px] hover:decoration-[rgb(255_99_99)] transition-colors cursor-pointer"
            >
              Sign in
            </Link>
          </span>
        </p>
      </form>
    </AuthShell>
  );
}

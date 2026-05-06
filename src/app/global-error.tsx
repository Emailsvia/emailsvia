"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort error boundary for the App Router. Next.js renders this
// when an unrecoverable error occurs ABOVE the root layout — anything
// caught here is otherwise lost. Reporting to Sentry is the whole point.
//
// Per Next.js docs this file MUST include its own <html>/<body> because
// the broken root layout never rendered. That also means we can't rely on
// globals.css being loaded — every style here is inline.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          background: "#0A0A0B",
          color: "#F4F4F5",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          colorScheme: "dark",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,99,99,0.3)",
              background: "rgba(255,99,99,0.08)",
              color: "#FF8C8C",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "0.04em",
              marginBottom: 24,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "#FF6363",
              }}
            />
            <span>Unexpected error</span>
          </div>

          <h1
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Something{" "}
            <span
              style={{
                background:
                  "linear-gradient(100deg, #FF6363 0%, #FF779A 35%, #FF9F43 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              broke.
            </span>
          </h1>

          <p
            style={{
              color: "#A1A1AA",
              fontSize: 14,
              lineHeight: 1.6,
              margin: "16px auto 28px",
              maxWidth: 380,
            }}
          >
            We&rsquo;ve been pinged about it. Try refreshing — if it persists, drop us a
            line at{" "}
            <a
              href="mailto:hello@emailsvia.com"
              style={{
                color: "#F4F4F5",
                textDecoration: "underline",
                textDecorationColor: "rgba(255,99,99,0.5)",
                textUnderlineOffset: 3,
              }}
            >
              hello@emailsvia.com
            </a>
            .
          </p>

          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#F4F4F5",
              color: "#0A0A0B",
              border: 0,
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 0 rgba(0,0,0,0.4)",
              transition: "box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow =
                "inset 0 1px 0 rgba(255,255,255,0.7), 0 0 0 1px rgba(255,99,99,0.45), 0 0 28px -4px rgba(255,99,99,0.55)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow =
                "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 0 rgba(0,0,0,0.4)";
            }}
          >
            Refresh
          </button>

          {error.digest && (
            <p
              style={{
                marginTop: 24,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "#71717A",
              }}
            >
              ref · {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

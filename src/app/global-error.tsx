"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort error boundary for the App Router. Next.js renders this
// when an unrecoverable error occurs ABOVE the root layout — anything
// errors caught here are otherwise lost. Reporting them to Sentry is
// the whole point.
//
// Per Next.js docs this file MUST include its own <html>/<body> because
// the broken root layout never rendered.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          fontFamily:
            "-apple-system, Segoe UI, system-ui, sans-serif",
          background: "#fafaf7",
          color: "#1a1a1a",
          margin: 0,
          padding: "64px 24px",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
          We&rsquo;ve been notified. Try refreshing — if it persists, drop us a
          line at <a href="mailto:hello@emailsvia.com">hello@emailsvia.com</a>.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#1a1a1a",
            color: "#fff",
            border: 0,
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </body>
    </html>
  );
}

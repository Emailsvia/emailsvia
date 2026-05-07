import { ImageResponse } from "next/og";

// Generates the social-share preview at /opengraph-image (Next infers
// the URL from the file path). 1200x630 is the canonical OG / Twitter
// summary_large_image dimension. Rendered by Vercel's edge runtime so
// it's cached and fast.

export const runtime = "edge";
export const alt = "EmailsVia — Cold email that doesn't feel cold";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          backgroundColor: "#0A0A0B",
          color: "#F4F4F5",
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          backgroundImage:
            "radial-gradient(ellipse 90% 80% at 70% 100%, rgba(255,159,67,0.22), transparent 60%), radial-gradient(ellipse 80% 70% at 15% 0%, rgba(255,99,99,0.28), transparent 60%)",
        }}
      >
        {/* Top row: brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 100 100" fill="none" stroke="#F4F4F5" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M25 72 L25 40 L50 62 L75 40 L75 72" />
              <path d="M50 62 L50 32" />
              <path d="M36 52 L36 60" />
              <path d="M64 52 L64 60" />
              <circle cx="25" cy="40" r="8" fill="#0A0A0B" />
              <circle cx="50" cy="24" r="8" fill="#0A0A0B" />
              <circle cx="75" cy="40" r="8" fill="#0A0A0B" />
              <circle cx="25" cy="80" r="8" fill="#0A0A0B" />
              <circle cx="75" cy="80" r="8" fill="#0A0A0B" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "#F4F4F5",
            }}
          >
            EmailsVia
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "92px",
              fontWeight: 600,
              letterSpacing: "-0.04em",
              lineHeight: 0.98,
              color: "#F4F4F5",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Cold email</span>
            <span style={{ display: "flex", gap: "20px" }}>
              <span>that</span>
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(100deg, #FF6363 0%, #FF779A 35%, #FF9F43 100%)",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                doesn&rsquo;t feel cold.
              </span>
            </span>
          </div>
          <div
            style={{
              fontSize: "26px",
              color: "#A1A1AA",
              lineHeight: 1.4,
              maxWidth: "880px",
              letterSpacing: "-0.005em",
            }}
          >
            Mail merge from your own Gmail — with warmup, threaded follow-ups, and AI
            that reads your replies so you don&rsquo;t have to.
          </div>
        </div>

        {/* Footer row: pill + url */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "#A1A1AA",
              fontSize: "20px",
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "#FF6363",
                boxShadow: "0 0 12px rgba(255,99,99,0.7)",
              }}
            />
            <span>Now with AI reply triage</span>
          </div>
          <div
            style={{
              fontSize: "22px",
              fontFamily: '"Geist Mono", "SF Mono", monospace',
              color: "#71717A",
            }}
          >
            emailsvia.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

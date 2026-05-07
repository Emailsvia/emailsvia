import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist is the primary product font — used both as default sans and as the
// display font for marketing/large type. Geist Mono powers code, command
// surfaces, and tabular numbers.
const sans = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-sans",
  display: "swap",
});

const display = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://emailsvia.com"),
  title: {
    default: "EmailsVia — Cold email that doesn't feel cold",
    template: "%s · EmailsVia",
  },
  description:
    "Mail merge from your own Gmail — with warmup, threaded follow-ups, and AI that reads your replies so you don't have to. Built for founders, recruiters, and operators.",
  applicationName: "EmailsVia",
  keywords: [
    "cold email",
    "mail merge",
    "Gmail",
    "outbound",
    "warmup",
    "AI reply triage",
    "follow-up sequence",
    "inbox rotation",
  ],
  authors: [{ name: "EmailsVia" }],
  openGraph: {
    type: "website",
    url: "https://emailsvia.com",
    siteName: "EmailsVia",
    title: "EmailsVia — Cold email that doesn't feel cold",
    description:
      "Mail merge from your own Gmail — with warmup, threaded follow-ups, and AI that reads your replies so you don't have to.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "EmailsVia — Cold email that doesn't feel cold",
    description:
      "Mail merge from your own Gmail — with warmup, threaded follow-ups, and AI reply triage.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// Dark-only product. data-theme is rendered server-side so the very first
// paint is correct — no client JS needed, no localStorage check, no flash.
// We deliberately don't expose a toggle: the design system, marketing canvas,
// and component tokens are all built dark-native. A small inline script also
// re-asserts dark on hydration to defend against legacy localStorage values
// from older builds that toggled themes.
const themeScript = `try{document.documentElement.dataset.theme='dark';localStorage.removeItem('theme');}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

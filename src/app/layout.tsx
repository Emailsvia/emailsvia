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
  title: "EmailsVia",
  description: "Send personalized campaigns on a schedule.",
};

// Dark-only product. The theme attribute is set inline so the first paint
// is dark — no light-mode flash on slow connections. We deliberately don't
// expose a toggle: the design system, marketing canvas, and component
// tokens are all built dark-native.
const themeScript = `
  (function () {
    try { document.documentElement.dataset.theme = 'dark'; } catch (e) {}
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

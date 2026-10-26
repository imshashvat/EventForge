/**
 * Root layout — EventForge
 *
 * Fonts (UI Master Guide §3.3):
 *   Body/UI:     Geist (variable, --font-body)
 *   Mono:        JetBrains Mono (variable, --font-mono-var)
 *   Display serif: system Georgia (no web font needed)
 *
 * Theme: dark by default.
 * Light mode: set data-theme="light" on <html>.
 * Use next-themes cookie approach to avoid flash.
 */
import { type Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-var",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "EventForge",
    template: "%s — EventForge",
  },
  description:
    "EventForge — competitive event management for quizzes, challenges, and judged presentations.",
  metadataBase: new URL(process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"),
  openGraph: {
    siteName: "EventForge",
    locale: "en_US",
    type: "website",
  },
};

interface Props {
  children: React.ReactNode;
}

export default function RootLayout({ children }: Props) {
  return (
    <html
      lang="en"
      // data-theme="light" to switch; dark is default (no flash — no inline script needed,
      // server renders in dark; cookie-based theme switcher applied by ThemeProvider in app shell)
      className={`${geist.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

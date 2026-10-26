/**
 * (auth)/layout.tsx — Template D: centred single-panel, no sidebar
 *
 * Used for: sign-in, sign-up, MFA.
 * UI Master Guide Template D: single centred panel (max-w 480px),
 * minimal header (logo only), no footer nav.
 */
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/theme-toggle";

interface Props {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Minimal header — logo only */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "0 32px",
        }}
      >
        <div
          style={{
            maxWidth: "1160px",
            margin: "0 auto",
            minHeight: "72px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Link
            href="/"
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "20px",
              color: "var(--text)",
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            EventForge
          </Link>
          <div style={{ marginLeft: "auto" }}>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Centred panel */}
      <main
        id="main"
        tabIndex={-1}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 32px",
        }}
      >
        {children}
      </main>
    </div>
  );
}

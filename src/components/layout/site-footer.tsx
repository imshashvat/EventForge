/**
 * SiteFooter — site-wide footer
 *
 * UI Master Guide (Part 5 / Delulu3 pattern):
 *   - bg: var(--bg), border-top 1px var(--border)
 *   - Container: 1160px, padding-top 32px
 *   - Logo + tagline left, nav links right
 *   - Legal row: smaller muted text
 *   - radius 0, no shadows
 *
 * No imports from modules/<name>/repo.
 */
import Link from "next/link";

interface FooterLink {
  href: string;
  label: string;
}

interface SiteFooterProps {
  links?: FooterLink[];
}

const defaultLinks: FooterLink[] = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Events" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteFooter({ links = defaultLinks }: SiteFooterProps) {
  return (
    <footer
      style={{
        background: "var(--bg)",
        borderTop: "1px solid var(--border)",
        marginTop: "auto",
      }}
    >
      <div
        className="container"
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
          gap: "32px",
          paddingTop: "32px",
          paddingBottom: "32px",
        }}
      >
        {/* Brand block */}
        <div>
          <Link
            href="/"
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "20px",
              color: "var(--text)",
              textDecoration: "none",
              letterSpacing: "0.02em",
              display: "inline-block",
              marginBottom: "8px",
            }}
          >
            EventForge
          </Link>
          <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
            Competitive event management for quizzes, challenges, and presentations.
          </p>
        </div>

        {/* Nav */}
        <nav aria-label="Footer navigation" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                fontSize: "14px",
                color: "var(--text-muted)",
                textDecoration: "none",
                display: "inline-block",
                minHeight: "32px",
                lineHeight: "32px",
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Legal */}
      <div
        className="container"
        style={{
          display: "flex",
          gap: "24px",
          paddingBottom: "24px",
          borderTop: "1px solid var(--border)",
          paddingTop: "16px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          © {new Date().getFullYear()} EventForge
        </span>
        <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Non-commercial. Self-hosted.
        </span>
      </div>
    </footer>
  );
}

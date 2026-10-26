/**
 * SiteHeader — top navigation bar
 *
 * UI Master Guide (Part 5.1 / Delulu3 pattern):
 *   - bg: var(--bg), border-bottom 1px var(--border)
 *   - min-height: 88px (desktop), 72px (mobile)
 *   - Logo: Georgia serif, 24px, no mark visible on desktop
 *   - Nav links: 16px, active = border-bottom 1px var(--text)
 *   - Theme toggle button (secondary, 44px)
 *   - Mobile: hamburger toggle, nav opens as block overlay
 *   - radius 0 everywhere
 *
 * Server component (no "use client") — ThemeToggle is client-only child.
 * No imports from modules/<name>/repo.
 */
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

interface NavLink {
  href: string;
  label: string;
  current?: boolean;
}

interface SiteHeaderProps {
  links?: NavLink[];
  logoHref?: string;
}

export function SiteHeader({ links = [], logoHref = "/" }: SiteHeaderProps) {
  return (
    <header
      className="site-header"
      style={{
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div
        className="header-inner container"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "32px",
          minHeight: "88px",
        }}
      >
        {/* Logo — Georgia serif */}
        <Link
          href={logoHref}
          aria-label="EventForge home"
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "20px",
            color: "var(--text)",
            textDecoration: "none",
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}
        >
          EventForge
        </Link>

        {/* Nav */}
        {links.length > 0 && (
          <nav
            id="site-nav"
            aria-label="Main navigation"
            style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.current ? "page" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: "44px",
                  padding: "0 12px",
                  fontSize: "16px",
                  color: "var(--text)",
                  textDecoration: "none",
                  // Active: bottom border 1px text (guide: aria-current)
                  borderBottom: link.current
                    ? "1px solid var(--text)"
                    : "1px solid transparent",
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}

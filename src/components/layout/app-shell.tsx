/**
 * AppShell — Template B shell (admin + participant routes)
 *
 * UI Master Guide (Part 5.2):
 *   Layout: grid 200px / 1fr (sidebar + main)
 *   - Sidebar: border-left (or border-right on left side), sticky top 88px
 *   - Nav links: 44px min-height, active = left 2px border var(--brand)
 *   - No rounded corners, no shadows
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
import * as React from "react";
import Link from "next/link";

interface SidebarLink {
  href: string;
  label: string;
  current?: boolean;
}

interface AppShellProps {
  sidebarLinks: SidebarLink[];
  sidebarLabel?: string;
  children: React.ReactNode;
}

export function AppShell({ sidebarLinks, sidebarLabel = "Navigation", children }: AppShellProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px minmax(0, 1fr)",
        gap: "32px",
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "32px",
        minHeight: "calc(100vh - 88px)",
      }}
    >
      {/* Sidebar */}
      <aside
        aria-label={sidebarLabel}
        style={{
          borderRight: "1px solid var(--border)",
          paddingRight: "16px",
          alignSelf: "start",
          position: "sticky",
          top: "104px",
        }}
      >
        {sidebarLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={link.current ? "page" : undefined}
            style={{
              display: "block",
              padding: "10px 12px",
              fontSize: "14px",
              color: link.current ? "var(--text)" : "var(--text-muted)",
              textDecoration: "none",
              // Active: left 2px border var(--brand)
              borderLeft: link.current ? "2px solid var(--brand)" : "2px solid transparent",
              marginLeft: "-2px",
              transition: "color 150ms, border-color 150ms",
            }}
          >
            {link.label}
          </Link>
        ))}
      </aside>

      {/* Main content */}
      <main id="main" tabIndex={-1} style={{ minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}

/**
 * Nav — public / participant top navigation bar.
 *
 * Layout: sticky, height 56px, semi-transparent surface-1 bg + backdrop-blur.
 * Contains: logo, nav links, sign-in / get-started CTAs.
 * Auth-aware: accepts an optional `user` prop from the parent Server Component.
 *
 * DESIGN.md §5.8: "Public/Participant: top navbar, height 56px, sticky,
 * semi-transparent with backdrop-filter: blur(12px)"
 *
 * Touches: presentation only — auth state is read from props, not fetched here
 * (R-MOD-03: UI components must not import repository functions directly).
 */

import Link from "next/link";
import { Button } from "./button";

interface NavProps {
  /** Authenticated user — passed from parent Server Component if available. */
  user?: { id: string; email: string } | null;
}

export function Nav({ user }: NavProps) {
  return (
    <header
      className="sticky top-0 z-50 h-14 flex items-center"
      style={{
        backgroundColor: "color-mix(in srgb, var(--surface-1) 80%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-6">
        {/* ── Logo ─────────────────────────────────────────────── */}
        <Link
          href="/"
          className="flex items-center gap-2.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal-500)] rounded-lg"
          aria-label="EventForge home"
        >
          {/* Logo mark — brand gradient applied only here (DESIGN.md) */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--brand-gradient)" }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-4.5 h-4.5 text-white"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <span
            className="font-semibold text-[var(--text-primary)] text-sm tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            EventForge
          </span>
        </Link>

        {/* ── Nav Links (desktop) ──────────────────────────────── */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
          {[
            { href: "/events",      label: "Events" },
            { href: "/leaderboard", label: "Leaderboard" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--text-secondary)]
                         hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]
                         transition-colors duration-[var(--duration-fast)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal-500)]"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* ── Auth CTA ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          {user ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

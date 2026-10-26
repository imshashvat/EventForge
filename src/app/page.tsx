import { type Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/core/auth";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: "EventForge — Competitive Event Platform",
  description:
    "Manage and participate in quizzes, hackathons, and technical competitions — with real-time leaderboards, automated scoring, and everything a serious organiser needs.",
};

// ── Feature data ──────────────────────────────────────────────────────────────

const features = [
  {
    id: "feature-realtime",
    title: "Real-time scoring",
    desc: "Auto-score quiz attempts instantly. Leaderboards update within seconds — no refresh needed.",
  },
  {
    id: "feature-secure",
    title: "Secure by design",
    desc: "Deny-by-default access control. Row-level security on every table. No SQL injection surface.",
  },
  {
    id: "feature-analytics",
    title: "Rich analytics",
    desc: "Export participants, scores, and audit logs in one click. Full CSV with formula-injection protection.",
  },
];

const howItWorks = [
  {
    step: "01",
    title: "Create an event",
    desc: "Configure rounds, set timers, define rubrics — publish when ready.",
  },
  {
    step: "02",
    title: "Participants compete",
    desc: "Quiz, code, present. Answers saved continuously. Timer is authoritative.",
  },
  {
    step: "03",
    title: "See results instantly",
    desc: "Live leaderboard updates as rounds close. Export everything in seconds.",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  let user = null;
  try { user = await getSessionUser(); } catch { /* no DB in dev */ }

  const navLinks = [
    { href: "/events", label: "Events" },
    { href: "/events", label: "Leaderboard" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <SiteHeader links={navLinks} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "96px 32px",
          position: "relative",
          overflow: "hidden",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Subtle radial scrim — only hero gets a gradient per guide */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            background:
              "radial-gradient(ellipse 70% 55% at 50% -5%, color-mix(in srgb, var(--brand) 12%, transparent), transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "760px" }}>
          {/* Eyebrow label */}
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "24px",
            }}
          >
            Platform
          </p>

          {/* Headline — Georgia serif, large */}
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "clamp(48px, 8vw, 80px)",
              fontWeight: 400,
              lineHeight: 1.05,
              color: "var(--text)",
              marginBottom: "24px",
            }}
          >
            Competitions,{" "}
            <span style={{ color: "var(--brand)" }}>forged</span>{" "}
            for scale
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.6,
              color: "var(--text-muted)",
              maxWidth: "560px",
              margin: "0 auto 40px",
            }}
          >
            EventForge powers quizzes, hackathons, and technical competitions —
            with real-time leaderboards, automated scoring, and everything a
            serious organiser needs.
          </p>

          {/* CTAs */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            {user ? (
              <Button variant="primary" size="lg" asChild>
                <Link href="/dashboard" id="hero-dashboard">Go to dashboard →</Link>
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" asChild>
                  <Link href="/sign-up" id="hero-sign-up">Get started free</Link>
                </Button>
                <Button variant="secondary" size="lg" asChild>
                  <Link href="/sign-in" id="hero-sign-in">Sign in</Link>
                </Button>
              </>
            )}
          </div>

          {/* Stats strip */}
          <div
            style={{
              marginTop: "56px",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "32px",
            }}
          >
            {[
              { value: "500+",  label: "events run" },
              { value: "10k+",  label: "participants" },
              { value: "<500ms", label: "response time" },
              { value: "99.9%", label: "uptime" },
            ].map(({ value, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span
                  style={{
                    fontSize: "20px",
                    fontFamily: "Georgia, serif",
                    color: "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value}
                </span>
                <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div className="container" style={{ paddingTop: "64px", paddingBottom: "64px" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "28px",
              fontWeight: 400,
              color: "var(--text)",
              textAlign: "center",
              marginBottom: "48px",
            }}
          >
            Everything you need to run a great event
          </h2>

          {/* Hair-grid — 1px gap, no rounded corners */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "1px",
              background: "var(--border)",
            }}
          >
            {features.map((f) => (
              <div
                key={f.id}
                id={f.id}
                style={{
                  background: "var(--bg)",
                  padding: "32px",
                }}
              >
                <h3
                  style={{
                    fontSize: "16px",
                    color: "var(--text)",
                    marginBottom: "8px",
                  }}
                >
                  {f.title}
                </h3>
                <p style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="container" style={{ paddingTop: "64px", paddingBottom: "64px" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "28px",
              fontWeight: 400,
              color: "var(--text)",
              textAlign: "center",
              marginBottom: "48px",
            }}
          >
            Up and running in minutes
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1px",
              background: "var(--border)",
            }}
          >
            {howItWorks.map((item) => (
              <div
                key={item.step}
                style={{
                  background: "var(--bg)",
                  padding: "32px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: "48px",
                    color: "var(--text-muted)",
                    opacity: 0.4,
                    marginBottom: "12px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.step}
                </div>
                <h3
                  style={{
                    fontSize: "16px",
                    color: "var(--text)",
                    marginBottom: "8px",
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section style={{ borderBottom: "1px solid var(--border)" }}>
        <div
          className="container"
          style={{
            paddingTop: "80px",
            paddingBottom: "80px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "24px",
          }}
        >
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "36px",
              fontWeight: 400,
              color: "var(--text)",
            }}
          >
            Ready to run your first event?
          </h2>
          <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "480px", lineHeight: 1.6 }}>
            Free to start. No credit card required.
            Move to paid only when your event needs it.
          </p>
          {!user && (
            <Button variant="primary" size="lg" asChild>
              <Link href="/sign-up" id="cta-sign-up">Get started free →</Link>
            </Button>
          )}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

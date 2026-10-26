/**
 * app/page.tsx — Homepage
 *
 * Clear two-path landing:
 *  - Organisers: create & manage events (need admin access)
 *  - Participants: browse & join events (anyone can sign up)
 */
import { type Metadata } from "next";
import Link from "next/link";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: "EventForge — Run Quizzes, Hackathons & Competitions",
  description:
    "EventForge lets organisers create scored events with real-time leaderboards, and participants join with a single click. Quizzes, challenges, and more.",
};

export default async function HomePage() {
  const session = await getSessionUser();

  let isAdmin = false;
  if (session) {
    try {
      const appUser = await resolveAppUser(session);
      const actor = await buildActor(appUser.id);
      isAdmin = actor.assignments.some(
        (a) => a.roleKey === "super_admin" || a.roleKey === "event_admin",
      );
    } catch { /* not yet provisioned */ }
  }

  const navLinks = session
    ? [
        { href: "/events", label: "Browse Events" },
        ...(isAdmin ? [{ href: "/admin/events", label: "Admin Panel" }] : []),
        { href: "/dashboard", label: "My Events" },
      ]
    : [
        { href: "/events", label: "Browse Events" },
        { href: "/sign-in", label: "Sign In" },
      ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <SiteHeader links={navLinks} />

      <main id="main" tabIndex={-1} style={{ flex: 1 }}>

        {/* ── Hero ── */}
        <section
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "80px 0 72px",
            textAlign: "center",
          }}
        >
          <div className="container" style={{ maxWidth: "760px", margin: "0 auto" }}>
            <p style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "20px" }}>
              PLATFORM
            </p>
            <h1
              style={{
                fontFamily: "Georgia, serif",
                fontSize: "clamp(36px, 6vw, 64px)",
                fontWeight: 400,
                lineHeight: 1.1,
                color: "var(--text)",
                marginBottom: "24px",
              }}
            >
              Run events that{" "}
              <span style={{ color: "var(--accent)" }}>actually work</span>
            </h1>
            <p
              style={{
                fontSize: "18px",
                lineHeight: 1.7,
                color: "var(--text-muted)",
                maxWidth: "560px",
                margin: "0 auto 40px",
              }}
            >
              EventForge is a platform for running scored competitions — quizzes, hackathons, coding challenges.
              Organisers create events. Participants join and compete. Results are instant.
            </p>

            {/* Two clear paths */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "var(--border)", maxWidth: "640px", margin: "0 auto 48px", border: "1px solid var(--border)" }}>
              {/* Participant path */}
              <div style={{ background: "var(--bg)", padding: "32px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "12px" }}>🎯</div>
                <h2 style={{ fontSize: "18px", fontFamily: "Georgia, serif", fontWeight: 400, marginBottom: "8px", color: "var(--text)" }}>
                  Join an event
                </h2>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "20px" }}>
                  Browse open competitions, register, and compete. See your score and ranking live.
                </p>
                <Button variant="primary" asChild>
                  <Link href="/events" id="cta-browse-events">Browse events →</Link>
                </Button>
              </div>
              {/* Organiser path */}
              <div style={{ background: "var(--surface)", padding: "32px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "12px" }}>⚙️</div>
                <h2 style={{ fontSize: "18px", fontFamily: "Georgia, serif", fontWeight: 400, marginBottom: "8px", color: "var(--text)" }}>
                  Create an event
                </h2>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "20px" }}>
                  Build quiz rounds, challenge tasks, and judged segments. Manage teams and publish results.
                </p>
                {isAdmin ? (
                  <Button variant="secondary" asChild>
                    <Link href="/admin/events" id="cta-admin-panel">Go to Admin Panel →</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" asChild>
                    <Link href="/sign-in?next=/admin/events" id="cta-organiser-login">Organiser Sign In →</Link>
                  </Button>
                )}
              </div>
            </div>

            {/* Already signed in state */}
            {session && (
              <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                Signed in as <strong style={{ color: "var(--text)" }}>{session.email}</strong>
                {" · "}
                <Link href="/dashboard" style={{ color: "var(--accent)", textDecoration: "underline" }}>My Events</Link>
                {isAdmin && (
                  <>
                    {" · "}
                    <Link href="/admin/events" style={{ color: "var(--accent)", textDecoration: "underline" }}>Admin Panel</Link>
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        {/* ── How it works ── */}
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
              How it works
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1px",
                background: "var(--border)",
              }}
            >
              {[
                { step: "1", role: "Organiser", title: "Create the event", desc: "Set up rounds — quiz, challenge, or judged. Add questions. Set timers. Publish." },
                { step: "2", role: "Participant", title: "Register & compete", desc: "Browse events, register with one click (approval optional). Start competing when the round opens." },
                { step: "3", role: "Everyone", title: "See live results", desc: "Leaderboard updates in real time. Scores are final when the round closes. Export everything as CSV." },
              ].map((item) => (
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
                      display: "inline-block",
                      padding: "4px 10px",
                      border: "1px solid var(--border)",
                      fontSize: "11px",
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginBottom: "16px",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.role}
                  </div>
                  <div
                    style={{
                      fontFamily: "Georgia, serif",
                      fontSize: "40px",
                      color: "var(--text-muted)",
                      opacity: 0.3,
                      marginBottom: "12px",
                    }}
                  >
                    {item.step}
                  </div>
                  <h3 style={{ fontSize: "16px", color: "var(--text)", marginBottom: "8px" }}>
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

        {/* ── Platform features ── */}
        <section style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
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
              Built for serious events
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "1px",
                background: "var(--border)",
              }}
            >
              {[
                { id: "f-quiz", icon: "📝", title: "Quiz rounds", desc: "Timed MCQs with auto-scoring. Server clock is authoritative — no client cheating." },
                { id: "f-challenge", icon: "🏗️", title: "Challenge rounds", desc: "Submit GitHub repos, deployed URLs, or any link. Supports revisions before deadline." },
                { id: "f-leaderboard", icon: "📊", title: "Live leaderboard", desc: "Per-event leaderboards update as scores come in. Public or private visibility." },
                { id: "f-judging", icon: "⚖️", title: "Manual judging", desc: "Rubric-based judging for hackathons. Assign judges, score, reconcile." },
                { id: "f-export", icon: "📤", title: "CSV exports", desc: "Download participants, scores, evaluations. Formula-injection safe." },
                { id: "f-secure", icon: "🔒", title: "Secure by default", desc: "Row-level security on every table. Rate limiting on every write. HTTPS only." },
              ].map((f) => (
                <div
                  key={f.id}
                  id={f.id}
                  style={{
                    background: "var(--bg)",
                    padding: "28px",
                  }}
                >
                  <div style={{ fontSize: "24px", marginBottom: "10px" }}>{f.icon}</div>
                  <h3 style={{ fontSize: "15px", color: "var(--text)", marginBottom: "6px" }}>
                    {f.title}
                  </h3>
                  <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--text-muted)" }}>
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section>
          <div
            className="container"
            style={{
              paddingTop: "80px",
              paddingBottom: "80px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: "20px",
            }}
          >
            <h2
              style={{
                fontFamily: "Georgia, serif",
                fontSize: "32px",
                fontWeight: 400,
                color: "var(--text)",
              }}
            >
              Ready to join or run an event?
            </h2>
            <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "440px", lineHeight: 1.6 }}>
              Participants sign up free. Organisers contact us for admin access.
            </p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
              {!session && (
                <>
                  <Button variant="primary" size="lg" asChild>
                    <Link href="/sign-up" id="footer-cta-signup">Create account →</Link>
                  </Button>
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/events" id="footer-cta-events">Browse events</Link>
                  </Button>
                </>
              )}
              {session && (
                <>
                  <Button variant="primary" size="lg" asChild>
                    <Link href="/events" id="footer-cta-events-auth">Browse events →</Link>
                  </Button>
                  {isAdmin && (
                    <Button variant="secondary" size="lg" asChild>
                      <Link href="/admin/events" id="footer-cta-admin">Admin Panel</Link>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

      </main>

      <SiteFooter />
    </div>
  );
}

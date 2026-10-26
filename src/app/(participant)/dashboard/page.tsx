/**
 * (participant)/dashboard/page.tsx — Participant dashboard.
 *
 * Server Component — loads the user's registered events, shows round status
 * and personal stats. Uses the events module (no direct DB access).
 * Layout (header + sidebar) is provided by (participant)/layout.tsx.
 * Design: UI Master Guide — radius 0, no shadows, no gradients, token colours.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { getSessionUser, resolveAppUser } from "@/core/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listParticipantEvents, type EventSummary, type RoundSummary } from "@/modules/events";

export const metadata: Metadata = {
  title: "Dashboard — EventForge",
  description: "Your registered events and upcoming rounds.",
};

interface DashboardEvent extends EventSummary {
  rounds: RoundSummary[];
  participantStatus: "pending" | "approved" | "rejected" | "waitlisted";
}

// ── Stat card — no radius, border-only ───────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: "1px solid var(--border)", padding: "20px" }}>
      <p
        style={{
          fontSize: "32px",
          fontFamily: "Georgia, serif",
          fontWeight: 400,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          marginBottom: "4px",
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}

// ── Round row ─────────────────────────────────────────────────────────────────

function RoundRow({ round }: { round: RoundSummary }) {
  const statusMap: Record<RoundSummary["status"], Parameters<typeof Badge>[0]["status"]> = {
    draft: "draft",
    published: "published",
    open: "open",
    paused: "paused",
    closed: "closed",
    finalised: "closed",
    cancelled: "closed",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Badge status={statusMap[round.status]} />
      <span style={{ flex: 1, fontSize: "14px", color: "var(--text)" }}>
        {round.name}
      </span>
      {round.status === "open" && (
        <Button size="sm" variant="primary" asChild>
          <Link href={`#round-${round.id}`}>Enter →</Link>
        </Button>
      )}
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event }: { event: DashboardEvent }) {
  const openRound = event.rounds.find((r) => r.status === "open");
  const statusVariant =
    event.status === "active" ? "live" :
    event.status === "published" ? "open" :
    event.status === "draft" ? "draft" : "default";

  const regColor =
    event.participantStatus === "approved" ? "var(--good)" :
    event.participantStatus === "pending"  ? "var(--warn)" :
    "var(--bad)";

  return (
    <div style={{ border: "1px solid var(--border)" }}>
      {/* Top accent line if live */}
      {openRound && (
        <div style={{ height: "2px", background: "var(--live)" }} />
      )}

      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
            <Link
              href={`/events/${event.slug}`}
              style={{ fontSize: "16px", color: "var(--text)", textDecoration: "none" }}
            >
              {event.name}
            </Link>
            <Badge status={statusVariant} />
          </div>
          <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
            Registration:{" "}
            <span style={{ color: regColor }}>{event.participantStatus}</span>
          </p>
        </div>
        {openRound && (
          <span
            style={{
              fontSize: "14px",
              color: "var(--live)",
              borderLeft: "2px solid var(--live)",
              paddingLeft: "8px",
            }}
          >
            Round active
          </span>
        )}
      </div>

      {/* Rounds */}
      {event.rounds.length > 0 ? (
        <div style={{ padding: "0 20px 4px" }}>
          {event.rounds.map((round) => (
            <RoundRow key={round.id} round={round} />
          ))}
        </div>
      ) : (
        <p style={{ padding: "16px 20px", fontSize: "14px", color: "var(--text-muted)" }}>
          No rounds scheduled yet.
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const sessionUser = await getSessionUser();

  let myEvents: DashboardEvent[] = [];
  if (sessionUser) {
    try {
      const appUser = await resolveAppUser(sessionUser);
      myEvents = await listParticipantEvents(appUser.id) as DashboardEvent[];
    } catch {
      myEvents = [];
    }
  }

  const stats = {
    registered: myEvents.length,
    active: myEvents.filter((e) => e.rounds.some((r) => r.status === "open")).length,
    completed: myEvents.filter((e) => e.status === "completed").length,
  };

  const firstName = sessionUser?.email?.split("@")[0] ?? "there";

  return (
    <div>
      {/* Welcome */}
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "24px", marginBottom: "32px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "28px",
            fontWeight: 400,
            color: "var(--text)",
            marginBottom: "4px",
          }}
        >
          Welcome back, {firstName}
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Your registered events and upcoming rounds.
        </p>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1px",
          background: "var(--border)",
          marginBottom: "32px",
        }}
      >
        <div style={{ background: "var(--bg)" }}><StatCard label="Events registered" value={stats.registered} /></div>
        <div style={{ background: "var(--bg)" }}><StatCard label="Active rounds" value={stats.active} /></div>
        <div style={{ background: "var(--bg)" }}><StatCard label="Completed" value={stats.completed} /></div>
      </div>

      {/* Section header */}
      <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        My events
      </p>

      {/* Event list */}
      {myEvents.length === 0 ? (
        <div
          style={{
            border: "1px solid var(--border)",
            padding: "64px 32px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "20px",
              fontWeight: 400,
              color: "var(--text)",
              marginBottom: "8px",
            }}
          >
            No events yet
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "24px" }}>
            Register for an event to get started.
          </p>
          <Button variant="primary" asChild>
            <Link href="/events">Browse events</Link>
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "var(--border)" }}>
          {myEvents.map((event) => (
            <div key={event.id} style={{ background: "var(--bg)" }}>
              <EventCard event={event} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

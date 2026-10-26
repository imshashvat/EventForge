/**
 * (public)/events/page.tsx — Public event listing.
 *
 * Server Component — fetches published events from the events service.
 * Nav is provided by (public)/layout.tsx — do NOT add Nav here.
 * Design: UI Master Guide — radius 0, no shadows, no gradients, token colours.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { listPublishedEvents } from "@/modules/events";
import { Badge } from "@/components/ui/badge";
import { getSessionUser } from "@/core/auth";
import type { EventSummary } from "@/modules/events";

export const metadata: Metadata = {
  title: "Events — EventForge",
  description: "Browse and register for upcoming competitions, quizzes, and hackathons.",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ── Event card — radius 0, border only, no gradient banner ───────────────────

function EventCard({ event }: { event: EventSummary }) {
  const regOpen = event.isRegistrationOpen;
  const isTeamEvent = event.teamMode !== "individual";
  const capStr =
    event.maxParticipants == null
      ? "Unlimited spots"
      : `${event.participantCount ?? 0} / ${event.maxParticipants} spots`;

  // Map EventStatus → StatusVariant (StatusVariant has 'closed'; EventStatus has 'completed'/'archived')
  const statusVariant =
    event.status === "active"    ? "live" :
    event.status === "published" ? "open" :
    event.status === "draft"     ? "draft" :
    event.status === "paused"    ? "paused" :
    "closed"; // completed | archived

  return (
    <Link
      href={`/events/${event.slug}`}
      style={{
        display: "block",
        border: "1px solid var(--border)",
        textDecoration: "none",
        transition: "border-color 150ms",
      }}
      aria-label={`View event: ${event.name}`}
    >
      {/* Status bar — top 1px accent */}
      <div
        style={{
          height: "3px",
          background: regOpen ? "var(--good)" :
            event.status === "active" ? "var(--live)" : "var(--border)",
        }}
      />

      <div style={{ padding: "20px" }}>
        {/* Status + reg badge row */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          <Badge status={statusVariant} />
          {regOpen && <Badge status="open">Reg. open</Badge>}
        </div>

        {/* Title */}
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "18px",
            fontWeight: 400,
            color: "var(--text)",
            marginBottom: "8px",
            lineHeight: 1.3,
          }}
        >
          {event.name}
        </h2>

        {/* Description */}
        {(event.tagline ?? event.description) && (
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              marginBottom: "16px",
              lineHeight: 1.5,
            }}
          >
            {event.tagline ?? event.description}
          </p>
        )}

        {/* Meta strip */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            fontSize: "14px",
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          <span>
            {event.startsAt ? formatDate(event.startsAt) : "Date TBD"}
          </span>
          {isTeamEvent && <span>Team event</span>}
          <span
            style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}
          >
            {capStr}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        padding: "80px 0",
        textAlign: "center",
        border: "1px solid var(--border)",
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
      <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
        Check back soon — competitions are coming.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function EventsPage() {
  // user only needed to determine auth state; nav is handled by layout
  let events: EventSummary[] = [];
  try {
    const [, fetched] = await Promise.all([
      getSessionUser(),
      listPublishedEvents({ limit: 24 }),
    ]);
    events = fetched;
  } catch {
    // DB not available (dev without Supabase) — show empty state
    events = [];
  }

  return (
    <div className="container" style={{ paddingTop: "32px", paddingBottom: "64px" }}>
      {/* Page header */}
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          paddingBottom: "24px",
          marginBottom: "32px",
        }}
      >
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "32px",
            fontWeight: 400,
            color: "var(--text)",
            marginBottom: "4px",
          }}
        >
          Events
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          {events.length > 0
            ? `${events.length} active event${events.length !== 1 ? "s" : ""}`
            : "No events currently running"}
        </p>
      </div>

      {/* Grid */}
      {events.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "1px",
            background: "var(--border)",
          }}
        >
          {events.map((event) => (
            <div key={event.id} style={{ background: "var(--bg)" }}>
              <EventCard event={event} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

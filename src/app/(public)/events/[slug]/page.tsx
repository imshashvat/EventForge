/**
 * (public)/events/[slug]/page.tsx — Event detail page.
 *
 * Server Component — fetches event + rounds + checks registration status.
 * Nav is provided by (public)/layout.tsx — do NOT add Nav here.
 * Design: UI Master Guide — radius 0, no shadows, no gradients, token colours.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser, resolveAppUser } from "@/core/auth";
import { getEventBySlug, listRounds } from "@/modules/events";
import { db } from "@/core/db";
import { participants } from "@/core/db/schema";
import { and, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RegisterButton } from "./register-button";
import type { RoundSummary } from "@/modules/events";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Event not found — EventForge" };
  return {
    title: `${event.name} — EventForge`,
    description: event.tagline ?? event.description ?? undefined,
  };
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const ROUND_STATUS_LABEL: Record<RoundSummary["status"], string> = {
  draft: "Draft",
  published: "Scheduled",
  open: "Live now",
  paused: "Paused",
  closed: "Ended",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

const ROUND_TYPE_LABEL: Record<RoundSummary["roundType"], string> = {
  quiz: "Quiz",
  challenge: "Challenge",
  judged: "Judged",
};

export default async function EventDetailPage({ params }: Params) {
  const { slug } = await params;

  const [sessionUser, event] = await Promise.all([
    getSessionUser(),
    getEventBySlug(slug),
  ]);
  if (!event) notFound();

  const rounds = await listRounds({ eventId: event.id });

  let isRegistered = false;
  let participantStatus: string | null = null;
  if (sessionUser) {
    try {
      const appUser = await resolveAppUser(sessionUser);
      const [row] = await db
        .select({ status: participants.status })
        .from(participants)
        .where(
          and(
            eq(participants.eventId, event.id),
            eq(participants.userId, appUser.id),
          ),
        )
        .limit(1);
      if (row) {
        isRegistered = true;
        participantStatus = row.status;
      }
    } catch {
      // Treat as not registered if user resolution fails
    }
  }

  const openRound = rounds.find((r) => r.status === "open");
  const statusVariant =
    event.status === "active"    ? "live" :
    event.status === "published" ? "open" :
    event.status === "draft"     ? "draft" :
    event.status === "paused"    ? "paused" :
    "closed";

  return (
    <div className="container" style={{ paddingTop: "32px", paddingBottom: "64px" }}>
      {/* Back link */}
      <Link
        href="/events"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "14px",
          color: "var(--text-muted)",
          textDecoration: "none",
          marginBottom: "24px",
        }}
      >
        ← All events
      </Link>

      {/* Event header — no gradient, no rounded corners */}
      <div style={{ border: "1px solid var(--border)", marginBottom: "32px" }}>
        {/* Top accent line */}
        <div
          style={{
            height: "3px",
            background: event.status === "active" ? "var(--live)" : "var(--border)",
          }}
        />

        <div style={{ padding: "28px 32px" }}>
          {/* Badges */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            <Badge status={statusVariant} />
            {event.teamMode !== "individual" && <Badge status="default">Team event</Badge>}
          </div>

          {/* Title */}
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: "32px",
              fontWeight: 400,
              color: "var(--text)",
              marginBottom: "8px",
              lineHeight: 1.2,
            }}
          >
            {event.name}
          </h1>

          {event.tagline && (
            <p style={{ fontSize: "16px", color: "var(--text-muted)", marginBottom: "16px" }}>
              {event.tagline}
            </p>
          )}

          {/* Dates + capacity */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "24px",
              fontSize: "14px",
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              padding: "12px 0",
              margin: "16px 0",
            }}
          >
            {event.startsAt && (
              <span>
                <span style={{ color: "var(--text-muted)", opacity: 0.6 }}>Starts: </span>
                {formatDate(event.startsAt)}
              </span>
            )}
            {event.endsAt && (
              <span>
                <span style={{ color: "var(--text-muted)", opacity: 0.6 }}>Ends: </span>
                {formatDate(event.endsAt)}
              </span>
            )}
            {event.maxParticipants && (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "var(--text-muted)", opacity: 0.6 }}>Capacity: </span>
                {event.participantCount ?? 0} / {event.maxParticipants}
              </span>
            )}
          </div>

          {event.description && (
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.7,
                color: "var(--text-muted)",
                marginBottom: "20px",
                whiteSpace: "pre-wrap",
              }}
            >
              {event.description}
            </p>
          )}

          {/* Registration / CTA */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {isRegistered ? (
              <>
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--good)",
                    borderLeft: "2px solid var(--good)",
                    paddingLeft: "8px",
                  }}
                >
                  ✓ Registered
                  {participantStatus && ` (${participantStatus})`}
                </span>
                {openRound && (
                  <Button variant="primary" size="sm" asChild>
                    <Link href={`/e/${slug}/rounds/${openRound.id}`}>
                      Enter round →
                    </Link>
                  </Button>
                )}
              </>
            ) : event.isRegistrationOpen ? (
              <RegisterButton
                eventId={event.id}
                isSignedIn={!!sessionUser}
                slug={slug}
              />
            ) : (
              <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                Registration is{" "}
                {event.registrationMode === "closed" ? "closed" : "not open yet"}.
              </p>
            )}

            {event.leaderboardPublic && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/events/${slug}/leaderboard`}>
                  View leaderboard
                </Link>
              </Button>
            )}

            {(event.status === "completed" || event.status === "archived") && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/events/${slug}/results`}>
                  View results
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Rounds list */}
      {rounds.length > 0 && (
        <section>
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "16px",
            }}
          >
            Rounds
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1px",
              background: "var(--border)",
            }}
          >
            {rounds.map((round) => (
              <div
                key={round.id}
                style={{
                  background: "var(--bg)",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  borderLeft: round.status === "open" ? "2px solid var(--live)" : "2px solid transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                    <span style={{ fontSize: "16px", color: "var(--text)" }}>
                      {round.name}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        border: "1px solid var(--border)",
                        padding: "1px 6px",
                      }}
                    >
                      {ROUND_TYPE_LABEL[round.roundType]}
                    </span>
                  </div>
                  <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                    {round.durationMs
                      ? `${Math.round(round.durationMs / 60000)} min`
                      : null}
                    {round.opensAt && ` · Opens ${formatDate(round.opensAt)}`}
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  <Badge
                    status={
                      round.status === "open"      ? "live" :
                      round.status === "published" ? "open" :
                      round.status === "paused"    ? "paused" :
                      "default"
                    }
                  >
                    {ROUND_STATUS_LABEL[round.status]}
                  </Badge>
                  {round.status === "open" && isRegistered && (
                    <Button variant="primary" size="sm" asChild>
                      <Link href={`/e/${slug}/rounds/${round.id}`}>
                        Enter →
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

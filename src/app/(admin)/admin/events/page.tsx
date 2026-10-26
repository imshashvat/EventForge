/**
 * Admin events listing page — /admin/events
 *
 * Shows all events the actor can manage (super_admin: all; event_admin: their own).
 * Links to event detail, and has a "Create event" button.
 * Auth: requires super_admin or event_admin role.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { db } from "@/core/db";
import { events } from "@/core/db/schema";
import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Manage Events — Admin — EventForge",
};

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export default async function AdminEventsPage() {
  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin/events");

  const appUser = await resolveAppUser(session);
  const actor = await buildActor(appUser.id);

  // Check if user has ANY admin capability
  const hasAccess =
    can(actor, "event:update", { type: "global" }) ||
    actor.assignments.some(
      (a) => (a.roleKey === "event_admin" || a.roleKey === "super_admin") && a.scopeType === "event",
    );

  if (!hasAccess) redirect("/dashboard");

  // Super admins see all events; event_admins see events they are assigned to
  const isSuperAdmin = actor.assignments.some(
    (a) => a.roleKey === "super_admin" && a.scopeType === "global",
  );

  const allEvents = await db
    .select({
      id: events.id,
      slug: events.slug,
      name: events.name,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .orderBy(desc(events.createdAt));

  // Filter for event_admins — only their assigned events
  const myEventIds = new Set(
    actor.assignments
      .filter((a) => a.eventId)
      .map((a) => a.eventId!),
  );

  const visibleEvents = isSuperAdmin
    ? allEvents
    : allEvents.filter((e) => myEventIds.has(e.id));

  const STATUS_COLORS: Record<string, string> = {
    draft: "default",
    published: "open",
    active: "live",
    paused: "default",
    completed: "default",
    archived: "default",
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-30 h-14 border-b flex items-center px-6 gap-4"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderColor: "var(--border)",
        }}
      >
        <Link
          href="/dashboard"
          className="text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Dashboard
        </Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
        >
          Events
        </span>
        <div className="flex-1" />
        <Button variant="primary" size="sm" asChild>
          <Link href="/admin/events/new">+ Create event</Link>
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <h1
            className="text-2xl font-bold mb-1"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Manage Events
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {visibleEvents.length} event{visibleEvents.length !== 1 ? "s" : ""}
          </p>
        </div>

        {visibleEvents.length === 0 ? (
          <div
            className="rounded-2xl border p-12 text-center"
            style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
          >
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              No events yet.
            </p>
            <Button variant="primary" size="sm" asChild>
              <Link href="/admin/events/new">Create your first event</Link>
            </Button>
          </div>
        ) : (
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
          >
            {visibleEvents.map((event, i) => (
              <Link
                key={event.id}
                href={`/admin/events/${event.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors"
                style={{
                  borderTop: i > 0 ? `1px solid var(--border)` : undefined,
                  textDecoration: "none",
                }}
              >
                {/* Status badge */}
                <Badge status={STATUS_COLORS[event.status] as "live" | "open" | "default"}>
                  {event.status}
                </Badge>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {event.name}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    /{event.slug}
                  </p>
                </div>

                {/* Dates */}
                <div className="text-xs text-right shrink-0" style={{ color: "var(--text-secondary)" }}>
                  <p>{formatDate(event.startsAt)}</p>
                  {event.endsAt && <p>→ {formatDate(event.endsAt)}</p>}
                </div>

                {/* Arrow */}
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{ color: "var(--text-disabled)" }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

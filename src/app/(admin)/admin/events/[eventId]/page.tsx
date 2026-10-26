/**
 * Admin event detail + round management page.
 *
 * Route: /admin/events/[eventId]
 *
 * Displays event lifecycle controls, round list with status transitions,
 * and participant stats. All mutations go to the API routes (no direct
 * DB calls from UI — R-MOD-03).
 */
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/core/auth";
import { getEventById, listRounds } from "@/modules/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { EventSummary, RoundSummary } from "@/modules/events";

export const metadata: Metadata = {
  title: "Event Management — Admin — EventForge",
};

interface Params {
  params: Promise<{ eventId: string }>;
}

// ── Round status actions available in each state ──────────────────────────────

const roundActions: Partial<Record<RoundSummary["status"], { label: string; nextStatus: string; variant: "primary" | "danger" | "secondary" }[]>> = {
  draft: [{ label: "Open round", nextStatus: "open", variant: "primary" }],
  published: [{ label: "Open early", nextStatus: "open", variant: "secondary" }],
  open: [
    { label: "Pause", nextStatus: "paused", variant: "secondary" },
    { label: "Close", nextStatus: "closed", variant: "danger" },
  ],
  paused: [
    { label: "Resume", nextStatus: "open", variant: "primary" },
    { label: "Close", nextStatus: "closed", variant: "danger" },
  ],
  closed: [{ label: "Finalise", nextStatus: "finalised", variant: "primary" }],
  finalised: [],
  cancelled: [],
};

// ── Round row ─────────────────────────────────────────────────────────────────

function RoundRow({ round, eventId }: { round: RoundSummary; eventId: string }) {
  const actions = roundActions[round.status] ?? [];
  const typeIcon =
    round.roundType === "quiz" ? "📝" : round.roundType === "challenge" ? "💻" : "👨‍⚖️";

  return (
    <div
      className="flex items-center gap-3 px-5 py-4 border-b last:border-b-0 flex-wrap"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Round no + type */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="num text-sm font-bold w-6 text-center tabular-nums"
          style={{ color: "var(--text-disabled)" }}
        >
          {round.roundNo}
        </span>
        <span className="text-base" aria-label={round.roundType}>
          {typeIcon}
        </span>
      </div>

      {/* Round info */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold truncate"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
        >
          {round.name}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {round.durationMs
            ? `${Math.floor(round.durationMs / 60000)} min timer`
            : "No timer"}
          {round.opensAt && (
            <> · Opens {new Date(round.opensAt).toLocaleTimeString()}</>
          )}
        </p>
      </div>

      {/* Status badge */}
      <Badge status={(round.status === "open" ? "open" : "default") as Parameters<typeof Badge>[0]["status"]}>
        {round.status}
      </Badge>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <form
            key={action.nextStatus}
            action={`/api/v1/events/${eventId}/rounds/${round.id}/status`}
            method="POST"
          >
            <input type="hidden" name="status" value={action.nextStatus} />
            <Button type="submit" size="sm" variant={action.variant}>
              {action.label}
            </Button>
          </form>
        ))}
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/admin/events/${eventId}/rounds/${round.id}/questions`}>
            Questions
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ── Event lifecycle actions ───────────────────────────────────────────────────

const eventActions: Partial<Record<EventSummary["status"], { label: string; nextStatus: string; variant: "primary" | "danger" | "secondary" }>> = {
  draft: { label: "Publish event", nextStatus: "published", variant: "primary" },
  published: { label: "Mark completed", nextStatus: "completed", variant: "secondary" },
  paused: { label: "Resume", nextStatus: "published", variant: "primary" },
  completed: { label: "Archive", nextStatus: "archived", variant: "danger" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminEventPage({ params }: Params) {
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  // TODO(M1-authz): replace with authorize(user.id, "event:update", { eventId }) check

  const [event, rounds] = await Promise.all([
    getEventById(eventId),
    listRounds({ eventId }),
  ]);

  if (!event) notFound();

  const lifecycleAction = eventActions[event.status];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Admin top bar */}
      <header
        className="sticky top-0 z-30 h-14 flex items-center border-b px-4 sm:px-6 gap-4"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
          backdropFilter: "blur(12px)",
          borderColor: "var(--border)",
        }}
      >
        <Link
          href="/admin/events"
          className="text-sm hover:text-[var(--teal-300)] transition-colors"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Events
        </Link>
        <div
          className="w-px h-5 shrink-0"
          style={{ background: "var(--border)" }}
          aria-hidden="true"
        />
        <p
          className="text-sm font-semibold flex-1 truncate"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          {event.name}
        </p>
        <Badge status={(event.status === "active" ? "live" : "default") as Parameters<typeof Badge>[0]["status"]}>
          {event.status}
        </Badge>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col gap-6">
        {/* Event overview card */}
        <Card variant="default">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1
                className="text-lg font-bold mb-1"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                {event.name}
              </h1>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {event.tagline ?? event.description ?? "No description set."}
              </p>
              <div className="mt-3 flex gap-4 flex-wrap">
                {[
                  { label: "Capacity", value: event.maxParticipants ?? "Unlimited" },
                  { label: "Team event", value: event.teamMode !== "individual" ? "Yes" : "No" },
                  { label: "Leaderboard", value: event.leaderboardPublic ? "Public" : "Private" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</p>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {String(value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {lifecycleAction && (
                <form
                  action={`/api/v1/events/${eventId}`}
                  method="PATCH"
                >
                  <input type="hidden" name="status" value={lifecycleAction.nextStatus} />
                  <Button type="submit" size="sm" variant={lifecycleAction.variant}>
                    {lifecycleAction.label}
                  </Button>
                </form>
              )}
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/admin/events/${eventId}/settings`}>Settings</Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/admin/events/${eventId}/form`}>Reg. Form</Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/admin/events/${eventId}/questions`}>Questions</Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/admin/events/${eventId}/participants`}>Participants</Link>
              </Button>
            </div>
          </div>
        </Card>

        {/* Rounds card */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div
            className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: "var(--border)" }}
          >
            <h2
              className="font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              Rounds ({rounds.length})
            </h2>
            <Button variant="primary" size="sm" asChild>
              <Link href={`/admin/events/${eventId}/rounds/new`}>+ Add round</Link>
            </Button>
          </div>

          {rounds.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                No rounds yet. Add the first round to get started.
              </p>
            </div>
          ) : (
            rounds.map((round) => (
              <RoundRow key={round.id} round={round} eventId={eventId} />
            ))
          )}
        </div>

        {/* Export section */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div
            className="px-5 py-4 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <h2
              className="font-semibold text-sm mb-0.5"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              Export data
            </h2>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Download event data as CSV. Requires event admin access.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
            {[
              { type: "participants", label: "Participants", desc: "All registrants, status, entry type" },
              { type: "leaderboard", label: "Leaderboard", desc: "Scores aggregated by entry" },
              { type: "challenge_submissions", label: "Submissions", desc: "All challenge revisions & URLs" },
              { type: "evaluations", label: "Evaluations", desc: "Judge scores per criterion" },
            ].map(({ type, label, desc }) => (
              <div
                key={type}
                className="flex items-center justify-between gap-3 px-5 py-4"
                style={{ background: "var(--surface-1)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{desc}</p>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/api/v1/events/${eventId}/exports?type=${type}`}>↓ CSV</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Live Monitor */}
        <Card variant="compact">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p
                className="font-medium text-sm mb-0.5"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
              >
                Live Monitor
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Real-time participant counts, active attempts, round status, and leaderboard. Auto-refreshes every 30s.
              </p>
            </div>
            <Button variant="primary" size="sm" asChild>
              <Link href={`/admin/events/${eventId}/monitor`}>
                📊 Open Monitor
              </Link>
            </Button>
          </div>
        </Card>

        {/* Staff & Audit links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
          {[
            {
              href: `/admin/events/${eventId}/staff`,
              icon: "👥",
              label: "Staff & Roles",
              desc: "Add/remove event admins, judges, reviewers",
            },
            {
              href: `/admin/events/${eventId}/audit`,
              icon: "📋",
              label: "Audit Log",
              desc: "Append-only trail of all admin actions",
            },
          ].map(({ href, icon, label, desc }) => (
            <Card key={href} variant="compact" className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm mb-0.5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                  {icon} {label}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{desc}</p>
              </div>
              <Button variant="secondary" size="sm" asChild>
                <Link href={href}>Open →</Link>
              </Button>
            </Card>
          ))}
        </div>

        {/* Leaderboard section */}
        <Card variant="compact">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p
                className="font-medium text-sm mb-0.5"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
              >
                Leaderboard
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Live snapshot · refreshes every 5 s · policy: {event.leaderboardPublic ? "public" : "private"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/api/v1/events/${eventId}/leaderboard?scope=overall`} target="_blank" rel="noreferrer">
                  JSON feed ↗
                </Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href={`/events/${eventId}/leaderboard`}>
                  View live board
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}

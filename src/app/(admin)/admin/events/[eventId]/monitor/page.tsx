/**
 * Admin Live Monitor — /admin/events/[eventId]/monitor
 *
 * Real-time overview of a running event. Auto-refreshes every 30s.
 * Shows: participant counts, active attempts, round status, recent activity.
 *
 * Server Component with revalidate=30. For true real-time, Vercel's
 * Partial Prerendering or SSE can be added later (ARCHITECTURE §14).
 */
import "server-only";
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { getEventById, listRounds } from "@/modules/events";
import { db } from "@/core/db";
import {
  participants,
  quizAttempts,
  entries,
  rounds,
  scoreRecords,
  leaderboardSnapshots,
} from "@/core/db/schema";
import { eq, and, count, sql, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Revalidate every 30 seconds (ISR / on-demand revalidation)
export const revalidate = 30;

interface Params { params: Promise<{ eventId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getEventById(eventId).catch(() => null);
  return {
    title: `Live Monitor — ${event?.name ?? "Event"} — Admin — EventForge`,
  };
}

export default async function MonitorPage({ params }: Params) {
  const { eventId } = await params;

  // Auth gate
  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin");

  const appUser = await resolveAppUser(session).catch(() => null);
  if (!appUser) redirect("/sign-in");

  const actor = await buildActor(appUser.id);
  if (!can(actor, "event:update", { type: "event", eventId })) {
    redirect("/admin/events");
  }

  // Load event + rounds
  const event = await getEventById(eventId).catch(() => null);
  if (!event) notFound();

  const roundList = await listRounds({ eventId }).catch(() => []);

  // ── Stats queries ──────────────────────────────────────────────────────────

  // Participant counts by status
  const [participantStats] = await db
    .select({
      total: count(),
      approved: sql<number>`count(*) filter (where ${participants.status} = 'approved')`,
      pending: sql<number>`count(*) filter (where ${participants.status} = 'pending')`,
      rejected: sql<number>`count(*) filter (where ${participants.status} = 'rejected')`,
      waitlisted: sql<number>`count(*) filter (where ${participants.status} = 'waitlisted')`,
    })
    .from(participants)
    .where(eq(participants.eventId, eventId))
    .catch(() => [{ total: 0, approved: 0, pending: 0, rejected: 0, waitlisted: 0 }]);

  // Active (in-progress) quiz attempts
  const [attemptStats] = await db
    .select({
      active: sql<number>`count(*) filter (where ${quizAttempts.status} = 'in_progress')`,
      submitted: sql<number>`count(*) filter (where ${quizAttempts.status} = 'submitted')`,
      total: count(),
    })
    .from(quizAttempts)
    .where(eq(quizAttempts.eventId, eventId))
    .catch(() => [{ active: 0, submitted: 0, total: 0 }]);

  // Scores submitted per round (top 5 rounds)
  const scoresByRound = await db
    .select({
      roundId: scoreRecords.roundId,
      roundName: rounds.name,
      scoreCount: count(),
    })
    .from(scoreRecords)
    .innerJoin(rounds, eq(scoreRecords.roundId, rounds.id))
    .where(eq(scoreRecords.eventId, eventId))
    .groupBy(scoreRecords.roundId, rounds.name)
    .limit(10)
    .catch(() => []);

  // Latest leaderboard snapshot
  const [latestSnapshot] = await db
    .select({ createdAt: leaderboardSnapshots.createdAt, payload: leaderboardSnapshots.payload })
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.eventId, eventId))
    .orderBy(desc(leaderboardSnapshots.createdAt))
    .limit(1)
    .catch(() => []);

  // Top 5 on leaderboard from latest snapshot payload
  const topEntries: Array<{ rank: number; label: string; score: number }> = [];
  if (latestSnapshot) {
    const payload = latestSnapshot.payload as Array<{ rank: number; label: string; score: number }> | undefined;
    if (Array.isArray(payload)) {
      topEntries.push(...payload.slice(0, 5));
    }
  }

  const pStats = participantStats ?? { total: 0, approved: 0, pending: 0, rejected: 0, waitlisted: 0 };
  const aStats = attemptStats ?? { active: 0, submitted: 0, total: 0 };

  const now = new Date();

  return (
    <div className="monitor-page">
      {/* ── Page header ── */}
      <div className="monitor-header">
        <div>
          <nav className="monitor-breadcrumb">
            <Link href="/admin/events">Events</Link>
            <span>›</span>
            <Link href={`/admin/events/${eventId}`}>{event.name}</Link>
            <span>›</span>
            <span>Live Monitor</span>
          </nav>
          <h1 className="monitor-title">
            Live Monitor
            {event.status === "active" && (
              <span className="monitor-live-dot" aria-label="Event is live" />
            )}
          </h1>
          <p className="monitor-subtitle">
            Auto-refreshes every 30s · Last update: {now.toLocaleTimeString("en-IN")}
          </p>
        </div>
        <div className="monitor-actions">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/events/${eventId}`}>← Back to event</Link>
          </Button>
          <form action={`/admin/events/${eventId}/monitor`} method="get">
            <Button variant="secondary" size="sm" type="submit">↻ Refresh</Button>
          </form>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="monitor-stats">
        <StatCard
          label="Registered"
          value={Number(pStats.total)}
          sub={`${pStats.approved} approved · ${pStats.pending} pending`}
          color="var(--teal)"
        />
        <StatCard
          label="Active Attempts"
          value={Number(aStats.active)}
          sub={`${aStats.submitted} submitted · ${aStats.total} total`}
          color={Number(aStats.active) > 0 ? "var(--live)" : "var(--text-3)"}
          pulse={Number(aStats.active) > 0}
        />
        <StatCard
          label="Scores Recorded"
          value={scoresByRound.reduce((s, r) => s + Number(r.scoreCount), 0)}
          sub={`${scoresByRound.length} round${scoresByRound.length !== 1 ? "s" : ""} with scores`}
          color="var(--text-1)"
        />
        <StatCard
          label="Leaderboard Entries"
          value={topEntries.length > 0 ? topEntries.length : (latestSnapshot ? "—" : 0)}
          sub={latestSnapshot ? `Updated ${new Date(latestSnapshot.createdAt).toLocaleTimeString("en-IN")}` : "No snapshot yet"}
          color="var(--text-1)"
        />
      </div>

      <div className="monitor-grid">
        {/* ── Rounds status panel ── */}
        <div className="monitor-card">
          <div className="monitor-card-header">
            <h2 className="monitor-card-title">Rounds</h2>
            <Link href={`/admin/events/${eventId}`} className="monitor-card-link">
              Manage →
            </Link>
          </div>
          <div className="monitor-rounds">
            {roundList.length === 0 ? (
              <p className="monitor-empty">No rounds created yet.</p>
            ) : (
              roundList.map(r => {
                const scoresForRound = scoresByRound.find(s => s.roundId === r.id);
                return (
                  <div key={r.id} className={`monitor-round${r.status === "open" ? " monitor-round--live" : ""}`}>
                    <div className="monitor-round-info">
                      <span className="monitor-round-icon">
                        {r.roundType === "quiz" ? "📝" : r.roundType === "challenge" ? "💻" : "👨‍⚖️"}
                      </span>
                      <div>
                        <p className="monitor-round-name">{r.name}</p>
                        <p className="monitor-round-meta">
                          {r.durationMs ? `${Math.round(r.durationMs / 60000)} min` : "Untimed"}
                          {scoresForRound ? ` · ${scoresForRound.scoreCount} scores` : ""}
                        </p>
                      </div>
                    </div>
                    <Badge
                      status={
                        r.status === "open" ? "live" :
                        r.status === "published" ? "open" :
                        r.status === "paused" ? "paused" :
                        r.status === "closed" || r.status === "finalised" ? "closed" :
                        "draft"
                      }
                    >
                      {r.status === "open" ? "LIVE" :
                       r.status === "paused" ? "Paused" :
                       r.status === "closed" ? "Closed" :
                       r.status === "finalised" ? "Finalised" :
                       r.status === "published" ? "Scheduled" : "Draft"}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Participants panel ── */}
        <div className="monitor-card">
          <div className="monitor-card-header">
            <h2 className="monitor-card-title">Participants</h2>
            <Link href={`/admin/events/${eventId}/participants`} className="monitor-card-link">
              View all →
            </Link>
          </div>
          <div className="monitor-participant-bars">
            <ParticipantBar label="Approved" count={Number(pStats.approved)} total={Number(pStats.total)} color="var(--success)" />
            <ParticipantBar label="Pending" count={Number(pStats.pending)} total={Number(pStats.total)} color="var(--amber, #f59e0b)" />
            <ParticipantBar label="Waitlisted" count={Number(pStats.waitlisted)} total={Number(pStats.total)} color="var(--text-3)" />
            <ParticipantBar label="Rejected" count={Number(pStats.rejected)} total={Number(pStats.total)} color="var(--error)" />
          </div>

          <div className="monitor-divider" />

          <div className="monitor-attempt-summary">
            <h3 className="monitor-section-label">Quiz Attempts</h3>
            <div className="monitor-attempt-row">
              <span className="monitor-attempt-label">In progress</span>
              <span className="monitor-attempt-value" style={{ color: Number(aStats.active) > 0 ? "var(--live)" : "inherit" }}>
                {aStats.active}
              </span>
            </div>
            <div className="monitor-attempt-row">
              <span className="monitor-attempt-label">Submitted</span>
              <span className="monitor-attempt-value">{aStats.submitted}</span>
            </div>
            <div className="monitor-attempt-row">
              <span className="monitor-attempt-label">Total started</span>
              <span className="monitor-attempt-value">{aStats.total}</span>
            </div>
          </div>
        </div>

        {/* ── Live leaderboard snapshot ── */}
        <div className="monitor-card">
          <div className="monitor-card-header">
            <h2 className="monitor-card-title">Top 5 (Leaderboard)</h2>
            <Link href={`/events/${event.slug}/leaderboard`} target="_blank" className="monitor-card-link">
              Public view →
            </Link>
          </div>
          {topEntries.length === 0 ? (
            <p className="monitor-empty">
              {latestSnapshot ? "No entries in snapshot." : "Leaderboard not yet computed."}
            </p>
          ) : (
            <div className="monitor-leaderboard">
              {topEntries.map((e, i) => (
                <div key={i} className="monitor-lb-row">
                  <span className="monitor-lb-rank tabular-nums">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${e.rank}`}
                  </span>
                  <span className="monitor-lb-name">{e.label ?? "—"}</span>
                  <span className="monitor-lb-score tabular-nums">{Number(e.score).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .monitor-page { max-width: 1100px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); }

        .monitor-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; margin-bottom: var(--space-8); }
        .monitor-breadcrumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-2); margin-bottom: var(--space-2); }
        .monitor-breadcrumb a { color: var(--text-2); text-decoration: none; }
        .monitor-breadcrumb a:hover { color: var(--text-1); }
        .monitor-title { font-family: Georgia, serif; font-size: var(--text-2xl); font-weight: 400; color: var(--text-1); margin: 0; display: flex; align-items: center; gap: var(--space-3); }
        .monitor-live-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--live); animation: pulse-live 2s ease-in-out infinite; }
        .monitor-subtitle { font-size: var(--text-sm); color: var(--text-3); margin-top: var(--space-1); }
        .monitor-actions { display: flex; align-items: center; gap: var(--space-2); }

        /* Stats row */
        .monitor-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); margin-bottom: var(--space-6); }
        @media (max-width: 900px) { .monitor-stats { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .monitor-stats { grid-template-columns: 1fr; } }

        /* Grid */
        .monitor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
        @media (max-width: 768px) { .monitor-grid { grid-template-columns: 1fr; } }
        .monitor-card:last-child { grid-column: 1 / -1; }

        .monitor-card { border: 1px solid var(--border); background: var(--surface-1); }
        .monitor-card-header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border); }
        .monitor-card-title { font-size: var(--text-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin: 0; }
        .monitor-card-link { font-size: var(--text-xs); color: var(--teal); text-decoration: none; }
        .monitor-card-link:hover { text-decoration: underline; }

        .monitor-empty { padding: var(--space-6) var(--space-5); color: var(--text-3); font-size: var(--text-sm); text-align: center; }

        /* Rounds */
        .monitor-rounds { display: flex; flex-direction: column; }
        .monitor-round { display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border); gap: var(--space-3); }
        .monitor-round:last-child { border-bottom: none; }
        .monitor-round--live { border-left: 3px solid var(--live); }
        .monitor-round-info { display: flex; align-items: center; gap: var(--space-3); }
        .monitor-round-icon { font-size: 1.1rem; }
        .monitor-round-name { font-size: var(--text-sm); font-weight: 500; color: var(--text-1); }
        .monitor-round-meta { font-size: var(--text-xs); color: var(--text-3); margin-top: 1px; }

        /* Participant bars */
        .monitor-participant-bars { padding: var(--space-4) var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
        .monitor-divider { border-top: 1px solid var(--border); margin: var(--space-1) 0; }
        .monitor-section-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin: 0 0 var(--space-3); padding: var(--space-4) var(--space-5) 0; }
        .monitor-attempt-summary { padding: 0 var(--space-5) var(--space-4); }
        .monitor-attempt-row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
        .monitor-attempt-row:last-child { border-bottom: none; }
        .monitor-attempt-label { font-size: var(--text-sm); color: var(--text-2); }
        .monitor-attempt-value { font-size: var(--text-sm); font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; }

        /* Leaderboard */
        .monitor-leaderboard { display: flex; flex-direction: column; }
        .monitor-lb-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border); }
        .monitor-lb-row:last-child { border-bottom: none; }
        .monitor-lb-rank { font-size: var(--text-base); min-width: 32px; }
        .monitor-lb-name { flex: 1; font-size: var(--text-sm); color: var(--text-1); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .monitor-lb-score { font-size: var(--text-sm); font-weight: 700; color: var(--teal); }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color, pulse = false,
}: {
  label: string; value: number | string; sub: string; color: string; pulse?: boolean;
}) {
  return (
    <div style={{ background: "var(--surface-1)", padding: "var(--space-5)", borderRight: "1px solid var(--border)" }}>
      <p
        style={{
          fontSize: "var(--text-3xl)",
          fontFamily: "Georgia, serif",
          fontWeight: 400,
          color,
          fontVariantNumeric: "tabular-nums",
          marginBottom: "var(--space-1)",
          animation: pulse ? "pulse-live 2s ease-in-out infinite" : undefined,
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-1)", marginBottom: "2px" }}>{label}</p>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-3)" }}>{sub}</p>
    </div>
  );
}

function ParticipantBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-2)" }}>{label}</span>
        <span style={{ fontSize: "var(--text-xs)", fontVariantNumeric: "tabular-nums", color: "var(--text-2)" }}>
          {count} ({pct}%)
        </span>
      </div>
      <div style={{ height: "4px", background: "var(--surface-2)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

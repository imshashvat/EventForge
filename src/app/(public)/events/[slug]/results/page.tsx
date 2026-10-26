/**
 * /events/[slug]/results  — Public results page
 * Shows the latest published (final) result run for an event.
 * Server component — fetches data directly from DB via service layer.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/core/db";
import { events, resultRuns, calculatedResults, users, participants, entries, teams } from "@/core/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { Badge, RankBadge } from "@/components/ui/badge";
import type { Metadata } from "next";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  try {
    const [event] = await db.select({ name: events.name }).from(events).where(eq(events.slug, slug)).limit(1);
    if (!event) return { title: "Results" };
    return {
      title: `Results — ${event.name} | EventForge`,
      description: `Final results and rankings for ${event.name}`,
    };
  } catch {
    return { title: "Results — EventForge" };
  }
}

export default async function ResultsPage({ params }: Params) {
  const { slug } = await params;

  let event: { id: string; name: string; status: string } | undefined;
  try {
    const [row] = await db
      .select({ id: events.id, name: events.name, status: events.status })
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    event = row;
  } catch { /* DB unavailable */ }

  if (!event) notFound();

  // Fetch the latest final result run
  let latestRun: { id: string; runNo: number; status: string; publishedAt: Date | null } | null = null;
  let rankings: Array<{
    rank: number;
    entryId: string;
    displayName: string;
    finalScore: number;
    entryStatus: string;
  }> = [];

  try {
    const [run] = await db
      .select({ id: resultRuns.id, runNo: resultRuns.runNo, status: resultRuns.status, publishedAt: resultRuns.publishedAt })
      .from(resultRuns)
      .where(and(eq(resultRuns.eventId, event.id), eq(resultRuns.status, "final")))
      .orderBy(desc(resultRuns.runNo))
      .limit(1);

    if (run) {
      latestRun = run;

      const rows = await db
        .select({
          rank: calculatedResults.rank,
          entryId: calculatedResults.entryId,
          finalScore: calculatedResults.finalScore,
          entryStatus: calculatedResults.entryStatus,
          teamName: teams.name,
          displayName: users.displayName,
        })
        .from(calculatedResults)
        .leftJoin(entries, eq(calculatedResults.entryId, entries.id))
        .leftJoin(teams, eq(entries.teamId, teams.id))
        .leftJoin(participants, and(
          eq(participants.eventId, event.id),
          eq(entries.participantId, participants.id),
        ))
        .leftJoin(users, eq(participants.userId, users.id))
        .where(eq(calculatedResults.runId, run.id))
        .orderBy(calculatedResults.rank);

      rankings = rows.map(r => ({
        rank: r.rank ?? 0,
        entryId: r.entryId,
        displayName: r.teamName ?? r.displayName ?? "—",
        finalScore: Number(r.finalScore ?? 0),
        entryStatus: r.entryStatus ?? "active",
      }));
    }
  } catch { /* DB error — empty state */ }

  return (
    <main className="results-page">
      {/* Header */}
      <section className="results-header">
        <div className="container">
          <nav className="results-breadcrumb">
            <Link href="/events">Events</Link>
            <span className="breadcrumb-sep">›</span>
            <Link href={`/events/${slug}`}>{event.name}</Link>
            <span className="breadcrumb-sep">›</span>
            <span>Results</span>
          </nav>
          <div className="results-title-row">
            <div>
              <h1 className="results-title">Final Results</h1>
              <p className="results-subtitle">{event.name}</p>
            </div>
            {latestRun && (
              <div className="results-meta">
                <Badge status="approved">Final</Badge>
                <span className="results-run-info">
                  Run #{latestRun.runNo} ·{" "}
                  {latestRun.publishedAt
                    ? new Date(latestRun.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                    : "Unpublished"}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="results-content">
        <div className="container">
          {!latestRun ? (
            <div className="results-empty">
              <div className="results-empty-icon">📊</div>
              <h2 className="results-empty-title">Results Not Yet Published</h2>
              <p className="results-empty-desc">
                Final results will appear here once the organisers publish them.
              </p>
              <div className="results-empty-actions">
                <Link href={`/events/${slug}/leaderboard`} className="btn-outline">
                  View Live Leaderboard →
                </Link>
                <Link href={`/events/${slug}`} className="btn-ghost">Back to Event</Link>
              </div>
            </div>
          ) : rankings.length === 0 ? (
            <div className="results-empty">
              <div className="results-empty-icon">📋</div>
              <h2 className="results-empty-title">No Rankings Available</h2>
              <p className="results-empty-desc">The results run has been published but contains no entries.</p>
            </div>
          ) : (
            <>
              {/* Podium — top 3 */}
              {rankings.length >= 3 && (
                <div className="results-podium">
                  {(["🥈", "🥇", "🥉"] as const).map((medal, i) => {
                    const positions = [1, 0, 2] as const; // 2nd, 1st, 3rd displayed L→R
                    const r = rankings[positions[i]!];
                    if (!r) return null;
                    const pos = i === 1 ? 1 : i === 0 ? 2 : 3;
                    return (
                      <div key={r.entryId} className={`podium-slot podium-slot--${pos}`}>
                        <div className="podium-medal">{medal}</div>
                        <div className="podium-name">{r.displayName}</div>
                        <div className="podium-score tabular-nums">{r.finalScore.toFixed(2)}</div>
                        <div className="podium-base">{pos === 1 ? "1st" : pos === 2 ? "2nd" : "3rd"}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Full table */}
              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th className="col-rank">Rank</th>
                      <th className="col-name">Participant / Team</th>
                      <th className="col-score">Score</th>
                      <th className="col-status">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.map((r) => (
                      <tr
                        key={r.entryId}
                        className={`results-row${r.rank <= 3 ? " results-row--top" : ""}${r.entryStatus !== "active" ? " results-row--inactive" : ""}`}
                      >
                        <td className="col-rank">
                          <RankBadge rank={r.rank} />
                        </td>
                        <td className="col-name">
                          <span className="entry-name">{r.displayName}</span>
                        </td>
                        <td className="col-score">
                          <span className="score-num tabular-nums">{r.finalScore.toFixed(2)}</span>
                        </td>
                        <td className="col-status">
                          {r.entryStatus === "active" ? (
                            <Badge status="active">Active</Badge>
                          ) : r.entryStatus === "disqualified" ? (
                            <Badge status="rejected">DQ</Badge>
                          ) : (
                            <Badge status="default">{r.entryStatus}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="results-footer-note">
                {rankings.length} ranked participant{rankings.length !== 1 ? "s" : ""} ·{" "}
                Published{" "}
                {latestRun.publishedAt
                  ? new Date(latestRun.publishedAt).toLocaleString("en-IN")
                  : ""}
              </p>
            </>
          )}
        </div>
      </section>

      <style>{`
        .results-page { min-height: 100vh; }
        .results-header { border-bottom: 1px solid var(--border); padding: var(--space-8) 0 var(--space-6); background: var(--surface-1); }
        .results-breadcrumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-2); margin-bottom: var(--space-4); }
        .results-breadcrumb a { color: var(--text-2); text-decoration: none; }
        .results-breadcrumb a:hover { color: var(--text-1); }
        .breadcrumb-sep { color: var(--text-3); }
        .results-title-row { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); }
        .results-title { font-family: Georgia, serif; font-size: var(--text-3xl); font-weight: 400; color: var(--text-1); margin: 0; }
        .results-subtitle { color: var(--text-2); margin-top: var(--space-1); font-size: var(--text-base); }
        .results-meta { display: flex; align-items: center; gap: var(--space-3); padding-top: var(--space-1); }
        .results-run-info { font-size: var(--text-sm); color: var(--text-2); font-variant-numeric: tabular-nums; }
        .results-content { padding: var(--space-10) 0 var(--space-16); }
        .results-empty { text-align: center; padding: var(--space-16) var(--space-8); border: 1px dashed var(--border); max-width: 480px; margin: 0 auto; }
        .results-empty-icon { font-size: 3rem; margin-bottom: var(--space-4); }
        .results-empty-title { font-family: Georgia, serif; font-size: var(--text-xl); font-weight: 400; color: var(--text-1); margin: 0 0 var(--space-2); }
        .results-empty-desc { color: var(--text-2); font-size: var(--text-sm); margin-bottom: var(--space-6); }
        .results-empty-actions { display: flex; flex-direction: column; gap: var(--space-2); align-items: center; }
        .btn-outline { display: inline-block; padding: var(--space-2) var(--space-4); border: 1px solid var(--border); color: var(--text-1); text-decoration: none; font-size: var(--text-sm); transition: background 0.15s; }
        .btn-outline:hover { background: var(--surface-2); }
        .btn-ghost { display: inline-block; padding: var(--space-2) var(--space-4); color: var(--text-2); text-decoration: none; font-size: var(--text-sm); }
        .results-podium { display: flex; align-items: flex-end; justify-content: center; gap: var(--space-4); margin-bottom: var(--space-10); padding: var(--space-8) 0; }
        .podium-slot { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); min-width: 120px; }
        .podium-slot--1 { order: 2; }
        .podium-slot--2 { order: 1; }
        .podium-slot--3 { order: 3; }
        .podium-medal { font-size: 2.5rem; }
        .podium-name { font-size: var(--text-sm); font-weight: 600; color: var(--text-1); text-align: center; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .podium-score { font-size: var(--text-lg); font-variant-numeric: tabular-nums; font-weight: 700; color: var(--teal); }
        .podium-base { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); border: 1px solid var(--border); padding: var(--space-1) var(--space-3); margin-top: var(--space-1); }
        .podium-slot--1 .podium-base { padding: var(--space-2) var(--space-4); background: var(--surface-2); }
        .results-table-wrap { overflow-x: auto; border: 1px solid var(--border); margin-bottom: var(--space-4); }
        .results-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
        .results-table th { text-align: left; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface-1); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); font-weight: 500; }
        .results-table td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: middle; }
        .results-row:last-child td { border-bottom: none; }
        .results-row--top td { background: var(--surface-1); }
        .results-row--inactive { opacity: 0.55; }
        .results-row:hover td { background: var(--surface-2); }
        .col-rank { width: 70px; }
        .col-score { width: 110px; }
        .col-status { width: 90px; }
        .col-score th, td.col-score { text-align: right; }
        .entry-name { font-weight: 500; color: var(--text-1); }
        .score-num { color: var(--teal); font-weight: 700; }
        .results-footer-note { font-size: var(--text-xs); color: var(--text-3); text-align: center; padding-top: var(--space-2); }
        @media (max-width: 640px) {
          .results-podium { flex-direction: column; align-items: stretch; }
          .podium-slot { flex-direction: row; justify-content: space-between; border: 1px solid var(--border); padding: var(--space-3); order: unset !important; }
        }
      `}</style>
    </main>
  );
}

/**
 * modules/leaderboard/service/index.ts â€” Leaderboard snapshot service
 *
 * ARCHITECTURE.md Â§15.2: Single-flight rebuild via pg_try_advisory_xact_lock.
 * If the lock is already held (another request is rebuilding), the current
 * request immediately returns the previous (stale) snapshot â€” stale-while-
 * revalidate pattern. The client will get the fresh snapshot on the next poll.
 *
 * Stale detection: MAX(score_records.seq) for the event/scope != snapshot.score_seq
 * AND now() - snapshot.generated_at >= MIN_REBUILD_INTERVAL_MS (DB clock).
 *
 * Aggregation (per entry, per round): latest base row (quiz_auto | judge_final)
 * PLUS the sum of all admin_adjust / penalty rows. score_records is append-only,
 * so corrections are new rows, never updates.
 */
import "server-only";
import { db, withTx } from "@/core/db";
import {
  leaderboardSnapshots, events,
} from "@/core/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logger } from "@/core/logger";

/** Read at call time so it can be overridden (e.g. in tests). */
const minRebuildIntervalMs = () =>
  parseInt(process.env["LB_MIN_REBUILD_INTERVAL_MS"] ?? "5000", 10);
const TOP_N = parseInt(process.env["LB_TOP_N"] ?? "100", 10);

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LeaderboardEntry {
  rank: number;
  entryId: string;
  entryCode: string;
  displayName: string;
  teamName: string | null;
  finalScore: string;
  roundScores: Record<string, string>;
  tied: boolean;
}

export interface LeaderboardSnapshot {
  eventId: string;
  scope: string;
  version: number;
  generatedAt: Date;
  provisional: boolean;
  etag: string;
  entries: LeaderboardEntry[];
}

// â”€â”€ getOrRebuildSnapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getOrRebuildSnapshot(
  eventId: string,
  scope: string, // 'overall' | 'round:<uuid>'
): Promise<LeaderboardSnapshot> {
  // 1. Fetch current snapshot (may be null)
  const [current] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.eventId, eventId), eq(leaderboardSnapshots.scope, scope)))
    .orderBy(desc(leaderboardSnapshots.version))
    .limit(1);

  // 2. Check staleness
  const isStale = await checkStale(eventId, scope, current ?? null);

  if (!isStale && current) {
    return toSnapshot(current);
  }

  // 3. Try to acquire the advisory lock (single-flight rebuild)
  const lockKey = hashLockKey(eventId, scope);

  try {
    const rebuilt = await withTx(async (tx) => {
      const rows0 = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired`,
      );
      const acquired = Array.from(rows0)[0]?.acquired ?? false;

      if (!acquired) {
        // Another request is rebuilding â€” serve the stale snapshot immediately
        return null;
      }

      // Re-check inside the lock (double-checked locking)
      const [fresh] = await tx
        .select()
        .from(leaderboardSnapshots)
        .where(and(eq(leaderboardSnapshots.eventId, eventId), eq(leaderboardSnapshots.scope, scope)))
        .orderBy(desc(leaderboardSnapshots.version))
        .limit(1);

      const stillStale = await checkStale(eventId, scope, fresh ?? null, tx as unknown as typeof db);
      if (!stillStale && fresh) return toSnapshot(fresh);

      // 4. Compute results from score_records
      const { rows, watermark, provisional } = await computeRanking(eventId, scope, tx as unknown as typeof db);

      const newVersion = (fresh?.version ?? 0) + 1;
      const newEtag = `${scope}-${newVersion}`;

      const [inserted] = await tx
        .insert(leaderboardSnapshots)
        .values({
          eventId,
          scope,
          version: newVersion,
          provisional,
          scoreSeq: watermark,
          payload: rows as unknown as Record<string, unknown>[],
          etag: newEtag,
        })
        .returning();

      if (!inserted) throw new Error("Failed to insert leaderboard snapshot");
      return toSnapshot(inserted);
    });

    if (rebuilt) return rebuilt;
  } catch (err) {
    // Lock failed or TX error â€” fall through to serve stale
    logger.error("leaderboard rebuild failed", {
      event_id: eventId,
      error_code: err instanceof Error ? err.name : "unknown",
    });
  }

  // 5. Return stale (or empty) snapshot
  if (current) return toSnapshot(current);

  // No snapshot at all yet â€” return empty
  return {
    eventId,
    scope,
    version: 0,
    generatedAt: new Date(),
    provisional: true,
    etag: `${scope}-0`,
    entries: [],
  };
}

// â”€â”€ computeRanking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function computeRanking(
  eventId: string,
  scope: string,
  client: typeof db,
): Promise<{ rows: LeaderboardEntry[]; watermark: number | null; provisional: boolean }> {
  const isRoundScope = scope.startsWith("round:");
  const roundId = isRoundScope ? scope.slice(6) : null;
  const roundFilter = roundId ? sql`AND sr.round_id = ${roundId}` : sql``;

  // Watermark first: a row committed after this read triggers the next rebuild (safe direction).
  const watermark = await currentSeq(eventId, roundId, client);

  const scoreRows = await client.execute<{
    entryId: string;
    entryCode: string;
    teamName: string | null;
    displayName: string;
    totalScore: string;
    roundScores: Record<string, string>;
  }>(sql`
    WITH base AS (
      SELECT DISTINCT ON (sr.entry_id, sr.round_id)
        sr.entry_id, sr.round_id, sr.final_score AS score
      FROM app.score_records sr
      WHERE sr.event_id = ${eventId}
        AND sr.source IN ('quiz_auto', 'judge_final')
        ${roundFilter}
      ORDER BY sr.entry_id, sr.round_id, sr.seq DESC
    ),
    adj AS (
      SELECT sr.entry_id, sr.round_id, SUM(sr.final_score) AS score
      FROM app.score_records sr
      WHERE sr.event_id = ${eventId}
        AND sr.source IN ('admin_adjust', 'penalty')
        ${roundFilter}
      GROUP BY sr.entry_id, sr.round_id
    ),
    per_round AS (
      SELECT
        COALESCE(b.entry_id, a.entry_id) AS entry_id,
        COALESCE(b.round_id, a.round_id) AS round_id,
        COALESCE(b.score, 0) + COALESCE(a.score, 0) AS score
      FROM base b
      FULL JOIN adj a ON a.entry_id = b.entry_id AND a.round_id = b.round_id
    ),
    aggregated AS (
      SELECT
        pr.entry_id,
        SUM(pr.score) AS total_score,
        jsonb_object_agg(pr.round_id::TEXT, pr.score::TEXT) AS round_scores
      FROM per_round pr
      GROUP BY pr.entry_id
    ),
    entry_info AS (
      SELECT
        e.id AS entry_id,
        CASE
          WHEN e.team_id IS NOT NULL THEN 'T-' || t.team_no::TEXT
          ELSE 'P-' || p.participant_no::TEXT
        END AS entry_code,
        COALESCE(t.name, u.display_name) AS display_name,
        t.name AS team_name
      FROM app.entries e
      LEFT JOIN app.teams t ON t.id = e.team_id
      LEFT JOIN app.participants p ON p.id = e.participant_id
      LEFT JOIN app.users u ON u.id = p.user_id
      WHERE e.event_id = ${eventId}
    )
    SELECT
      ei.entry_id AS "entryId",
      ei.entry_code AS "entryCode",
      COALESCE(ei.display_name, ei.entry_code) AS "displayName",
      ei.team_name AS "teamName",
      agg.total_score::TEXT AS "totalScore",
      agg.round_scores AS "roundScores"
    FROM entry_info ei
    JOIN aggregated agg ON agg.entry_id = ei.entry_id
    ORDER BY agg.total_score DESC, ei.entry_code ASC
    LIMIT ${TOP_N}
  `);

  const rawRows = Array.from(scoreRows) as Array<{
    entryId: string;
    entryCode: string;
    displayName: string;
    teamName: string | null;
    totalScore: string;
    roundScores: Record<string, string>;
  }>;

  // Assign ranks with tie detection (numeric compare: '3.0000' vs '3' must tie)
  let rank = 1;
  const rows: LeaderboardEntry[] = rawRows.map((r, i) => {
    const prevScore = i > 0 ? rawRows[i - 1]!.totalScore : null;
    if (i > 0 && Number(r.totalScore) !== Number(prevScore)) rank = i + 1;

    const nextScore = rawRows[i + 1]?.totalScore;
    const tied =
      (prevScore !== null && Number(r.totalScore) === Number(prevScore)) ||
      (nextScore !== undefined && Number(r.totalScore) === Number(nextScore));

    return {
      rank,
      entryId: r.entryId,
      entryCode: r.entryCode,
      displayName: r.displayName,
      teamName: r.teamName,
      finalScore: r.totalScore,
      roundScores: r.roundScores,
      tied,
    };
  });

  // Check if event/round is still ongoing (provisional)
  const [eventRow] = await client
    .select({ status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const provisional = eventRow?.status !== "completed" && eventRow?.status !== "archived";

  return { rows, watermark, provisional };
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** MAX(seq) of score_records for the event (and round, for round scope). */
async function currentSeq(
  eventId: string,
  roundId: string | null,
  client: typeof db,
): Promise<number | null> {
  const res = await client.execute<{ maxSeq: string | null }>(sql`
    SELECT MAX(seq)::TEXT AS "maxSeq"
    FROM app.score_records
    WHERE event_id = ${eventId}
      ${roundId ? sql`AND round_id = ${roundId}` : sql``}
  `);
  const v = Array.from(res)[0]?.maxSeq ?? null;
  return v === null ? null : Number(v);
}

async function checkStale(
  eventId: string,
  scope: string,
  snapshot: typeof leaderboardSnapshots.$inferSelect | null,
  client: typeof db = db,
): Promise<boolean> {
  if (!snapshot) return true;

  // DB clock (R-TIME-01): age computed by Postgres, not the app server.
  const ageRes = await client.execute<{ ageMs: string }>(sql`
    SELECT (EXTRACT(EPOCH FROM (now() - ${snapshot.generatedAt.toISOString()}::timestamptz)) * 1000)::TEXT AS "ageMs"
  `);
  const ageMs = Number(Array.from(ageRes)[0]?.ageMs ?? "0");
  if (ageMs < minRebuildIntervalMs()) return false;

  const roundId = scope.startsWith("round:") ? scope.slice(6) : null;
  const maxSeq = await currentSeq(eventId, roundId, client);
  return maxSeq !== (snapshot.scoreSeq ?? null);
}

function hashLockKey(eventId: string, scope: string): bigint {
  // Simple deterministic hash for advisory lock key (must fit in int64)
  let h = 5381n;
  const str = `lb:${eventId}:${scope}`;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5n) + h + BigInt(str.charCodeAt(i))) & 0x7FFFFFFFFFFFFFFFn;
  }
  return h;
}

function toSnapshot(row: typeof leaderboardSnapshots.$inferSelect): LeaderboardSnapshot {
  return {
    eventId: row.eventId,
    scope: row.scope,
    version: row.version,
    generatedAt: row.generatedAt,
    provisional: row.provisional,
    etag: row.etag,
    entries: (row.payload as LeaderboardEntry[]) ?? [],
  };
}

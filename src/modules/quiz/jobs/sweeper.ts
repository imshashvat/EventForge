/**
 * modules/quiz/jobs/sweeper.ts — Auto-submit sweeper (M1-D4)
 *
 * Called by POST /api/v1/internal/jobs/tick ("sweeper" job type).
 * Finds all quiz_attempts where status='in_progress' AND deadline_at < now(),
 * then calls submitAttempt() for each (which is idempotent via SELECT FOR UPDATE).
 */
import "server-only";
import { db } from "@/core/db";
import { quizAttempts } from "@/core/db/schema";
import { eq, lt, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { submitAttempt } from "../service";
import { logger } from "@/core/logger";

export interface SweeperPayload {
  /** Restrict sweep to a specific event (used by event-close flow) */
  eventId?: string;
}

export interface SweeperResult {
  swept: number;
  failed: number;
  errors: Array<{ attemptId: string; error: string }>;
}

const SWEEP_LIMIT = parseInt(process.env["SWEEPER_BATCH"] ?? "300", 10);
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 25_000;

export async function runSweeper(
  payload: SweeperPayload,
  jobId: string,
): Promise<SweeperResult> {
  const log = logger;

  // Build where conditions
  const conditions = [
    eq(quizAttempts.status, "in_progress"),
    lt(quizAttempts.deadlineAt, sql`now()`),
  ] as const;

  const stale = await db
    .select({
      id: quizAttempts.id,
      entryId: quizAttempts.entryId,
      eventId: quizAttempts.eventId,
      deadlineAt: quizAttempts.deadlineAt,
    })
    .from(quizAttempts)
    .where(
      payload.eventId
        ? and(...conditions, eq(quizAttempts.eventId, payload.eventId))
        : and(...conditions),
    )
    .orderBy(quizAttempts.deadlineAt) // oldest deadline first
    .limit(SWEEP_LIMIT); // cap per tick; remaining attempts are picked up by the next tick

  if (stale.length === 0) {
    log.info("Sweeper: nothing to sweep");
    return { swept: 0, failed: 0, errors: [] };
  }

  log.info(`Sweeper: found ${stale.length} stale attempt(s) jobId=${jobId}`);

  let swept = 0;
  let failed = 0;
  const errors: Array<{ attemptId: string; error: string }> = [];

  const startedMs = Date.now();
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    // Stop early near the serverless time limit; leftovers are swept next tick.
    if (Date.now() - startedMs > TIME_BUDGET_MS) break;
    const chunk = stale.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (attempt) => {
        try {
          await submitAttempt({
            attemptId: attempt.id,
            // participantId intentionally omitted: system-initiated, audit uses startedByParticipantId
            requestId: `sweeper-${jobId}-${attempt.id}`,
          });
          swept++;
          log.info(`Sweeper: auto-submitted attemptId=${attempt.id} entryId=${attempt.entryId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failed++;
          errors.push({ attemptId: attempt.id, error: msg });
          log.error(`Sweeper: failed to auto-submit attemptId=${attempt.id}: ${msg}`, { error_code: "sweeper_error" });
        }
      }),
    );
  }

  log.info(`Sweeper done swept=${swept} failed=${failed} jobId=${jobId}`);

  return { swept, failed, errors };
}

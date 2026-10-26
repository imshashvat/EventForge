/**
 * core/jobs — DB-backed background job runner (ARCHITECTURE.md §17 Internal)
 *
 * Jobs are rows in the `jobs` table. The tick endpoint (POST /api/v1/internal/jobs/tick)
 * claims a batch using SKIP LOCKED and processes them. This pattern works with
 * serverless functions — no always-on worker is required.
 *
 * Job types handled by the sweeper tick:
 *   - sweeper        : auto-submit in-progress attempts past deadline
 *   - email          : send a queued email
 *   - export-chunk   : process one chunk of a chunked export
 *   - cleanup        : purge expired idempotency keys and old export parts
 *   - lb-rebuild     : trigger a leaderboard snapshot rebuild (optional)
 */
import "server-only";
import { pgSchema, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { eq, lt, lte, sql, and } from "drizzle-orm";
import { db, type Tx } from "@/core/db";
import { logger } from "@/core/logger";

export type JobType =
  | "sweeper"
  | "email"
  | "export-chunk"
  | "cleanup"
  | "lb-rebuild";

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead";

const app = pgSchema("app");

export const jobs = app.table("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").$type<JobType>().notNull(),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  payload: jsonb("payload").notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  lastError: text("last_error"),
  eventId: uuid("event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type JobRow = Record<string, unknown>;

const CLAIM_BATCH = 10;
const STALE_JOB_MS = 5 * 60 * 1000; // 5 min without heartbeat → reclaimable

/**
 * Enqueue a new job.
 */
export async function enqueueJob(
  type: JobType,
  payload: unknown,
  opts: { runAt?: Date; eventId?: string; maxAttempts?: number; tx?: Tx } = {},
): Promise<Job> {
  const client = opts.tx ?? db;
  const [job] = await client
    .insert(jobs)
    .values({
      type,
      payload: payload as Record<string, unknown>,
      runAt: opts.runAt ?? new Date(),
      eventId: opts.eventId ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning();
  if (!job) throw new Error("Failed to enqueue job");
  return job;
}

/**
 * Claim up to CLAIM_BATCH jobs that are ready to run.
 * Uses SKIP LOCKED so concurrent tick calls don't double-process.
 */
export async function claimJobs(type?: JobType): Promise<Job[]> {
  // Dead-letter stale running jobs that have exhausted their attempts (they would
  // otherwise stay 'running' forever). DB clock only (R-TIME-01).
  await db.execute(sql`
    UPDATE jobs
    SET status = 'dead', last_error = COALESCE(last_error, 'stale: attempts exhausted')
    WHERE status = 'running'
      AND heartbeat_at < now() - make_interval(secs => ${STALE_JOB_MS / 1000})
      AND attempts >= max_attempts
  `);

  const claimed = await db.execute<Job>(sql`
    UPDATE jobs
    SET status = 'running',
        started_at = now(),
        heartbeat_at = now(),
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE ((status = 'queued' AND run_at <= now())
         OR (status = 'running'
             AND heartbeat_at < now() - make_interval(secs => ${STALE_JOB_MS / 1000})
             AND attempts < max_attempts))
      ${type ? sql`AND type = ${type}` : sql``}
      ORDER BY run_at ASC
      LIMIT ${CLAIM_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  return Array.from(claimed) as Job[];
}

/**
 * Ensure exactly one pending job of this type exists (queued or running).
 * Race-safe enough for cron use: a duplicate only causes one extra idempotent sweep.
 */
export async function ensureJob(type: JobType, payload: unknown = {}): Promise<boolean> {
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO jobs (type, payload)
    SELECT ${type}, ${JSON.stringify(payload)}::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM jobs WHERE type = ${type} AND status IN ('queued', 'running')
    )
    RETURNING id
  `);
  return Array.from(res).length > 0;
}

/**
 * Update the heartbeat of a running job (prevents stale detection mid-chunk).
 */
export async function heartbeat(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ heartbeatAt: sql`now()` })
    .where(eq(jobs.id, jobId));
}

/**
 * Mark a job as done.
 */
export async function completeJob(jobId: string, tx?: Tx): Promise<void> {
  const client = tx ?? db;
  await client
    .update(jobs)
    .set({ status: "done", completedAt: sql`now()` })
    .where(eq(jobs.id, jobId));
}

/**
 * Mark a job as failed. If attempts >= maxAttempts, move to dead-letter.
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return;

  const status: JobStatus = job.attempts >= job.maxAttempts ? "dead" : "queued";
  const backoffSecs = Math.min(Math.pow(2, job.attempts), 300);

  await db.update(jobs).set({
    status,
    lastError: error.slice(0, 2000),
    ...(status === "queued" ? { runAt: sql`now() + make_interval(secs => ${backoffSecs})` } : {}),
  }).where(eq(jobs.id, jobId));

  logger.warn("Job failed", { error_code: "job_failed", route: "jobs", message: error });
}

/**
 * Delete old done/dead jobs older than retentionDays.
 */
export async function purgeOldJobs(retentionDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(jobs)
    .where(and(
      lte(jobs.completedAt, cutoff),
      sql`status IN ('done', 'dead')`,
    ));
  return (result as unknown as { rowCount: number }).rowCount ?? 0;
}

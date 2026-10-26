/**
 * modules/results/service.ts — M2-C3
 *
 * Result run lifecycle (ARCHITECTURE.md §14).
 *
 *   runResults()    — pull all inputs from DB, call computeResults(), persist
 *                     result_runs + calculated_results. Idempotent for the same
 *                     inputs_hash (returns existing run instead of duplicating).
 *   publishRun()    — transition status: dry_run|provisional → final
 *                     Marks any prior final run as "superseded".
 *   getResultRun()  — fetch a run + its calculated_results.
 *
 * inputs_hash = SHA-256 over canonical JSON of (config + score_record ids/values
 * + entry statuses + tie-break inputs) as defined in ARCHITECTURE.md §14.6.
 */
import "server-only";

import { createHash } from "node:crypto";
import { db, withTx } from "@/core/db";
import {
  resultRuns,
  calculatedResults,
  scoreRecords,
  entries,
} from "@/core/db/schema";
import { writeAudit } from "@/core/audit";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "@/core/errors";
import { and, eq, inArray, sql } from "drizzle-orm";
import { computeResults, type ResultConfig, type EntryInput, type ScoreRecord } from "./compute";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunStatus = "dry_run" | "provisional" | "final" | "superseded";

export interface RunResultsInput {
  eventId: string;
  status: "dry_run" | "provisional";
  actorUserId: string;
  requestId: string;
  /** Override config — defaults to event.result_config if omitted. */
  configOverride?: ResultConfig | undefined;
}

export interface PublishRunInput {
  runId: string;
  eventId: string;
  actorUserId: string;
  requestId: string;
}

// ── Hash helper ───────────────────────────────────────────────────────────────

function hashInputs(config: ResultConfig, rawScores: ScoreRecord[], entryInputs: EntryInput[]): string {
  const canonical = JSON.stringify({
    config,
    scores: rawScores
      .map((s) => ({ id: s.id, entryId: s.entryId, roundId: s.roundId, source: s.source, rawScore: s.rawScore, supersededBy: s.supersededBy }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    entries: entryInputs
      .map((e) => ({ entryId: e.entryId, status: e.status, lastSubmitAt: e.lastSubmitAt, totalTimeMs: e.totalTimeMs }))
      .sort((a, b) => a.entryId.localeCompare(b.entryId)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ── runResults() ──────────────────────────────────────────────────────────────

/**
 * Compute and persist a result run.
 *
 * Steps:
 *  1. Load event result_config (or configOverride).
 *  2. Pull all score_records for the event.
 *  3. Pull all entries with status + submission metadata.
 *  4. Compute inputs_hash; return existing run if hash already exists.
 *  5. Call computeResults() (pure function, no I/O).
 *  6. Insert result_runs row + calculated_results rows in a transaction.
 */
export async function runResults(input: RunResultsInput) {
  const config: ResultConfig = input.configOverride ?? (() => {
    throw new ValidationError("configOverride is required until events.result_config column is added (migration 0013).");
  })();
  if (!config?.mode) {
    throw new ValidationError("Result config must specify mode, rounds, and other fields.");
  }

  // Pull all score records for this event
  const rawScores = await db
    .select()
    .from(scoreRecords)
    .where(eq(scoreRecords.eventId, input.eventId));

  // Pull all entries for this event (entries table has no status column yet — all default active)
  const rawEntries = await db
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.eventId, input.eventId));

  // Map to EntryInput (status defaults to 'active' until entry status column added)
  const entryInputs: EntryInput[] = rawEntries.map((e) => ({
    entryId: e.id,
    status: "active" as EntryInput["status"],
  }));

  // Map score records to compute format
  const computeScores: ScoreRecord[] = rawScores.map((s) => ({
    id: s.id,
    entryId: s.entryId,
    roundId: s.roundId,
    source: s.source as ScoreRecord["source"],
    rawScore: String(s.rawScore),
    finalScore: String(s.finalScore ?? s.rawScore),
    supersededBy: s.supersededBy,
  }));

  const inputsHash = hashInputs(config, computeScores, entryInputs);

  // Idempotency: if identical hash exists with same status, return existing
  const [existing] = await db
    .select({ id: resultRuns.id, runNo: resultRuns.runNo, status: resultRuns.status })
    .from(resultRuns)
    .where(and(
      eq(resultRuns.eventId, input.eventId),
      eq(resultRuns.inputsHash, inputsHash),
      eq(resultRuns.status, input.status),
    ))
    .limit(1);

  if (existing) {
    return { runId: existing.id, runNo: existing.runNo, status: existing.status, cached: true };
  }

  // Get next run number
  const [maxRunRow] = await db
    .select({ maxRun: sql<number>`COALESCE(MAX(${resultRuns.runNo}), 0)` })
    .from(resultRuns)
    .where(eq(resultRuns.eventId, input.eventId));

  const nextRunNo = (maxRunRow?.maxRun ?? 0) + 1;

  // Compute results (pure — no I/O)
  const rows = computeResults({ entries: entryInputs, scoreRecords: computeScores, config });

  return withTx(async (tx) => {
    const [run] = await tx.insert(resultRuns).values({
      eventId: input.eventId,
      runNo: nextRunNo,
      status: input.status,
      configSnapshot: config as unknown as Record<string, unknown>,
      inputsHash,
      triggeredByUserId: input.actorUserId,
      runAt: new Date(),
    }).returning();

    if (!run) throw new Error("Failed to create result run");

    if (rows.length > 0) {
      await tx.insert(calculatedResults).values(
        rows.map((r) => ({
          runId: run.id,
          eventId: input.eventId,
          entryId: r.entryId,
          finalScore: r.finalScore,
          rank: r.rank,
          tieStatus: r.tieStatus,
          advancementStatus: r.advancementStatus,
          entryStatus: r.entryStatus,
          statusReason: r.statusReason,
          roundBreakdown: r.roundBreakdown as unknown[],
        })),
      );
    }

    await writeAudit({
      actorUserId: input.actorUserId,
      action: "result.publish",
      targetType: "result_run",
      targetId: run.id,
      eventId: input.eventId,
      after: { runNo: nextRunNo, status: input.status, rowCount: rows.length },
      requestId: input.requestId,
    }, tx);

    return { runId: run.id, runNo: run.runNo, status: run.status, rowCount: rows.length, cached: false };
  });
}

// ── publishRun() ──────────────────────────────────────────────────────────────

/**
 * Promote a dry_run or provisional run to "final".
 * Marks any existing final runs for this event as "superseded".
 * The superseded run's data is never deleted (ARCHITECTURE.md §14.1, BR-09).
 */
export async function publishRun(input: PublishRunInput) {
  return withTx(async (tx) => {
    const [run] = await tx
      .select()
      .from(resultRuns)
      .where(and(eq(resultRuns.id, input.runId), eq(resultRuns.eventId, input.eventId)))
      .limit(1);

    if (!run) throw new NotFoundError("Result run");

    if (run.status === "final") {
      throw new ConflictError("Run is already final");
    }
    if (run.status === "superseded") {
      throw new ForbiddenError("Cannot publish a superseded run");
    }

    // Supersede existing final runs
    const finalRuns = await tx
      .select({ id: resultRuns.id })
      .from(resultRuns)
      .where(and(eq(resultRuns.eventId, input.eventId), eq(resultRuns.status, "final")));

    if (finalRuns.length > 0) {
      await tx.update(resultRuns)
        .set({ status: "superseded", supersededByRunId: input.runId })
        .where(inArray(resultRuns.id, finalRuns.map((r) => r.id)));
    }

    const now = new Date();
    await tx.update(resultRuns)
      .set({ status: "final", publishedAt: now })
      .where(eq(resultRuns.id, input.runId));

    await writeAudit({
      actorUserId: input.actorUserId,
      action: "result.publish",
      targetType: "result_run",
      targetId: input.runId,
      eventId: input.eventId,
      before: { status: run.status },
      after: { status: "final", superseded: finalRuns.length },
      requestId: input.requestId,
    }, tx);

    return { runId: input.runId, status: "final" as const, supersededCount: finalRuns.length };
  });
}

// ── getResultRun() ────────────────────────────────────────────────────────────

export async function getResultRun(runId: string) {
  const [run] = await db
    .select()
    .from(resultRuns)
    .where(eq(resultRuns.id, runId))
    .limit(1);

  if (!run) throw new NotFoundError("Result run");

  const results = await db
    .select()
    .from(calculatedResults)
    .where(eq(calculatedResults.runId, runId))
    .orderBy(calculatedResults.rank);

  return { run, results };
}

export async function getLatestFinalRun(eventId: string) {
  const [run] = await db
    .select()
    .from(resultRuns)
    .where(and(eq(resultRuns.eventId, eventId), eq(resultRuns.status, "final")))
    .orderBy(sql`${resultRuns.runNo} DESC`)
    .limit(1);

  if (!run) return null;

  return getResultRun(run.id);
}


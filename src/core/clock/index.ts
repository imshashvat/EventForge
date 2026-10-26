/**
 * core/clock — Authoritative DB clock (R-TIME-01, BR-02)
 *
 * The ONLY place that reads "now" for deadline math is this module.
 * It fetches now() from PostgreSQL — never from Date.now() or new Date().
 *
 * Usage:
 *   const now = await dbNow(tx);
 *   const deadlineAt = addMilliseconds(now, durationMs);
 */
import "server-only";
import { sql } from "drizzle-orm";
import { type Tx } from "@/core/db";

/**
 * Returns the current timestamp from the PostgreSQL clock.
 * Must be called within a transaction for deadline calculations.
 */
export async function dbNow(tx: Tx): Promise<Date> {
  const result = await tx.execute(sql`SELECT now() AS now`);
  const row = result[0] as { now: Date | string } | undefined;
  if (!row?.now) throw new Error("Failed to read DB clock");
  // postgres-js may return timestamp as string in pooler mode — coerce explicitly
  const val = row.now;
  return val instanceof Date ? val : new Date(val as string);
}

/**
 * Compute attempt deadline = LEAST(startedAt + durationMs, roundEndsAt)
 * Both math operations happen server-side with DB timestamps (BR-04).
 */
export function computeDeadline(startedAt: Date, durationMs: number, roundEndsAt: Date): Date {
  const attemptEnd = new Date(startedAt.getTime() + durationMs);
  return attemptEnd < roundEndsAt ? attemptEnd : roundEndsAt;
}

/**
 * True if the given deadline is in the past relative to a DB-sourced "now".
 */
export function isPast(deadlineAt: Date, now: Date): boolean {
  return now >= deadlineAt;
}

/**
 * Remaining milliseconds; clamped to 0 if past.
 */
export function remainingMs(deadlineAt: Date, now: Date): number {
  return Math.max(0, deadlineAt.getTime() - now.getTime());
}

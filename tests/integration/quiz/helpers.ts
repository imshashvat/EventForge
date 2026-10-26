/**
 * tests/integration/quiz/helpers.ts — Shared assertion helpers
 */
import { expect } from "vitest";
import Decimal from "decimal.js";
import type { TestTx } from "../setup";
import { quizAttempts, scoreRecords } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type AnyDb = PostgresJsDatabase | TestTx;

/** Assert score string equals expected decimal, using Decimal.js for comparison */
export function assertScore(actual: string | null | undefined, expected: string, msg?: string) {
  expect(actual, msg).toBeDefined();
  expect(
    new Decimal(actual!).equals(new Decimal(expected)),
    `${msg ?? "score"}: expected ${expected}, got ${actual}`,
  ).toBe(true);
}

/** Assert attempt is in the given status in the DB */
export async function assertAttemptStatus(
  db: AnyDb,
  attemptId: string,
  expectedStatus: string,
) {
  const [row] = await (db as PostgresJsDatabase)
    .select({ status: quizAttempts.status })
    .from(quizAttempts)
    .where(eq(quizAttempts.id, attemptId))
    .limit(1);
  expect(row?.status, `attempt ${attemptId} status`).toBe(expectedStatus);
}

/** Assert that a serialized HTTP response body does not contain isCorrect for participants (BR-07) */
export function assertNoLeakIsCorrect(body: Record<string, unknown>) {
  const questions = (body["questions"] as Array<Record<string, unknown>>) ?? [];
  for (const q of questions) {
    const resp = q["response"] as Record<string, unknown> | null;
    if (resp !== null) {
      expect(
        resp?.["isCorrect"],
        "BR-07: isCorrect must not be present for participant view",
      ).toBeUndefined();
    }
  }
}

/** Assert exactly one score_record exists for an attempt (via sourceRefId) */
export async function assertOneScoreRecord(db: AnyDb, attemptId: string) {
  const rows = await (db as PostgresJsDatabase)
    .select({ id: scoreRecords.id, finalScore: scoreRecords.finalScore })
    .from(scoreRecords)
    .where(eq(scoreRecords.sourceRefId, attemptId));
  expect(rows.length, `expected exactly 1 score_record for attempt ${attemptId}`).toBe(1);
  return rows[0]!;
}

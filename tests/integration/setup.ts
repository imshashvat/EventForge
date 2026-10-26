/**
 * tests/integration/setup.ts — Shared DB setup for integration tests
 *
 * Uses TEST_DATABASE_URL if set, otherwise falls back to DATABASE_URL.
 * Each test should wrap mutations in withTestTx() which always rolls back,
 * giving a clean state without needing truncate/seed between tests.
 *
 * Usage in a test file:
 *   import { withTestTx, testDb } from "../setup";
 *
 *   it("creates a bank", async () => {
 *     await withTestTx(async (tx) => {
 *       const [bank] = await tx.insert(questionBanks).values({...}).returning();
 *       expect(bank.id).toBeDefined();
 *       // tx is rolled back after this function returns — nothing persists
 *     });
 *   });
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  (() => { throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set for integration tests"); })();

// Single connection for the test process (singleFork = one process)
const testClient = postgres(DATABASE_URL, {
  max: 2,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
});

export const testDb: PostgresJsDatabase = drizzle(testClient);

export type TestTx = Parameters<Parameters<typeof testDb.transaction>[0]>[0];

/**
 * Run fn inside a transaction that is ALWAYS rolled back.
 * This guarantees test isolation without truncating tables.
 */
export async function withTestTx<T>(fn: (tx: TestTx) => Promise<T>): Promise<T> {
  let result: T;
  try {
    await testDb.transaction(async (tx) => {
      result = await fn(tx);
      // Force rollback by throwing a special sentinel error
      throw new RollbackSentinel();
    });
  } catch (err) {
    if (err instanceof RollbackSentinel) {
      return result!;
    }
    throw err;
  }
  return result!;
}

class RollbackSentinel extends Error {
  constructor() { super("__rollback__"); }
}

/** Verify DB connectivity at suite startup */
export async function verifyDb(): Promise<void> {
  const result = await testDb.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
  if (!Array.from(result)[0]) {
    throw new Error("Integration test DB is not reachable");
  }
}

/** Close the DB connection pool — call in afterAll */
export async function closeDb(): Promise<void> {
  await testClient.end();
}

/**
 * Delete rows by id from any table.
 * Use this to clean up seed data that was committed (not rolled back).
 *
 * Tables should be passed leaf-first (child before parent) to respect FK ordering.
 * Example: deleteIds({ "app.quiz_responses": [r1, r2], "app.quiz_attempts": [a1] })
 */
export async function deleteIds(
  deletions: Record<string, string[]>,
): Promise<void> {
  for (const [table, ids] of Object.entries(deletions)) {
    if (ids.length === 0) continue;
    const idList = ids.map((id) => `'${id}'`).join(",");
    await testDb.execute(
      sql.raw(`DELETE FROM ${table} WHERE id = ANY(ARRAY[${idList}]::uuid[])`),
    );
  }
}

/**
 * core/db — Database connection pool and transaction helpers
 * (ARCHITECTURE.md §6.1, §21.3, R-DB-07)
 *
 * Uses Drizzle ORM with the postgres-js driver in transaction-pooler mode.
 * DB_POOL_MAX is intentionally small (default 2) per serverless instance
 * to prevent connection exhaustion on Supabase pooler (ARCHITECTURE.md §18.3).
 *
 * Direct exports:
 *   db       — the Drizzle client (runtime, pooled, app_rw role)
 *   dbRo     — read-only client (exports, app_ro role)
 *   withTx   — begin a serializable transaction
 *   type Tx  — the transaction type used by all repo functions
 */
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/core/config";

// Transaction-mode pooler — each query gets its own connection from the pool.
// SET statement_timeout is applied at query level, not session level.
const poolClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  // transaction mode: no session-level state survives between queries
  prepare: false,
});

const poolClientRo = postgres(env.DATABASE_READONLY_URL, {
  max: env.DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(poolClient);
export const dbRo = drizzle(poolClientRo);

// The transaction type — every repository function accepts this as first arg
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run fn inside a single database transaction.
 * On error, the transaction is automatically rolled back.
 *
 * Usage:
 *   return withTx(async (tx) => {
 *     await writeAudit({ ... }, tx);
 *     await insertParticipant({ ... }, tx);
 *   });
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

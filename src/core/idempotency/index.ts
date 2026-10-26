/**
 * core/idempotency — Idempotency key store (R-API-01, NFR-REL-04)
 *
 * Mutable operations (registration, attempt start/submit, challenge submit,
 * export create) require an Idempotency-Key header.
 *
 * On the first request: execute the operation and store the result.
 * On replay (same key): return the stored result without re-executing.
 *
 * Keys expire after TTL (default 24h for most ops, 1h for exports).
 *
 * DB table: idempotency_keys (key TEXT PK, status, response_body JSONB,
 *           response_status INT, expires_at TIMESTAMPTZ)
 */
import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/core/db";
import { ConflictError } from "@/core/errors";

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  status: text("status", { enum: ["processing", "done"] }).notNull().default("processing"),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyRecord = typeof idempotencyKeys.$inferSelect;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Attempt to claim an idempotency key.
 * - Returns null if the key is new (caller should proceed and call markDone).
 * - Returns the stored result if the key was already completed.
 * - Throws ConflictError if the key is currently being processed (in-flight).
 */
export async function claimKey(
  key: string,
  ttlMs = DEFAULT_TTL_MS,
  tx?: Tx,
): Promise<IdempotencyRecord | null> {
  const client = tx ?? db;
  const expiresAt = new Date(Date.now() + ttlMs);

  // Try to insert — if it already exists, read the existing record
  await client.execute(sql`
    INSERT INTO idempotency_keys (key, status, expires_at)
    VALUES (${key}, 'processing', ${expiresAt})
    ON CONFLICT (key) DO NOTHING
  `);

  const [record] = await client
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);

  if (!record) return null; // fresh insert succeeded, caller should proceed

  if (record.status === "processing") {
    // Another request is mid-flight with the same key
    throw new ConflictError(
      "A request with this Idempotency-Key is already being processed",
      "idempotency_in_flight",
    );
  }

  // status === "done" — return the stored result for replay
  return record;
}

/**
 * Mark a key as done with the result of the operation.
 * Must be called in the same transaction as the operation itself.
 */
export async function markDone(
  key: string,
  responseStatus: number,
  responseBody: unknown,
  tx: Tx,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ status: "done", responseStatus, responseBody })
    .where(eq(idempotencyKeys.key, key));
}

/**
 * Cleanup expired keys. Called by the background job runner.
 */
export async function purgeExpired(): Promise<number> {
  const result = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()));
  return (result as unknown as { rowCount: number }).rowCount ?? 0;
}

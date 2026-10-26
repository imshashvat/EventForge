/**
 * core/audit — Append-only audit log writer (FR-AUDIT-01, BR-29, R-AUD-01)
 *
 * CRITICAL: writeAudit() MUST be called inside the same transaction as the
 * state change it records. If the transaction rolls back, the audit record
 * rolls back with it — no orphaned audit entries.
 *
 * The audit_logs table has a DB trigger blocking UPDATE and DELETE (BR-29).
 * PII fields in before/after must be redacted before passing to writeAudit.
 */
import "server-only";
import { type Tx } from "@/core/db";
import { pgSchema, text, uuid, jsonb, timestamp, index } from "drizzle-orm/pg-core";

const app = pgSchema("app");

export const auditLogs = app.table(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Actor
    actorUserId: uuid("actor_user_id"),
    actorRoleKey: text("actor_role_key"),
    // Action
    action: text("action").notNull(),
    // Target
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    // Scope (optional context)
    eventId: uuid("event_id"),
    roundId: uuid("round_id"),
    // State
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    // Request context
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    // Timestamp
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorUserId),
    index("audit_logs_event_idx").on(t.eventId),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export type AuditAction =
  // Events
  | "event.create" | "event.update" | "event.publish" | "event.pause"
  | "event.resume" | "event.complete" | "event.archive"
  // Registration
  | "registration.create" | "registration.approve" | "registration.reject"
  | "registration.waitlist" | "registration.withdraw"
  // Rounds
  | "round.create" | "round.update" | "round.open" | "round.close"
  | "round.pause" | "round.resume" | "round.extend" | "round.cancel"
  | "round.finalize" | "round.unlock"
  // Quiz
  | "attempt.start" | "attempt.submit" | "attempt.auto_submit"
  | "attempt.invalidate" | "attempt.rescore"
  // Challenge
  | "submission.draft" | "submission.submit"
  // Judging
  | "rubric.create"
  | "judging.assign" | "judging.finalize"
  | "evaluation.draft" | "evaluation.submit" | "evaluation.unlock" | "evaluation.reconcile"
  // Scoring
  | "score.adjust" | "score.penalize" | "score.unlock"
  | "result.publish" | "result.supersede"
  // Roles
  | "role.assign" | "role.revoke"
  // Exports
  | "export.create" | "export.download"
  // Auth
  | "auth.sign_up" | "auth.sign_in" | "auth.password_reset" | "auth.mfa_enable";

export interface AuditInput {
  actorUserId?: string | null;
  actorRoleKey?: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  eventId?: string;
  roundId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
  ipHash?: string;
}

/**
 * Write an audit log entry. MUST be called within the same transaction
 * as the state change being recorded (R-AUD-01).
 */
export async function writeAudit(input: AuditInput, tx: Tx): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: input.actorUserId ?? null,
    actorRoleKey: input.actorRoleKey ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    eventId: input.eventId ?? null,
    roundId: input.roundId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
    ipHash: input.ipHash ?? null,
  });
}

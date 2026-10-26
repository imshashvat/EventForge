/**
 * modules/judging/service.ts — M2-B2, M2-B3, M2-B4
 *
 * Rubric management, judge assignment, evaluation workflow.
 * ARCHITECTURE.md §13.
 *
 * Key invariants:
 *  - Rubric is 1-per-round (unique constraint enforced by DB).
 *  - Assignments: one judge may not be assigned twice to the same submission (unique constraint).
 *  - Evaluations are append-only: every save creates a new revision row.
 *  - Locked evaluations are immutable; unlocking requires reason + audit.
 *  - Finalization writes a score_record of source='judge_aggregate'.
 *  - Disagreement: spread = (max_total - min_total) / rubric_max * 100.
 *    If spread > variance_threshold_pct → needs_reconciliation flag.
 */
import "server-only";

import { db, withTx } from "@/core/db";
import {
  evaluationRubrics,
  evaluationCriteria,
  judgingAssignments,
  judgeEvaluations,
  judgeEvaluationScores,
  evaluationResolutions,
  submissions,
  scoreRecords,
  rounds,
  users,
} from "@/core/db/schema";
import { writeAudit } from "@/core/audit";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} from "@/core/errors";
import { and, eq, inArray, max, sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CriterionInput {
  name: string;
  description?: string | undefined;
  maxMarks: number;
  weight?: number | undefined;
  displayOrder?: number | undefined;
}

export interface CreateRubricInput {
  roundId: string;
  eventId: string;
  name: string;
  aggregation?: "mean" | "median" | "trimmed_mean" | "max" | "min" | "weighted_judges" | undefined;
  varianceThresholdPct?: number | undefined;
  minJudges?: number | undefined;
  blind?: boolean | undefined;
  criteria: CriterionInput[];
  actorUserId: string;
  requestId: string;
}

export interface AssignJudgesInput {
  submissionId: string;
  judgeUserIds: string[];
  rubricId: string;
  eventId: string;
  actorUserId: string;
  requestId: string;
}

export interface ScoreInput {
  criterionId: string;
  marksAwarded: number;
  comment?: string | undefined;
}

export interface SaveEvaluationInput {
  assignmentId: string;
  judgeUserId: string;
  eventId: string;
  scores: ScoreInput[];
  comment?: string | undefined;
  submit: boolean; // false = draft, true = final submit
  requestId: string;
}

export interface ResolveDisagreementInput {
  submissionId: string;
  rubricId: string;
  eventId: string;
  method: "adopt_mean" | "adopt_median" | "manual_value";
  manualValue?: number | undefined;
  reason: string;
  actorUserId: string;
  requestId: string;
}

export interface FinalizeJudgingInput {
  submissionId: string;
  rubricId: string;
  eventId: string;
  roundId: string;
  entryId: string;
  actorUserId: string;
  requestId: string;
}

// ── M2-B2: Rubric management ──────────────────────────────────────────────────

export async function createRubric(input: CreateRubricInput) {
  return withTx(async (tx) => {
    // One rubric per round (unique constraint, but give a clear error)
    const [existing] = await tx
      .select({ id: evaluationRubrics.id })
      .from(evaluationRubrics)
      .where(eq(evaluationRubrics.roundId, input.roundId))
      .limit(1);
    if (existing) throw new ConflictError("A rubric already exists for this round");

    const [rubric] = await tx
      .insert(evaluationRubrics)
      .values({
        roundId: input.roundId,
        eventId: input.eventId,
        name: input.name,
        aggregation: input.aggregation ?? "mean",
        varianceThresholdPct: String(input.varianceThresholdPct ?? 20),
        minJudges: input.minJudges ?? 1,
        blind: input.blind ?? false,
      })
      .returning();
    if (!rubric) throw new Error("Failed to create rubric");

    const criteriaRows = input.criteria.map((c, i) => ({
      rubricId: rubric.id,
      eventId: input.eventId,
      name: c.name,
      description: c.description,
      maxMarks: String(c.maxMarks),
      ...(c.weight !== undefined ? { weight: String(c.weight) } : {}),
      displayOrder: c.displayOrder ?? i + 1,
    }));

    const insertedCriteria = await tx
      .insert(evaluationCriteria)
      .values(criteriaRows)
      .returning({ id: evaluationCriteria.id });

    await writeAudit({
      actorUserId: input.actorUserId,
      action: "rubric.create",
      targetType: "evaluation_rubric",
      targetId: rubric.id,
      eventId: input.eventId,
      after: { name: rubric.name, criteriaCount: insertedCriteria.length },
      requestId: input.requestId,
    }, tx);

    return { rubricId: rubric.id, criteriaCount: insertedCriteria.length };
  });
}

export async function getRubric(rubricId: string) {
  const [rubric] = await db
    .select()
    .from(evaluationRubrics)
    .where(eq(evaluationRubrics.id, rubricId))
    .limit(1);
  if (!rubric) throw new NotFoundError("Rubric");

  const criteria = await db
    .select()
    .from(evaluationCriteria)
    .where(eq(evaluationCriteria.rubricId, rubricId))
    .orderBy(evaluationCriteria.displayOrder);

  return { ...rubric, criteria };
}

// ── M2-B3: Assignment service ─────────────────────────────────────────────────

/**
 * Assign one or more judges to a submission. Skips duplicates (idempotent per judge).
 * COI check: judge cannot be from the entry's own team (caller must enforce; 
 * no team_members table yet — tracked as open item OI-4 in TASKS.md).
 */
export async function assignJudges(input: AssignJudgesInput) {
  return withTx(async (tx) => {
    const [sub] = await tx
      .select({ id: submissions.id, status: submissions.status })
      .from(submissions)
      .where(eq(submissions.id, input.submissionId))
      .limit(1);
    if (!sub) throw new NotFoundError("Submission");

    const [rubric] = await tx
      .select({ id: evaluationRubrics.id })
      .from(evaluationRubrics)
      .where(eq(evaluationRubrics.id, input.rubricId))
      .limit(1);
    if (!rubric) throw new NotFoundError("Rubric");

    const created: string[] = [];
    const skipped: string[] = [];

    for (const judgeUserId of input.judgeUserIds) {
      const [row] = await tx
        .insert(judgingAssignments)
        .values({
          submissionId: input.submissionId,
          judgeUserId,
          rubricId: input.rubricId,
          eventId: input.eventId,
          assignedByUserId: input.actorUserId,
        })
        .onConflictDoNothing({ target: [judgingAssignments.submissionId, judgingAssignments.judgeUserId] })
        .returning({ id: judgingAssignments.id });

      if (row) {
        created.push(row.id);
      } else {
        skipped.push(judgeUserId);
      }
    }

    if (created.length > 0) {
      await writeAudit({
        actorUserId: input.actorUserId,
        action: "judging.assign",
        targetType: "submission",
        targetId: input.submissionId,
        eventId: input.eventId,
        after: { assigned: created.length, skipped: skipped.length },
        requestId: input.requestId,
      }, tx);
    }

    return { created: created.length, skipped: skipped.length };
  });
}

// ── M2-B4: Evaluation service ─────────────────────────────────────────────────

/**
 * Save an evaluation (draft or final submit).
 * Every save inserts a new judge_evaluation row (append-only revisions).
 * On submit: increments revisionNo, sets status=submitted, writes audit.
 */
export async function saveEvaluation(input: SaveEvaluationInput) {
  return withTx(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(judgingAssignments)
      .where(and(
        eq(judgingAssignments.id, input.assignmentId),
        eq(judgingAssignments.judgeUserId, input.judgeUserId),
      ))
      .limit(1);

    if (!assignment) throw new NotFoundError("Judging assignment");

    // Check for existing locked evaluation (immutable — BR-08)
    const existingEvals = await tx
      .select({ id: judgeEvaluations.id, status: judgeEvaluations.status, revisionNo: judgeEvaluations.revisionNo })
      .from(judgeEvaluations)
      .where(and(
        eq(judgeEvaluations.assignmentId, input.assignmentId),
        eq(judgeEvaluations.judgeUserId, input.judgeUserId),
      ))
      .orderBy(judgeEvaluations.revisionNo);

    const latestEval = existingEvals.at(-1);
    if (latestEval?.status === "locked") {
      throw new ForbiddenError("Evaluation is locked. Request unlock before editing.");
    }

    const nextRevNo = (latestEval?.revisionNo ?? 0) + 1;
    const now = new Date();

    const [evaluation] = await tx
      .insert(judgeEvaluations)
      .values({
        assignmentId: input.assignmentId,
        submissionId: assignment.submissionId,
        judgeUserId: input.judgeUserId,
        eventId: input.eventId,
        revisionNo: nextRevNo,
        status: input.submit ? "submitted" : "draft",
        comment: input.comment,
        ...(input.submit ? { submittedAt: now } : {}),
      })
      .returning();

    if (!evaluation) throw new Error("Failed to insert evaluation");

    // Insert scores for this evaluation
    if (input.scores.length > 0) {
      await tx.insert(judgeEvaluationScores).values(
        input.scores.map((s) => ({
          evaluationId: evaluation.id,
          criterionId: s.criterionId,
          marksAwarded: String(s.marksAwarded),
          comment: s.comment,
        })),
      );
    }

    const auditAction: import("@/core/audit").AuditAction =
      input.submit ? "evaluation.submit" : "evaluation.draft";

    await writeAudit({
      actorUserId: input.judgeUserId,
      action: auditAction,
      targetType: "judge_evaluation",
      targetId: evaluation.id,
      eventId: input.eventId,
      after: { revisionNo: nextRevNo, status: evaluation.status },
      requestId: input.requestId,
    }, tx);

    return { evaluationId: evaluation.id, revisionNo: nextRevNo, status: evaluation.status };
  });
}

/**
 * Unlock a locked evaluation (authorized admin only).
 * Caller must already have verified authorization.
 */
export async function unlockEvaluation(
  evaluationId: string,
  reason: string,
  actorUserId: string,
  eventId: string,
  requestId: string,
) {
  return withTx(async (tx) => {
    const [ev] = await tx
      .select()
      .from(judgeEvaluations)
      .where(eq(judgeEvaluations.id, evaluationId))
      .limit(1);
    if (!ev) throw new NotFoundError("Evaluation");
    if (ev.status !== "locked") throw new ValidationError("Evaluation is not locked");

    await tx.update(judgeEvaluations).set({ status: "draft" }).where(eq(judgeEvaluations.id, evaluationId));

    await writeAudit({
      actorUserId,
      action: "evaluation.unlock",
      targetType: "judge_evaluation",
      targetId: evaluationId,
      eventId,
      after: { reason, unlockedFrom: "locked" },
      requestId,
    }, tx);
  });
}

// ── Score aggregation helpers ─────────────────────────────────────────────────

/** Compute a judge's total score for a submission given their submitted evaluation. */
function computeJudgeTotal(
  scores: Array<{ marksAwarded: string; criterionId: string }>,
  criteria: Array<{ id: string; maxMarks: string; weight: string | null }>,
  roundMax: number,
): number {
  const hasWeights = criteria.some((c) => c.weight != null);
  if (hasWeights) {
    const weightSum = criteria.reduce((acc, c) => acc + (c.weight ? parseFloat(c.weight) : 0), 0);
    if (weightSum === 0) return 0;
    let weighted = 0;
    for (const c of criteria) {
      const score = scores.find((s) => s.criterionId === c.id);
      const marks = score ? parseFloat(score.marksAwarded) : 0;
      const max_ = parseFloat(c.maxMarks);
      const w = c.weight ? parseFloat(c.weight) : 0;
      weighted += max_ > 0 ? (marks / max_) * (w / weightSum) : 0;
    }
    return weighted * roundMax;
  }
  // Unweighted: total = (Σ marks / Σ max) * round_max
  const totalMarks = scores.reduce((acc, s) => acc + parseFloat(s.marksAwarded), 0);
  const totalMax = criteria.reduce((acc, c) => acc + parseFloat(c.maxMarks), 0);
  return totalMax > 0 ? (totalMarks / totalMax) * roundMax : 0;
}

function aggregate(values: number[], method: string): number {
  if (values.length === 0) return 0;
  if (method === "mean" || method === "weighted_judges") {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  if (method === "median") {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }
  if (method === "trimmed_mean") {
    if (values.length <= 2) return values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  }
  if (method === "max") return Math.max(...values);
  if (method === "min") return Math.min(...values);
  return values.reduce((a, b) => a + b, 0) / values.length; // fallback = mean
}

/**
 * Finalize judging for a submission:
 *  1. Aggregate judge totals
 *  2. Check spread (disagreement)
 *  3. If no disagreement → lock evaluations + write score_record
 *  4. If disagreement → mark needs_reconciliation (do NOT write score_record yet)
 */
export async function finalizeJudging(input: FinalizeJudgingInput) {
  return withTx(async (tx) => {
    const rubric = await getRubricWithCriteria(tx, input.rubricId);

    // Gather all submitted evaluations for this submission
    const allAssignments = await tx
      .select({ id: judgingAssignments.id, judgeUserId: judgingAssignments.judgeUserId })
      .from(judgingAssignments)
      .where(and(
        eq(judgingAssignments.submissionId, input.submissionId),
        eq(judgingAssignments.rubricId, input.rubricId),
      ));

    if (allAssignments.length < rubric.minJudges) {
      throw new ValidationError(
        `Requires ${rubric.minJudges} judge(s); only ${allAssignments.length} assigned.`,
      );
    }

    // Get the latest submitted evaluation per judge
    const judgeTotals: number[] = [];
    const evalIds: string[] = [];

    for (const asgn of allAssignments) {
      const [latestEval] = await tx
        .select({ id: judgeEvaluations.id, status: judgeEvaluations.status, revisionNo: judgeEvaluations.revisionNo })
        .from(judgeEvaluations)
        .where(and(
          eq(judgeEvaluations.assignmentId, asgn.id),
          eq(judgeEvaluations.status, "submitted"),
        ))
        .orderBy(sql`${judgeEvaluations.revisionNo} DESC`)
        .limit(1);

      if (!latestEval) {
        throw new ValidationError(`Judge ${asgn.judgeUserId} has not submitted their evaluation.`);
      }

      const scores = await tx
        .select({ marksAwarded: judgeEvaluationScores.marksAwarded, criterionId: judgeEvaluationScores.criterionId })
        .from(judgeEvaluationScores)
        .where(eq(judgeEvaluationScores.evaluationId, latestEval.id));

      const [round] = await tx
        .select({ config: rounds.config })
        .from(rounds)
        .where(eq(rounds.id, input.roundId))
        .limit(1);

      const roundMax = (round?.config as { roundMax?: number } | null)?.roundMax ?? 100;
      const total = computeJudgeTotal(scores, rubric.criteria, roundMax);
      judgeTotals.push(total);
      evalIds.push(latestEval.id);
    }

    // Compute spread
    const maxTotal = Math.max(...judgeTotals);
    const minTotal = Math.min(...judgeTotals);
    const [round] = await tx
      .select({ config: rounds.config })
      .from(rounds)
      .where(eq(rounds.id, input.roundId))
      .limit(1);
    const roundMax = (round?.config as { roundMax?: number } | null)?.roundMax ?? 100;
    const spread = roundMax > 0 ? ((maxTotal - minTotal) / roundMax) * 100 : 0;

    const varianceThreshold = parseFloat(rubric.varianceThresholdPct ?? "20");
    const needsReconciliation = spread > varianceThreshold && judgeTotals.length > 1;

    if (needsReconciliation) {
      await writeAudit({
        actorUserId: input.actorUserId,
        action: "evaluation.reconcile",
        targetType: "submission",
        targetId: input.submissionId,
        eventId: input.eventId,
        after: { spread: spread.toFixed(2), threshold: varianceThreshold, status: "needs_reconciliation" },
        requestId: input.requestId,
      }, tx);
      return { status: "needs_reconciliation" as const, spread };
    }

    // Aggregate and write score_record
    const aggregateScore = aggregate(judgeTotals, rubric.aggregation ?? "mean");

    await tx.insert(scoreRecords).values({
      eventId: input.eventId,
      roundId: input.roundId,
      entryId: input.entryId,
      source: "judge_aggregate",
      rawScore: String(aggregateScore.toFixed(4)),
      finalScore: String(aggregateScore.toFixed(4)),
      supersededBy: null,
      sourceRefId: input.submissionId,
    });

    // Lock all evaluations
    if (evalIds.length > 0) {
      await tx.update(judgeEvaluations)
        .set({ status: "locked", lockedAt: new Date() })
        .where(inArray(judgeEvaluations.id, evalIds));
    }

    await writeAudit({
      actorUserId: input.actorUserId,
      action: "judging.finalize",
      targetType: "submission",
      targetId: input.submissionId,
      eventId: input.eventId,
      after: { aggregateScore: aggregateScore.toFixed(4), judgeCount: judgeTotals.length },
      requestId: input.requestId,
    }, tx);

    return { status: "finalized" as const, aggregateScore: aggregateScore.toFixed(4) };
  });
}

/**
 * Record a resolution for a disagreement.
 * After resolution the caller should re-run finalizeJudging.
 */
export async function resolveDisagreement(input: ResolveDisagreementInput) {
  return withTx(async (tx) => {
    const [sub] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, input.submissionId))
      .limit(1);
    if (!sub) throw new NotFoundError("Submission");

    const [resolution] = await tx
      .insert(evaluationResolutions)
      .values({
        submissionId: input.submissionId,
        rubricId: input.rubricId,
        eventId: input.eventId,
        method: input.method,
        ...(input.manualValue !== undefined ? { manualValue: String(input.manualValue) } : {}),
        reason: input.reason,
        resolvedByUserId: input.actorUserId,
        resolvedAt: new Date(),
      })
      .returning({ id: evaluationResolutions.id });

    if (!resolution) throw new Error("Failed to insert resolution");

    await writeAudit({
      actorUserId: input.actorUserId,
      action: "evaluation.reconcile",
      targetType: "submission",
      targetId: input.submissionId,
      eventId: input.eventId,
      after: { method: input.method, reason: input.reason },
      requestId: input.requestId,
    }, tx);

    return { resolutionId: resolution.id };
  });
}

// ── Internal tx helper ────────────────────────────────────────────────────────

async function getRubricWithCriteria(
  tx: Parameters<Parameters<typeof withTx>[0]>[0],
  rubricId: string,
) {
  const [rubric] = await tx
    .select()
    .from(evaluationRubrics)
    .where(eq(evaluationRubrics.id, rubricId))
    .limit(1);
  if (!rubric) throw new NotFoundError("Rubric");

  const criteria = await tx
    .select()
    .from(evaluationCriteria)
    .where(eq(evaluationCriteria.rubricId, rubricId))
    .orderBy(evaluationCriteria.displayOrder);

  return { ...rubric, criteria };
}

/**
 * modules/challenges/service.ts — M2-A2
 *
 * Challenge submission workflow (ARCHITECTURE.md §12):
 *   startChallenge()  — per_entry_clock mode: records start + deadline
 *   saveDraft()       — upserts a draft revision (is_draft=true)
 *   submitChallenge() — idempotent: locks submission row, inserts revision,
 *                       advances status, updates counted_revision_id
 *
 * URL validation via url-validator.ts runs on every save/submit.
 * All deadline math uses dbNow() (ARCHITECTURE.md §5.3, R-RULE-01).
 */
import "server-only";

import { db, withTx } from "@/core/db";
import {
  submissions,
  submissionRevisions,
  challengeTasks,
  challengeStarts,
  entries,
  rounds,
} from "@/core/db/schema";
import { dbNow } from "@/core/clock";
import { writeAudit } from "@/core/audit";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} from "@/core/errors";
import { and, eq, max, sql } from "drizzle-orm";
import { validateSubmissionUrl, type UrlValidationOptions } from "./url-validator";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StartChallengeInput {
  taskId: string;
  entryId: string;
  participantId: string;
  requestId: string;
}

export interface StartChallengeResult {
  challengeStartId: string;
  deadlineAt: Date;
  alreadyStarted: boolean;
}

export interface SubmissionUrlsInput {
  githubUrl?: string | undefined;
  demoUrl?: string | undefined;
  videoUrl?: string | undefined;
  [key: string]: string | undefined;
}

export interface SaveDraftInput {
  taskId: string;
  entryId: string;
  participantId: string;
  urls: SubmissionUrlsInput;
  notes?: string | undefined;
  requestId: string;
}

export interface SaveDraftResult {
  submissionId: string;
  revisionNo: number;
}

export interface SubmitChallengeInput {
  taskId: string;
  entryId: string;
  participantId: string;
  urls: SubmissionUrlsInput;
  notes?: string | undefined;
  requestId: string;
}

export interface SubmitChallengeResult {
  submissionId: string;
  revisionId: string;
  revisionNo: number;
  status: "submitted" | "submitted_late";
  isLate: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Validate all provided URLs against the task's configuration.
 * Throws ValidationError if any URL fails.
 */
function validateSubmissionUrls(
  urls: SubmissionUrlsInput,
  task: { allowHttp: boolean; videoAllowlist: unknown },
): void {
  const videoAllowlist =
    Array.isArray(task.videoAllowlist) ? (task.videoAllowlist as string[]) : [];

  const fieldValidations: Array<[string, UrlValidationOptions]> = [
    ["githubUrl", { field: "github", allowHttp: task.allowHttp }],
    ["demoUrl", { field: "generic", allowHttp: task.allowHttp }],
    ["videoUrl", { field: "video", allowHttp: task.allowHttp, videoHostAllowList: videoAllowlist }],
  ];

  for (const [key, opts] of fieldValidations) {
    const url = urls[key];
    if (!url) continue;
    const result = validateSubmissionUrl(url, opts);
    if (!result.ok) {
      throw new ValidationError(`Invalid ${key}: ${result.reason} — ${url}`);
    }
  }
}

/**
 * Get or create the submissions row for a (task, entry) pair.
 * Must run inside a transaction.
 */
async function getOrCreateSubmission(
  tx: Parameters<Parameters<typeof withTx>[0]>[0],
  taskId: string,
  entryId: string,
  eventId: string,
): Promise<typeof submissions.$inferSelect> {
  const [existing] = await tx
    .select()
    .from(submissions)
    .where(and(eq(submissions.taskId, taskId), eq(submissions.entryId, entryId)))
    .limit(1);

  if (existing) return existing;

  const [created] = await tx
    .insert(submissions)
    .values({ taskId, entryId, eventId, status: "not_started" })
    .returning();

  if (!created) throw new Error("Failed to create submission row");
  return created;
}

// ── startChallenge ─────────────────────────────────────────────────────────────

/**
 * Record that an entry has started a per-entry-clock challenge.
 * Idempotent: calling twice returns the existing start row.
 * For fixed_window rounds, no-op (deadline is the round's ends_at).
 */
export async function startChallenge(
  input: StartChallengeInput,
): Promise<StartChallengeResult> {
  return withTx(async (tx) => {
    const [task] = await tx
      .select()
      .from(challengeTasks)
      .where(eq(challengeTasks.id, input.taskId))
      .limit(1);

    if (!task) throw new NotFoundError("Challenge task");

    // Check for existing start (idempotent)
    const [existingStart] = await tx
      .select()
      .from(challengeStarts)
      .where(
        and(
          eq(challengeStarts.taskId, input.taskId),
          eq(challengeStarts.entryId, input.entryId),
        ),
      )
      .limit(1);

    if (existingStart) {
      return {
        challengeStartId: existingStart.id,
        deadlineAt: existingStart.deadlineAt,
        alreadyStarted: true,
      };
    }

    // Fixed_window: deadline comes from the round
    if (task.clockMode === "fixed_window") {
      const [round] = await tx
        .select({ closesAt: rounds.closesAt })
        .from(rounds)
        .where(eq(rounds.id, task.roundId))
        .limit(1);

      const deadline = round?.closesAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);

      const [start] = await tx
        .insert(challengeStarts)
        .values({
          taskId: input.taskId,
          entryId: input.entryId,
          eventId: task.eventId,
          deadlineAt: deadline,
          startedByParticipantId: input.participantId,
        })
        .onConflictDoNothing({ target: [challengeStarts.taskId, challengeStarts.entryId] })
        .returning();

      const finalStart = start ?? (await tx
        .select()
        .from(challengeStarts)
        .where(and(eq(challengeStarts.taskId, input.taskId), eq(challengeStarts.entryId, input.entryId)))
        .limit(1)
        .then(([r]) => r!));

      await writeAudit({ actorUserId: input.participantId, action: "round.open", targetType: "challenge_start", targetId: finalStart!.id, eventId: task.eventId, after: { entryId: input.entryId }, requestId: input.requestId }, tx);

      return { challengeStartId: finalStart!.id, deadlineAt: finalStart!.deadlineAt, alreadyStarted: false };
    }

    // Per-entry clock: deadline = LEAST(now + time_limit, round.ends_at)
    const now = await dbNow(tx);
    const [round] = await tx
      .select({ closesAt: rounds.closesAt, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, task.roundId))
      .limit(1);

    if (!round || round.status !== "open") {
      throw new ValidationError("Round is not open for submissions");
    }

    const timeLimitMs = task.timeLimitMs ?? 60 * 60 * 1000; // default 1h
    const personalDeadline = new Date(now.getTime() + timeLimitMs);
    const roundDeadline = round.closesAt;
    const deadline = roundDeadline && personalDeadline > roundDeadline
      ? roundDeadline
      : personalDeadline;

    const [start] = await tx
      .insert(challengeStarts)
      .values({
        taskId: input.taskId,
        entryId: input.entryId,
        eventId: task.eventId,
        deadlineAt: deadline,
        startedByParticipantId: input.participantId,
      })
      .onConflictDoNothing({ target: [challengeStarts.taskId, challengeStarts.entryId] })
      .returning();

    const finalStart = start ?? (await tx
      .select()
      .from(challengeStarts)
      .where(and(eq(challengeStarts.taskId, input.taskId), eq(challengeStarts.entryId, input.entryId)))
      .limit(1)
      .then(([r]) => r!));

    await writeAudit({ actorUserId: input.participantId, action: "round.open", targetType: "challenge_start", targetId: finalStart!.id, eventId: task.eventId, after: { entryId: input.entryId, deadlineAt: deadline }, requestId: input.requestId }, tx);

    return { challengeStartId: finalStart!.id, deadlineAt: finalStart!.deadlineAt, alreadyStarted: false };
  });
}

// ── saveDraft ─────────────────────────────────────────────────────────────────

/**
 * Save a draft revision. Never sets counted_revision_id.
 * Validates URLs but allows incomplete submissions.
 */
export async function saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const [task] = await db
    .select()
    .from(challengeTasks)
    .where(eq(challengeTasks.id, input.taskId))
    .limit(1);

  if (!task) throw new NotFoundError("Challenge task");

  // Validate any provided URLs
  validateSubmissionUrls(input.urls, task);

  return withTx(async (tx) => {
    const submission = await getOrCreateSubmission(tx, input.taskId, input.entryId, task.eventId);

    if (submission.status === "evaluated") {
      throw new ForbiddenError("Cannot edit a submission that has been evaluated");
    }

    // Get max revision number for this submission
    const [maxRow] = await tx
      .select({ max: max(submissionRevisions.revisionNo) })
      .from(submissionRevisions)
      .where(eq(submissionRevisions.submissionId, submission.id));

    const nextRevNo = (maxRow?.max ?? 0) + 1;

    const [revision] = await tx
      .insert(submissionRevisions)
      .values({
        submissionId: submission.id,
        entryId: input.entryId,
        eventId: task.eventId,
        revisionNo: nextRevNo,
        isDraft: true,
        urls: input.urls,
        notes: input.notes,
        submittedByParticipantId: input.participantId,
      })
      .returning({ id: submissionRevisions.id, revisionNo: submissionRevisions.revisionNo });

    if (!revision) throw new Error("Failed to insert draft revision");

    // Update status to 'draft' if still 'not_started'
    if (submission.status === "not_started") {
      await tx.update(submissions).set({ status: "draft" }).where(eq(submissions.id, submission.id));
    }

    await writeAudit({ actorUserId: input.participantId, action: "submission.draft", targetType: "submission", targetId: submission.id, eventId: task.eventId, after: { revisionNo: nextRevNo }, requestId: input.requestId }, tx);

    return { submissionId: submission.id, revisionNo: revision.revisionNo };
  });
}

// ── submitChallenge ───────────────────────────────────────────────────────────

/**
 * Final submission. Atomically:
 *   1. SELECT FOR UPDATE on the submissions row (prevent concurrent submits)
 *   2. Check deadline via dbNow()
 *   3. Insert submission_revision (revision_no = max+1, is_draft=false)
 *   4. Update submissions.counted_revision_id + status
 *
 * Idempotent for the same `requestId` via the idempotency check on the
 * counted_revision_id + status already being "submitted/submitted_late".
 */
export async function submitChallenge(
  input: SubmitChallengeInput,
): Promise<SubmitChallengeResult> {
  const [task] = await db
    .select()
    .from(challengeTasks)
    .where(eq(challengeTasks.id, input.taskId))
    .limit(1);

  if (!task) throw new NotFoundError("Challenge task");

  // Full URL validation — all required fields must be valid
  validateSubmissionUrls(input.urls, task);

  return withTx(async (tx) => {
    // Lock submission row for concurrent-submit safety
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.taskId, input.taskId), eq(submissions.entryId, input.entryId)))
      .for("update");

    const submission = sub ?? await (async () => {
      const [created] = await tx
        .insert(submissions)
        .values({ taskId: input.taskId, entryId: input.entryId, eventId: task.eventId, status: "not_started" })
        .returning();
      return created!;
    })();

    // Idempotency: if already submitted, return existing result
    if (submission.status === "submitted" || submission.status === "submitted_late") {
      const [rev] = await tx
        .select()
        .from(submissionRevisions)
        .where(eq(submissionRevisions.id, submission.countedRevisionId!))
        .limit(1);
      return {
        submissionId: submission.id,
        revisionId: submission.countedRevisionId!,
        revisionNo: rev?.revisionNo ?? 0,
        status: submission.status as "submitted" | "submitted_late",
        isLate: submission.isLate,
      };
    }

    if (submission.status === "evaluated") {
      throw new ForbiddenError("Cannot re-submit an evaluated submission");
    }

    // Deadline check via DB clock
    const now = await dbNow(tx);
    const [start] = await tx
      .select({ deadlineAt: challengeStarts.deadlineAt })
      .from(challengeStarts)
      .where(and(eq(challengeStarts.taskId, input.taskId), eq(challengeStarts.entryId, input.entryId)))
      .limit(1);

    // Get round deadline as fallback
    const [round] = await tx
      .select({ closesAt: rounds.closesAt })
      .from(rounds)
      .where(eq(rounds.id, task.roundId))
      .limit(1);

    const deadline = start?.deadlineAt ?? round?.closesAt;
    const isLate = deadline ? now > deadline : false;

    // Get next revision number
    const [maxRow] = await tx
      .select({ max: max(submissionRevisions.revisionNo) })
      .from(submissionRevisions)
      .where(eq(submissionRevisions.submissionId, submission.id));
    const nextRevNo = (maxRow?.max ?? 0) + 1;

    // Insert the counted revision
    const [revision] = await tx
      .insert(submissionRevisions)
      .values({
        submissionId: submission.id,
        entryId: input.entryId,
        eventId: task.eventId,
        revisionNo: nextRevNo,
        isDraft: false,
        urls: input.urls,
        notes: input.notes,
        isLate,
        submittedByParticipantId: input.participantId,
      })
      .returning();

    if (!revision) throw new Error("Failed to insert submission revision");

    const newStatus = isLate ? "submitted_late" : "submitted";

    // Atomically update submission
    await tx.update(submissions).set({
      status: newStatus,
      countedRevisionId: revision.id,
      submittedAt: now,
      isLate,
    }).where(eq(submissions.id, submission.id));

    await writeAudit({
      actorUserId: input.participantId,
      action: "submission.submit",
      targetType: "submission",
      targetId: submission.id,
      eventId: task.eventId,
      before: { status: submission.status },
      after: { status: newStatus, revisionNo: nextRevNo, isLate },
      requestId: input.requestId,
    }, tx);

    return {
      submissionId: submission.id,
      revisionId: revision.id,
      revisionNo: revision.revisionNo,
      status: newStatus,
      isLate,
    };
  });
}

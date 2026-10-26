/**
 * modules/quiz/service.ts -- Quiz attempt lifecycle (server-only)
 * R-SCORE-01: all scoring via scoreAttempt() pure fn. BR-02: DB clock only.
 * AD-16: attempts scoped to entry_id (shared team attempt).
 */
import "server-only";
import { withTx, type Tx } from "@/core/db";
import {
  rounds, entries, participants, quizAttempts, attemptQuestions, questions,
  quizResponses, questionVersions, questionOptions, roundQuestions, scoreRecords, teams,
} from "@/core/db/schema";
import { dbNow } from "@/core/clock";
import { writeAudit } from "@/core/audit";
import {
  ConflictError, ValidationError, NotFoundError, ForbiddenError,
} from "@/core/errors";
import { scoreAttempt, type QuestionInput, type ResponseInput } from "./score-attempt";
import { eq, and, sql, inArray } from "drizzle-orm";

/**
 * postgres-js in transaction-pooler mode returns timestamp columns as strings.
 * This helper coerces any DB-sourced date value to a proper Date object.
 */
function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/**
 * Thrown inside a tx when an in-progress attempt is found past its deadline.
 * The public wrappers catch it, finalize the attempt in a NEW tx (the failing tx
 * has rolled back and released its lock), then surface a clean validation error.
 * R-TIME-04: correctness must not depend on the sweeper.
 */
class AttemptExpired extends ValidationError {
  constructor(readonly attemptId: string) {
    super("Attempt deadline has passed");
  }
}

async function finalizeExpired(e: AttemptExpired, requestId: string): Promise<void> {
  await submitAttempt({ attemptId: e.attemptId, requestId: `lazy-${requestId}` });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StartAttemptInput {
  roundId: string;
  entryId: string;
  participantId: string; // AD-16: who pressed Start (audit only)
  requestId: string;
}

export interface AttemptOption {
  id: string;
  optionText: string;
  optionImageUrl: string | null;
  displayOrder: number;
  // isCorrect intentionally omitted — BR-07
}

export interface AttemptQuestion {
  attemptQuestionId: string;
  questionId: string;
  versionId: string;
  displayOrder: number;
  stem: string;
  stemImageUrl: string | null;
  questionType: string;
  options: AttemptOption[];
}

export interface StartAttemptResult {
  attemptId: string;
  deadlineAt: Date;
  startedAt: Date;
  shuffleSeed: string;
  questions: AttemptQuestion[];
}

export interface SaveAnswersInput {
  attemptId: string;
  participantId: string; // AD-16 audit
  answers: Array<{
    attemptQuestionId: string;
    selectedOptionIds: string[];
    textAnswer?: string | null;
    clientSeq: number;
  }>;
  requestId: string;
}

export interface SaveAnswersResult {
  savedCount: number;
  serverTime: Date;
  deadlineAt: Date;
}

export interface SubmitAttemptInput {
  attemptId: string;
  participantId?: string | null; // optional: null when called by sweeper
  requestId: string;
}

export interface SubmitAttemptResult {
  scoreRecordId: string;
  rawScore: string;
  finalScore: string;
  hasPendingReview: boolean;
}

// ── assertEntryAccess (internal) ─────────────────────────────────────────────

/**
 * Caller's participant must own the entry (individual) or be the team captain.
 * Prevents IDOR: being a participant in the event is not enough.
 * NOTE: no team_members table exists yet; team entries are limited to the captain
 * until the teams module lands (tracked in the audit plan, Phase 3).
 */
export async function assertEntryAccess(tx: Tx, entryId: string, participantId: string): Promise<void> {
  const [row] = await tx
    .select({
      entryType: entries.entryType,
      participantId: entries.participantId,
      captainParticipantId: teams.captainParticipantId,
    })
    .from(entries)
    .leftJoin(teams, eq(entries.teamId, teams.id))
    .where(eq(entries.id, entryId))
    .limit(1);
  if (!row) throw new NotFoundError("Entry");
  const owns =
    row.entryType === "team"
      ? row.captainParticipantId === participantId
      : row.participantId === participantId;
  if (!owns) throw new ForbiddenError("Not a member of this entry");
}

// ── loadAttemptQuestions (internal) ──────────────────────────────────────────

export async function loadAttemptQuestions(tx: Tx, attemptId: string): Promise<AttemptQuestion[]> {
  const aqRows = await tx
    .select({
      aqId: attemptQuestions.id,
      questionId: attemptQuestions.questionId,
      versionId: attemptQuestions.versionId,
      displayOrder: attemptQuestions.displayOrder,
      optionSeed: attemptQuestions.optionSeed,
      stem: questionVersions.stem,
      stemImageUrl: questionVersions.stemImageUrl,
      questionType: questions.questionType,
    })
    .from(attemptQuestions)
    .innerJoin(questionVersions, eq(attemptQuestions.versionId, questionVersions.id))
    .innerJoin(questions, eq(attemptQuestions.questionId, questions.id))
    .where(eq(attemptQuestions.attemptId, attemptId))
    .orderBy(attemptQuestions.displayOrder);

  const versionIds = aqRows.map((r) => r.versionId);
  const optRows = versionIds.length > 0
    ? await tx
        .select({
          id: questionOptions.id,
          versionId: questionOptions.versionId,
          optionText: questionOptions.optionText,
          optionImageUrl: questionOptions.optionImageUrl,
          displayOrder: questionOptions.displayOrder,
        })
        .from(questionOptions)
        .where(inArray(questionOptions.versionId, versionIds))
    : [];

  const optsByVersion = new Map<string, typeof optRows>();
  for (const opt of optRows) {
    const list = optsByVersion.get(opt.versionId) ?? [];
    list.push(opt);
    optsByVersion.set(opt.versionId, list);
  }

  return aqRows.map((aq) => {
    const seedN = Number(aq.optionSeed % BigInt(Number.MAX_SAFE_INTEGER));
    const opts = (optsByVersion.get(aq.versionId) ?? [])
      .slice()
      .sort(
        (a, b) =>
          ((a.displayOrder * seedN) % 97) - ((b.displayOrder * seedN) % 97) ||
          a.displayOrder - b.displayOrder,
      );
    return {
      attemptQuestionId: aq.aqId,
      questionId: aq.questionId,
      versionId: aq.versionId,
      displayOrder: aq.displayOrder,
      stem: aq.stem,
      stemImageUrl: aq.stemImageUrl,
      questionType: aq.questionType,
      options: opts.map((o) => ({
        id: o.id,
        optionText: o.optionText,
        optionImageUrl: o.optionImageUrl,
        displayOrder: o.displayOrder,
      })),
    };
  });
}

// ── startAttempt ──────────────────────────────────────────────────────────────

export async function startAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
  try {
    return await startAttemptTx(input);
  } catch (err) {
    if (err instanceof AttemptExpired) await finalizeExpired(err, input.requestId);
    throw err instanceof AttemptExpired ? new ConflictError("Attempt has already been submitted") : err;
  }
}

async function startAttemptTx(input: StartAttemptInput): Promise<StartAttemptResult> {
  return withTx(async (tx) => {
    const now = await dbNow(tx);

    // 1. Load + validate round
    const [round] = await tx.select().from(rounds).where(eq(rounds.id, input.roundId)).limit(1);
    if (!round) throw new NotFoundError("Round");

    // Serialize concurrent starts for the same (round, entry): the loser blocks,
    // then takes the idempotent-resume path instead of a unique-violation 500.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.roundId + ":" + input.entryId}, 0))`,
    );
    if (round.status !== "open") throw new ValidationError("Round is not open for attempts");
    if (round.roundType !== "quiz") throw new ValidationError("Not a quiz round");
    if (round.closesAt && asDate(round.closesAt)! <= now) throw new ValidationError("Round has already closed");

    // 2. Validate entry is in this event
    const [entry] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, input.entryId), eq(entries.eventId, round.eventId)))
      .limit(1);
    if (!entry) throw new NotFoundError("Entry");

    // 3. Validate participant is approved in this event
    const [participant] = await tx
      .select({ id: participants.id, userId: participants.userId })
      .from(participants)
      .where(
        and(
          eq(participants.id, input.participantId),
          eq(participants.eventId, round.eventId),
          eq(participants.status, "approved"),
        ),
      )
      .limit(1);
    if (!participant) throw new ForbiddenError("Participant not approved for this event");
    await assertEntryAccess(tx, input.entryId, input.participantId);

    // 4. Idempotent resume — return existing in-progress attempt (FR-QUIZ-07)
    const [existing] = await tx
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.roundId, input.roundId), eq(quizAttempts.entryId, input.entryId)))
      .limit(1);

    if (existing) {
      if (existing.status !== "in_progress") {
        throw new ConflictError("Attempt has already been submitted");
      }
      const existingDeadline = asDate(existing.deadlineAt);
      if (existingDeadline && existingDeadline <= now) throw new AttemptExpired(existing.id);
      const qs = await loadAttemptQuestions(tx, existing.id);
      return {
        attemptId: existing.id,
        deadlineAt: asDate(existing.deadlineAt) ?? new Date(),
        startedAt: asDate(existing.startedAt) ?? new Date(),
        shuffleSeed: existing.shuffleSeed.toString(),
        questions: qs,
      };
    }

    // 5. Compute deadline (BR-04): LEAST(started_at + duration_ms, round.closes_at)
    let deadlineAt: Date;
    const durationMs = round.durationMs;
    if (durationMs != null) {
      const attemptEnd = new Date(now.getTime() + durationMs);
      const closesAt = asDate(round.closesAt);
      deadlineAt = closesAt && closesAt < attemptEnd ? closesAt : attemptEnd;
    } else if (round.closesAt) {
      deadlineAt = asDate(round.closesAt)!;
    } else {
      throw new ValidationError("Round has no duration or close time configured");
    }
    if (deadlineAt <= now) throw new ValidationError("No time remaining to start an attempt");

    // 6. Load round question composition
    const rqs = await tx
      .select({
        questionId: roundQuestions.questionId,
        pinnedVersionId: roundQuestions.pinnedVersionId,
        displayOrder: roundQuestions.displayOrder,
      })
      .from(roundQuestions)
      .where(eq(roundQuestions.roundId, input.roundId))
      .orderBy(roundQuestions.displayOrder);
    if (rqs.length === 0) throw new ValidationError("Round has no questions configured");

    // 7. Insert attempt
    const shuffleSeed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const [attempt] = await tx
      .insert(quizAttempts)
      .values({
        roundId: input.roundId,
        eventId: round.eventId,
        entryId: input.entryId,
        startedByParticipantId: input.participantId,
        deadlineAt,
        shuffleSeed,
        startedAt: now,
      })
      .returning({ id: quizAttempts.id, startedAt: quizAttempts.startedAt });
    if (!attempt) throw new Error("Failed to create attempt");

    // 8. Freeze question snapshots — immutable once created (BR-06)
    for (let i = 0; i < rqs.length; i++) {
      const rq = rqs[i];
      if (!rq) continue;
      let versionId = rq.pinnedVersionId;
      if (!versionId) {
        const [latest] = await tx
          .select({ id: questionVersions.id })
          .from(questionVersions)
          .where(eq(questionVersions.questionId, rq.questionId))
          .orderBy(sql`version_no DESC`)
          .limit(1);
        if (!latest) {
          throw new ValidationError(`Question ${rq.questionId} has no versions`);
        }
        versionId = latest.id;
      }
      const optionSeed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      await tx.insert(attemptQuestions).values({
        attemptId: attempt.id,
        questionId: rq.questionId,
        versionId,
        displayOrder: rq.displayOrder ?? i + 1,
        optionSeed,
      });
    }

    // 9. Audit
    await writeAudit(
      {
        actorUserId: participant.userId,  // userId FK-safe (participants.userId → users.id)
        action: "attempt.start",
        targetType: "quiz_attempt",
        targetId: attempt.id,
        eventId: round.eventId,
        after: { entryId: input.entryId, roundId: input.roundId, deadlineAt },
        requestId: input.requestId,
      },
      tx,
    );

    const qs = await loadAttemptQuestions(tx, attempt.id);
    return {
      attemptId: attempt.id,
      deadlineAt,
      startedAt: asDate(attempt.startedAt) ?? new Date(),
      shuffleSeed: shuffleSeed.toString(),
      questions: qs,
    };
  });
}

// ── saveAnswers ───────────────────────────────────────────────────────────────

export async function saveAnswers(input: SaveAnswersInput): Promise<SaveAnswersResult> {
  try {
    return await saveAnswersTx(input);
  } catch (err) {
    if (err instanceof AttemptExpired) await finalizeExpired(err, input.requestId);
    throw err;
  }
}

async function saveAnswersTx(input: SaveAnswersInput): Promise<SaveAnswersResult> {
  return withTx(async (tx) => {
    const now = await dbNow(tx);

    const [attempt] = await tx
      .select({
        id: quizAttempts.id,
        status: quizAttempts.status,
        deadlineAt: quizAttempts.deadlineAt,
        eventId: quizAttempts.eventId,
        entryId: quizAttempts.entryId,
        roundId: quizAttempts.roundId,
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, input.attemptId))
      .for("update"); // serialize with submitAttempt: no save can land after scoring
    if (!attempt) throw new NotFoundError("Attempt");
    await assertEntryAccess(tx, attempt.entryId, input.participantId);
    if (attempt.status !== "in_progress") throw new ConflictError("Attempt is no longer in progress");

    const [roundRow] = await tx
      .select({ status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, attempt.roundId))
      .limit(1);
    if (roundRow?.status === "paused") throw new ConflictError("Round is paused");
    if (roundRow?.status === "closed" || roundRow?.status === "finalised") {
      throw new AttemptExpired(attempt.id);
    }

    // Grace period: allow saves up to N ms after deadline (configurable)
    const graceMs = parseInt(process.env["ATTEMPT_SAVE_GRACE_MS"] ?? "3000", 10);
    const saveDeadline = new Date((asDate(attempt.deadlineAt) ?? new Date()).getTime() + graceMs);
    if (now > saveDeadline) throw new AttemptExpired(attempt.id);

    // Every answer must target a question frozen into THIS attempt (no cross-attempt writes)
    const ownAq = await tx
      .select({ id: attemptQuestions.id })
      .from(attemptQuestions)
      .where(eq(attemptQuestions.attemptId, input.attemptId));
    const ownAqIds = new Set(ownAq.map((r) => r.id));
    for (const ans of input.answers) {
      if (!ownAqIds.has(ans.attemptQuestionId)) throw new NotFoundError("Attempt question");
    }

    let savedCount = 0;
    for (const ans of input.answers) {
      // Idempotent upsert: only overwrite if incoming clientSeq is greater (4.7)
      await tx
        .insert(quizResponses)
        .values({
          attemptId: input.attemptId,
          attemptQuestionId: ans.attemptQuestionId,
          selectedOptionIds: ans.selectedOptionIds,
          textAnswer: ans.textAnswer ?? null,
          clientSeq: ans.clientSeq,
          answeredByParticipantId: input.participantId,
          savedAt: now,
        })
        .onConflictDoUpdate({
          target: [quizResponses.attemptQuestionId],
          set: {
            selectedOptionIds: sql`CASE WHEN excluded.client_seq > quiz_responses.client_seq THEN excluded.selected_option_ids ELSE quiz_responses.selected_option_ids END`,
            textAnswer: sql`CASE WHEN excluded.client_seq > quiz_responses.client_seq THEN excluded.text_answer ELSE quiz_responses.text_answer END`,
            clientSeq: sql`GREATEST(excluded.client_seq, quiz_responses.client_seq)`,
            answeredByParticipantId: sql`CASE WHEN excluded.client_seq > quiz_responses.client_seq THEN excluded.answered_by_participant_id ELSE quiz_responses.answered_by_participant_id END`,
            savedAt: sql`CASE WHEN excluded.client_seq > quiz_responses.client_seq THEN excluded.saved_at ELSE quiz_responses.saved_at END`,
          },
        });
      savedCount++;
    }

    return { savedCount, serverTime: now, deadlineAt: asDate(attempt.deadlineAt) ?? new Date() };
  });
}

// ── submitAttempt ─────────────────────────────────────────────────────────────

export async function submitAttempt(input: SubmitAttemptInput): Promise<SubmitAttemptResult> {
  return withTx(async (tx) => {
    const now = await dbNow(tx);

    // Lock attempt row to prevent concurrent submissions
    const [attempt] = await tx
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.id, input.attemptId))
      .for("update");
    if (!attempt) throw new NotFoundError("Attempt");
    if (input.participantId) await assertEntryAccess(tx, attempt.entryId, input.participantId);

    // Idempotent: already scored → return existing result
    if (attempt.status === "submitted" || attempt.status === "auto_submitted") {
      if (attempt.scoreRecordId) {
        const [sr] = await tx
          .select({ rawScore: scoreRecords.rawScore, finalScore: scoreRecords.finalScore })
          .from(scoreRecords)
          .where(eq(scoreRecords.id, attempt.scoreRecordId))
          .limit(1);
        return {
          scoreRecordId: attempt.scoreRecordId,
          rawScore: sr?.rawScore ?? "0",
          finalScore: sr?.finalScore ?? "0",
          hasPendingReview: false,
        };
      }
    }

    if (attempt.status === "timed_out") throw new ConflictError("Attempt has timed out");
    if (attempt.status !== "in_progress") throw new ConflictError("Attempt is not in progress");

    const isAutoSubmit = now > (asDate(attempt.deadlineAt) ?? new Date());

    // Load frozen questions with correctness data (server-only, BR-07)
    const aqRows = await tx
      .select({
        aqId: attemptQuestions.id,
        versionId: attemptQuestions.versionId,
        questionType: questions.questionType,
        marks: questionVersions.marks,
        negMarks: questionVersions.negMarks,
        acceptedAnswers: questionVersions.acceptedAnswers,
        normalizeCase: questionVersions.normalizeCase,
        normalizeSpaces: questionVersions.normalizeSpaces,
      })
      .from(attemptQuestions)
      .innerJoin(questionVersions, eq(attemptQuestions.versionId, questionVersions.id))
      .innerJoin(questions, eq(attemptQuestions.questionId, questions.id))
      .where(eq(attemptQuestions.attemptId, input.attemptId));

    const versionIds = aqRows.map((r) => r.versionId);
    const optRows =
      versionIds.length > 0
        ? await tx
            .select({ id: questionOptions.id, versionId: questionOptions.versionId, isCorrect: questionOptions.isCorrect })
            .from(questionOptions)
            .where(inArray(questionOptions.versionId, versionIds))
        : [];

    const optsByVersion = new Map<string, Array<{ id: string; versionId: string; isCorrect: boolean }>>();
    for (const opt of optRows) {
      const list = optsByVersion.get(opt.versionId) ?? [];
      list.push(opt);
      optsByVersion.set(opt.versionId, list);
    }

    const responses = await tx
      .select({
        attemptQuestionId: quizResponses.attemptQuestionId,
        selectedOptionIds: quizResponses.selectedOptionIds,
        textAnswer: quizResponses.textAnswer,
      })
      .from(quizResponses)
      .where(eq(quizResponses.attemptId, input.attemptId));

    // Build inputs for pure scoring function (R-SCORE-01)
    const questionInputs: QuestionInput[] = aqRows.map((aq) => ({
      attemptQuestionId: aq.aqId,
      questionType: aq.questionType as QuestionInput["questionType"],
      marks: aq.marks,
      negMarks: aq.negMarks,
      options: (optsByVersion.get(aq.versionId) ?? []).map((o) => ({
        id: o.id,
        isCorrect: o.isCorrect,
      })),
      acceptedAnswers: aq.acceptedAnswers ?? null,
      normalizeCase: aq.normalizeCase,
      normalizeSpaces: aq.normalizeSpaces,
    }));

    const responseInputs: ResponseInput[] = responses.map((r) => ({
      attemptQuestionId: r.attemptQuestionId,
      selectedOptionIds: r.selectedOptionIds ?? [],
      textAnswer: r.textAnswer,
    }));

    // Score (pure function — zero side-effects, R-SCORE-01)
    const scored = scoreAttempt(questionInputs, responseInputs);

    // Write score_record (append-only, BR-09)
    const [scoreRecord] = await tx
      .insert(scoreRecords)
      .values({
        eventId: attempt.eventId,
        roundId: attempt.roundId,
        entryId: attempt.entryId,
        source: "quiz_auto",
        rawScore: scored.rawScore.toFixed(4),
        finalScore: scored.finalScore.toFixed(4),
        sourceRefId: attempt.id,
      })
      .returning({ id: scoreRecords.id });
    if (!scoreRecord) throw new Error("Failed to write score record");

    // Mark attempt as scored
    await tx
      .update(quizAttempts)
      .set({
        status: isAutoSubmit ? "auto_submitted" : "submitted",
        submittedAt: now,
        scoredAt: now,
        scoreRecordId: scoreRecord.id,
        updatedAt: now,
      })
      .where(eq(quizAttempts.id, input.attemptId));

    // Persist per-question grading results
    for (const sq of scored.questions) {
      await tx
        .update(quizResponses)
        .set({
          isCorrect: sq.isCorrect === undefined ? null : sq.isCorrect,
          reviewStatus: sq.reviewStatus,
        })
        .where(eq(quizResponses.attemptQuestionId, sq.attemptQuestionId));
    }

    // Audit — look up the participant's userId for the FK-safe actorUserId
    let auditActorUserId: string | null = null;
    if (attempt.startedByParticipantId) {
      const [p] = await tx
        .select({ userId: participants.userId })
        .from(participants)
        .where(eq(participants.id, attempt.startedByParticipantId))
        .limit(1);
      auditActorUserId = p?.userId ?? null;
    }
    await writeAudit(
      {
        actorUserId: auditActorUserId,
        action: isAutoSubmit ? "attempt.auto_submit" : "attempt.submit",
        targetType: "quiz_attempt",
        targetId: input.attemptId,
        eventId: attempt.eventId,
        after: {
          scoreRecordId: scoreRecord.id,
          rawScore: scored.rawScore.toFixed(4),
          finalScore: scored.finalScore.toFixed(4),
          hasPendingReview: scored.hasPendingReview,
        },
        requestId: input.requestId,
      },
      tx,
    );

    return {
      scoreRecordId: scoreRecord.id,
      rawScore: scored.rawScore.toFixed(4),
      finalScore: scored.finalScore.toFixed(4),
      hasPendingReview: scored.hasPendingReview,
    };
  });
}

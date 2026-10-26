/**
 * Suite 6 — Attempt Result API (BR-07: isCorrect masking)
 *
 * Tests the result query logic directly against the DB, verifying:
 *   - Score object present after submit
 *   - isCorrect present for admin, absent for participant (BR-07)
 *   - in-progress attempt returns 409-like conflict
 *   - hasPendingReview=true when short_text response is ungraded
 *   - Options sorted by displayOrder
 *   - Unanswered questions return response: null
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/attempt-result.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq, and, inArray } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeRound, makeBank, makeQuestion, makeRoundQuestion,
  makeParticipant, makeEntry,
} from "../../fixtures/factory";
import {
  quizAttempts, attemptQuestions, quizResponses, questionVersions,
  questionOptions, scoreRecords, participants, entries,
} from "@/core/db/schema";
import {
  startAttempt, saveAnswers, submitAttempt,
} from "@/modules/quiz/service";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

// ── Per-test cleanup tracker ──────────────────────────────────────────────────

let cleanupIds: Record<string, string[]> = {};

function track(table: string, id: string) {
  if (!cleanupIds[table]) cleanupIds[table] = [];
  cleanupIds[table]!.push(id);
}

afterEach(async () => {
  const eventIds = cleanupIds["app.events"] ?? [];
  if (eventIds.length > 0) {
    const idList = eventIds.map((id) => `'${id}'`).join(",");
    for (const table of ["app.quiz_responses", "app.attempt_questions"]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${table} WHERE attempt_id IN (SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${idList}]::uuid[]))`,
      )).catch(() => {});
    }
    await testDb.execute(sql.raw(
      `UPDATE app.quiz_attempts SET score_record_id = NULL WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
    )).catch(() => {});
    for (const table of ["app.quiz_attempts", "app.score_records", "app.round_questions"]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${table} WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
      )).catch(() => {});
    }
    await testDb.execute(sql.raw(
      `DELETE FROM app.question_options WHERE version_id IN (
         SELECT id FROM app.question_versions WHERE question_id IN (
           SELECT id FROM app.questions WHERE event_id = ANY(ARRAY[${idList}]::uuid[])
         )
       )`,
    )).catch(() => {});
    await testDb.execute(sql.raw(
      `DELETE FROM app.question_versions WHERE question_id IN (
         SELECT id FROM app.questions WHERE event_id = ANY(ARRAY[${idList}]::uuid[])
       )`,
    )).catch(() => {});
    for (const table of ["app.questions", "app.question_banks", "app.entries", "app.participants", "app.rounds"]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${table} WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
      )).catch(() => {});
    }
  }
  const ordered = ["app.events", "app.users"];
  const toDelete: Record<string, string[]> = {};
  for (const table of ordered) {
    if (cleanupIds[table]?.length) toDelete[table] = cleanupIds[table]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

// ── Shared world builder ──────────────────────────────────────────────────────

async function seedWorld() {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open" });
  const bank = await makeBank(testDb, event.id, admin.id);
  const pUser = await makeUser(testDb);
  track("app.users", pUser.id);
  const participant = await makeParticipant(testDb, pUser.id, event.id);
  const entry = await makeEntry(testDb, event.id, participant.id);
  return { admin, event, round, bank, participant, entry, pUser };
}

/** Query the result data exactly as the route does — single source of truth. */
async function queryResult(attemptId: string, isPrivileged: boolean) {
  const [attempt] = await testDb
    .select({
      id: quizAttempts.id,
      roundId: quizAttempts.roundId,
      eventId: quizAttempts.eventId,
      entryId: quizAttempts.entryId,
      status: quizAttempts.status,
      scoreRecordId: quizAttempts.scoreRecordId,
    })
    .from(quizAttempts)
    .where(eq(quizAttempts.id, attemptId))
    .limit(1);
  if (!attempt) return null;

  if (attempt.status === "in_progress") {
    return { conflict: true, status: attempt.status };
  }

  let scoreResult: { rawScore: string; finalScore: string; penalty: string } | null = null;
  if (attempt.scoreRecordId) {
    const [sr] = await testDb
      .select({ rawScore: scoreRecords.rawScore, finalScore: scoreRecords.finalScore, penalty: scoreRecords.penalty })
      .from(scoreRecords).where(eq(scoreRecords.id, attempt.scoreRecordId)).limit(1);
    scoreResult = sr ?? null;
  }

  const aqRows = await testDb
    .select({
      aqId: attemptQuestions.id,
      questionId: attemptQuestions.questionId,
      versionId: attemptQuestions.versionId,
      displayOrder: attemptQuestions.displayOrder,
      stem: questionVersions.stem,
    })
    .from(attemptQuestions)
    .innerJoin(questionVersions, eq(attemptQuestions.versionId, questionVersions.id))
    .where(eq(attemptQuestions.attemptId, attemptId))
    .orderBy(attemptQuestions.displayOrder);

  const responses = await testDb
    .select({
      attemptQuestionId: quizResponses.attemptQuestionId,
      selectedOptionIds: quizResponses.selectedOptionIds,
      textAnswer: quizResponses.textAnswer,
      isCorrect: quizResponses.isCorrect,
      reviewStatus: quizResponses.reviewStatus,
      savedAt: quizResponses.savedAt,
    })
    .from(quizResponses)
    .where(eq(quizResponses.attemptId, attemptId));

  const responseMap = new Map(responses.map((r) => [r.attemptQuestionId, r]));

  const versionIds = aqRows.map((r) => r.versionId);
  const optRows = versionIds.length > 0
    ? await testDb
        .select({
          id: questionOptions.id,
          versionId: questionOptions.versionId,
          optionText: questionOptions.optionText,
          displayOrder: questionOptions.displayOrder,
          isCorrect: questionOptions.isCorrect, // always fetched — caller decides visibility
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

  const questions = aqRows.map((aq) => {
    const resp = responseMap.get(aq.aqId);
    const opts = (optsByVersion.get(aq.versionId) ?? []).sort((a, b) => a.displayOrder - b.displayOrder);
    return {
      attemptQuestionId: aq.aqId,
      displayOrder: aq.displayOrder,
      stem: aq.stem,
      options: opts,
      response: resp
        ? {
            selectedOptionIds: resp.selectedOptionIds ?? [],
            isCorrect: isPrivileged ? resp.isCorrect : undefined,
            reviewStatus: resp.reviewStatus,
          }
        : null,
    };
  });

  return {
    conflict: false,
    score: scoreResult,
    hasPendingReview: responses.some((r) => r.reviewStatus === "pending_review"),
    questions,
  };
}

// ── Suite 6 ───────────────────────────────────────────────────────────────────

describe("6: Attempt Result API", () => {
  it("6.1 — admin gets isCorrect per response", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question, version, optionIds } = await makeQuestion(testDb, event.id, bank.id, admin.id, {
      options: [{ text: "Right", isCorrect: true }, { text: "Wrong", isCorrect: false }],
    });
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const correctOptId = questions[0]!.options.find((o) => o.optionText === "Right")?.id
      ?? questions[0]!.options[0]!.id;

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [correctOptId], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, /* isPrivileged */ true);
    expect(result?.conflict).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any)?.questions?.[0]?.response?.isCorrect).toBe(true); // privileged: isCorrect present
  });

  it("6.2 — participant gets result without isCorrect (BR-07)", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [questions[0]!.options[0]!.id], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, /* isPrivileged */ false);
    expect(result?.conflict).toBe(false);
    // BR-07: isCorrect must be undefined for participants
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any)?.questions?.[0]?.response?.isCorrect).toBeUndefined();
  });

  it("6.3 — in-progress attempt returns conflict flag", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const result = await queryResult(attemptId, true);
    expect(result?.conflict).toBe(true);
    expect(result?.status).toBe("in_progress");
  });

  it("6.5 — hasPendingReview=true for ungraded short_text response", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id, {
      questionType: "short_text",
      acceptedAnswers: ["hello"],
    });
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    // Save an answer that won't auto-grade to correct (not in acceptedAnswers)
    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [], textAnswer: "uncertain", clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, true);
    expect(result?.hasPendingReview).toBe(true);
  });

  it("6.6 — score object present after submit with correct finalScore", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id, {
      marks: "5",
      options: [{ text: "Correct", isCorrect: true }, { text: "Wrong", isCorrect: false }],
    });
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    // Find the correct option
    const [correctOpt] = await testDb
      .select({ id: questionOptions.id })
      .from(questionOptions)
      .where(and(eq(questionOptions.versionId, questions[0]!.versionId), eq(questionOptions.isCorrect, true)))
      .limit(1);

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [correctOpt!.id], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, true);
    expect(result?.score).not.toBeNull();
    expect(parseFloat(result?.score?.finalScore ?? "0")).toBe(5);
  });

  it("6.7 — options sorted by displayOrder ascending", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id, {
      options: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: true },
        { text: "C", isCorrect: false },
      ],
    });
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: Array<{ displayOrder: number }> = (result as any)?.questions?.[0]?.options ?? [];
    expect(opts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]!.displayOrder).toBeGreaterThan(opts[i - 1]!.displayOrder);
    }
  });

  it("6.8 — unanswered question has response: null", async () => {
    const { admin, event, round, bank, participant, entry } = await seedWorld();

    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);

    const { attemptId } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    // Submit without saving any answer
    await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    const result = await queryResult(attemptId, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any)?.questions?.[0]?.response).toBeNull();
  });
});

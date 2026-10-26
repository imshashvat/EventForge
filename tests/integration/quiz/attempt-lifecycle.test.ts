/**
 * tests/integration/quiz/attempt-lifecycle.test.ts — Suite 4
 *
 * Uses COMMITTED seed data (not withTestTx) because startAttempt/saveAnswers/
 * submitAttempt open their own internal withTx() calls, which cannot read
 * uncommitted rows from an outer test transaction.
 *
 * Each test commits its seed, runs the service, then cleans up in afterEach
 * via deleteIds() (leaf → root FK order).
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/attempt-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeRoleAssignment, makeParticipant,
  makeEntry, makeRound, makeBank, makeQuestion, makeRoundQuestion,
} from "../../fixtures/factory";
import {
  startAttempt, saveAnswers, submitAttempt,
} from "@/modules/quiz/service";
import {
  quizAttempts, quizResponses, scoreRecords, questionOptions,
} from "@/core/db/schema";
import Decimal from "decimal.js";
import { assertScore } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await verifyDb();
});

afterAll(async () => {
  await closeDb();
});

// Collect IDs committed during each test for cleanup
let cleanupIds: Record<string, string[]> = {};
const track = (table: string, id: string) => {
  cleanupIds[table] ??= [];
  cleanupIds[table]!.push(id);
};

afterEach(async () => {
  // Clean up by event_id — avoids FK/trigger issues with individually tracked IDs.
  // Deletes all child rows for our test events, then the events themselves.
  const eventIds = cleanupIds["app.events"] ?? [];
  if (eventIds.length > 0) {
    const idList = eventIds.map((id) => `'${id}'`).join(",");
    // Leaf tables first (referencing event_id or cascade-reachable)
    for (const table of [
      "app.quiz_responses",
      "app.attempt_questions",
    ]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${table} WHERE attempt_id IN (
           SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${idList}]::uuid[])
         )`,
      )).catch(() => {/* best-effort */});
    }
    // Break circular FK: quiz_attempts.score_record_id → score_records
    await testDb.execute(sql.raw(
      `UPDATE app.quiz_attempts SET score_record_id = NULL WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
    )).catch(() => {});
    for (const table of [
      "app.quiz_attempts",
      "app.score_records",
      "app.round_questions",
    ]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${table} WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
      )).catch(() => {});
    }
  }

  // Now delete question_options before question_versions (FK)
  if (cleanupIds["app.question_versions"]?.length) {
    const vList = cleanupIds["app.question_versions"]!.map((id) => `'${id}'`).join(",");
    await testDb.execute(sql.raw(
      `DELETE FROM app.question_options WHERE version_id = ANY(ARRAY[${vList}]::uuid[])`,
    )).catch(() => {});
  }

  // Remaining rows in FK order
  const ordered = [
    "app.question_options",
    "app.question_versions",
    "app.questions",
    "app.question_banks",
    "app.entries",
    "app.participants",
    "app.role_assignments",
    "app.rounds",
    "app.events",
    "app.users",
  ];
  const toDelete: Record<string, string[]> = {};
  for (const table of ordered) {
    if (cleanupIds[table]?.length) toDelete[table] = cleanupIds[table]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

// Helper: seed a minimal world and track all IDs for cleanup
async function seedWorld(overrides: { roundStatus?: string; durationMs?: number } = {}) {
  const admin = await makeUser(testDb, { displayName: "Admin" });
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, {
    status: overrides.roundStatus ?? "open",
    durationMs: overrides.durationMs ?? 30 * 60 * 1000,
  });
  track("app.rounds", round.id);
  const bank = await makeBank(testDb, event.id, admin.id);
  track("app.question_banks", bank.id);

  const pUser = await makeUser(testDb, { displayName: "Player" });
  track("app.users", pUser.id);
  const p = await makeParticipant(testDb, pUser.id, event.id);
  track("app.participants", p.id);
  const entry = await makeEntry(testDb, event.id, p.id);
  track("app.entries", entry.id);

  return { admin, event, round, bank, participant: p, entry };
}

async function addQuestion(
  eventId: string,
  bankId: string,
  adminId: string,
  roundId: string,
  spec: Parameters<typeof makeQuestion>[4] = {},
  displayOrder = 1,
) {
  const { question, version, optionIds } = await makeQuestion(testDb, eventId, bankId, adminId, spec);
  track("app.questions", question.id);
  track("app.question_versions", version.id);
  for (const optId of optionIds) track("app.question_options", optId);
  const rq = await makeRoundQuestion(testDb, roundId, eventId, question.id, displayOrder);
  track("app.round_questions", rq.id);
  return { question, version, rq };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4A — startAttempt
// ─────────────────────────────────────────────────────────────────────────────

describe("4A: startAttempt", () => {
  it("4A.1 — happy path: returns attemptId, status=in_progress, valid deadlineAt", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const result = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", result.attemptId);

    expect(result.attemptId).toBeDefined();
    expect(result.deadlineAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.questions.length).toBe(1);

    const [row] = await testDb
      .select({ status: quizAttempts.status })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, result.attemptId));
    expect(row?.status).toBe("in_progress");
  });

  it("4A.2 — idempotent: second startAttempt for same entry returns same attemptId", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const input = { roundId: round.id, entryId: entry.id, participantId: participant.id, requestId: crypto.randomUUID() };
    const r1 = await startAttempt(input);
    track("app.quiz_attempts", r1.attemptId);
    const r2 = await startAttempt({ ...input, requestId: crypto.randomUUID() });

    expect(r1.attemptId).toBe(r2.attemptId);

    const rows = await testDb
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.roundId, round.id), eq(quizAttempts.entryId, entry.id)));
    expect(rows.length).toBe(1);
  });

  it("4A.3 — round not open → throws error", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld({ roundStatus: "closed" });
    await addQuestion(event.id, bank.id, admin.id, round.id);

    await expect(startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    })).rejects.toThrow();
  });

  it("4A.5 — attempt_questions count equals round composition count", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    for (let i = 0; i < 3; i++) {
      await addQuestion(event.id, bank.id, admin.id, round.id, { stem: `Q${i}` }, i + 1);
    }

    const result = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", result.attemptId);

    expect(result.questions.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4B — saveAnswers
// ─────────────────────────────────────────────────────────────────────────────

describe("4B: saveAnswers", () => {
  it("4B.1 — saves answer, upserts on second save with higher clientSeq", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const aqId = questions[0]!.attemptQuestionId;
    const firstOptId = questions[0]!.options[0]!.id;
    const secondOptId = questions[0]!.options[1]?.id ?? firstOptId;

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: aqId, selectedOptionIds: [firstOptId], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    const [resp] = await testDb
      .select({ clientSeq: quizResponses.clientSeq })
      .from(quizResponses)
      .where(eq(quizResponses.attemptQuestionId, aqId));
    expect(resp?.clientSeq).toBe(1);

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: aqId, selectedOptionIds: [secondOptId], clientSeq: 2 }],
      requestId: crypto.randomUUID(),
    });

    const [resp2] = await testDb
      .select({ clientSeq: quizResponses.clientSeq })
      .from(quizResponses)
      .where(eq(quizResponses.attemptQuestionId, aqId));
    expect(resp2?.clientSeq).toBe(2);
  });

  it("4B.2 — lower clientSeq is discarded (idempotent)", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const aqId = questions[0]!.attemptQuestionId;
    const optA = questions[0]!.options[0]!.id;
    const optB = questions[0]!.options[1]?.id ?? optA;
    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: aqId, selectedOptionIds: [optA], clientSeq: 5 }],
      requestId: crypto.randomUUID(),
    });
    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: aqId, selectedOptionIds: [optB], clientSeq: 3 }],
      requestId: crypto.randomUUID(),
    });

    const [resp] = await testDb
      .select({ clientSeq: quizResponses.clientSeq })
      .from(quizResponses)
      .where(eq(quizResponses.attemptQuestionId, aqId));
    expect(resp?.clientSeq).toBe(5); // unchanged
  });

  it("4B.4 — save after deadline rejects", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    // Manually expire the deadline — set far enough back to exceed grace period (3s)
    await testDb.update(quizAttempts)
      .set({ deadlineAt: new Date(Date.now() - 30_000) })
      .where(eq(quizAttempts.id, attemptId));

    await expect(
      saveAnswers({
        attemptId, participantId: participant.id,
        answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [], clientSeq: 1 }],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4C — submitAttempt
// ─────────────────────────────────────────────────────────────────────────────

describe("4C: submitAttempt", () => {
  it("4C.1 — happy path: submit → submitted, score_record created", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id, {
      marks: "2", negMarks: "0",
      options: [{ text: "4", isCorrect: true }, { text: "5", isCorrect: false }],
    });

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const correctOpt = questions[0]!.options.find((o) => o.optionText === "4") ?? questions[0]!.options[0]!;
    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [correctOpt.id], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    const result = await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });
    if (result.scoreRecordId) track("app.score_records", result.scoreRecordId);

    expect(result.scoreRecordId).toBeDefined();
    assertScore(result.rawScore, "2");
    assertScore(result.finalScore, "2");
    expect(result.hasPendingReview).toBe(false);

    const [row] = await testDb
      .select({ status: quizAttempts.status })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attemptId));
    expect(row?.status).toBe("submitted");
  });

  it("4C.2 — idempotent: re-submit returns same scoreRecordId, no duplicate score_record", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id);

    const { attemptId } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const r1 = await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });
    if (r1.scoreRecordId) track("app.score_records", r1.scoreRecordId);
    const r2 = await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });

    expect(r1.scoreRecordId).toBe(r2.scoreRecordId);

    const rows = await testDb
      .select({ id: scoreRecords.id })
      .from(scoreRecords)
      .where(eq(scoreRecords.sourceRefId, attemptId));
    expect(rows.length).toBe(1);
  });

  it("4C.5 — 1.5+1.5=3.0 via Decimal.js, exact precision", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    for (let i = 0; i < 2; i++) {
      await addQuestion(event.id, bank.id, admin.id, round.id, {
        stem: `Q${i}`, marks: "1.5", negMarks: "0",
        options: [{ text: "Correct", isCorrect: true }, { text: "Wrong", isCorrect: false }],
      }, i + 1);
    }

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    // Look up the correct option ID for each question from the DB
    const answers = await Promise.all(questions.map(async (q, i) => {
      const [correctOpt] = await testDb
        .select({ id: questionOptions.id })
        .from(questionOptions)
        .where(and(eq(questionOptions.versionId, q.versionId), eq(questionOptions.isCorrect, true)))
        .limit(1);
      return {
        attemptQuestionId: q.attemptQuestionId,
        selectedOptionIds: correctOpt ? [correctOpt.id] : [q.options[0]!.id],
        clientSeq: i + 1,
      };
    }));

    await saveAnswers({
      attemptId, participantId: participant.id,
      answers,
      requestId: crypto.randomUUID(),
    });

    const result = await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });
    if (result.scoreRecordId) track("app.score_records", result.scoreRecordId);

    expect(new Decimal(result.finalScore).equals(new Decimal("3"))).toBe(true);
  });

  it("4C.6 — neg_marks deducted for wrong answer", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQuestion(event.id, bank.id, admin.id, round.id, {
      marks: "1", negMarks: "0.25",
      options: [{ text: "Right", isCorrect: true }, { text: "Wrong", isCorrect: false }],
    });

    const { attemptId, questions } = await startAttempt({
      roundId: round.id, entryId: entry.id, participantId: participant.id,
      requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", attemptId);

    const wrongOpt = questions[0]!.options.find((o) => o.optionText === "Wrong") ?? questions[0]!.options[1]!;
    await saveAnswers({
      attemptId, participantId: participant.id,
      answers: [{ attemptQuestionId: questions[0]!.attemptQuestionId, selectedOptionIds: [wrongOpt.id], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    const result = await submitAttempt({ attemptId, participantId: participant.id, requestId: crypto.randomUUID() });
    if (result.scoreRecordId) track("app.score_records", result.scoreRecordId);

    assertScore(result.rawScore, "-0.25");
  });
});

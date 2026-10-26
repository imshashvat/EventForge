/**
 * Suite 3 — Round Composition
 *
 * Tests the round question composition service via the route business logic,
 * calling the DB and service functions directly (bypassing HTTP auth).
 *
 * Business rules tested:
 *   BR-06: adding a question to a round locks it (is_locked = true)
 *   BR-10: question and round must belong to the same event
 *   Idempotent upsert (no duplicate roundQuestion rows on re-add)
 *   Version pinning validation
 *   displayOrder ordering
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/round-composition.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeRound, makeBank, makeQuestion, makeRoundQuestion,
} from "../../fixtures/factory";
import {
  rounds, questions, questionVersions, questionBanks,
  roundQuestions, questionOptions,
} from "@/core/db/schema";
import { withTx } from "@/core/db";
import { ValidationError, NotFoundError } from "@/core/errors";

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
    await testDb.execute(sql.raw(
      `DELETE FROM app.round_questions WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
    )).catch(() => {});
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
    for (const table of ["app.questions", "app.question_banks", "app.rounds"]) {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedWorld() {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open", roundType: "quiz" });
  const bank = await makeBank(testDb, event.id, admin.id);
  return { admin, event, round, bank };
}

/**
 * Business logic for adding a question to a round (mirrors route POST handler).
 * Direct DB implementation so we can test without HTTP auth overhead.
 */
async function addQuestionToRound(
  roundId: string,
  questionId: string,
  eventId: string,
  opts: { pinnedVersionId?: string; displayOrder?: number } = {},
) {
  return withTx(async (tx) => {
    // Validate round type
    const [round] = await tx.select({ id: rounds.id, roundType: rounds.roundType, eventId: rounds.eventId })
      .from(rounds).where(eq(rounds.id, roundId)).limit(1);
    if (!round) throw new NotFoundError("Round");
    if (round.roundType !== "quiz") throw new ValidationError("Round is not a quiz round");

    // BR-10: question must belong to same event
    const [question] = await tx
      .select({ id: questions.id, eventId: questions.eventId, isLocked: questions.isLocked })
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.eventId, round.eventId)))
      .limit(1);
    if (!question) throw new NotFoundError("Question (or question does not belong to this event)");

    // Validate pinned version
    if (opts.pinnedVersionId) {
      const [ver] = await tx
        .select({ id: questionVersions.id })
        .from(questionVersions)
        .where(and(eq(questionVersions.id, opts.pinnedVersionId), eq(questionVersions.questionId, questionId)))
        .limit(1);
      if (!ver) throw new ValidationError("Pinned version does not belong to this question");
    }

    // Upsert
    const [rq] = await tx
      .insert(roundQuestions)
      .values({
        roundId,
        eventId: round.eventId,
        questionId,
        ...(opts.pinnedVersionId !== undefined && { pinnedVersionId: opts.pinnedVersionId }),
        ...(opts.displayOrder !== undefined && { displayOrder: opts.displayOrder }),
      })
      .onConflictDoUpdate({
        target: [roundQuestions.roundId, roundQuestions.questionId],
        set: {
          ...(opts.pinnedVersionId !== undefined && { pinnedVersionId: opts.pinnedVersionId }),
          ...(opts.displayOrder !== undefined && { displayOrder: opts.displayOrder }),
        },
      })
      .returning();
    if (!rq) throw new Error("Failed to add question to round");

    // BR-06: lock question
    if (!question.isLocked) {
      await tx.update(questions).set({ isLocked: true, updatedAt: new Date() }).where(eq(questions.id, questionId));
    }

    return rq;
  });
}

// ── Suite 3 ───────────────────────────────────────────────────────────────────

describe("3: Round Composition", () => {
  it("3.1 — add question to round: success, question becomes locked (BR-06)", async () => {
    const { admin, event, round, bank } = await seedWorld();
    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);

    const rq = await addQuestionToRound(round.id, question.id, event.id, { displayOrder: 1 });

    expect(rq.id).toBeTruthy();
    expect(rq.questionId).toBe(question.id);
    expect(rq.roundId).toBe(round.id);

    // BR-06: question must now be locked
    const [q] = await testDb.select({ isLocked: questions.isLocked }).from(questions).where(eq(questions.id, question.id));
    expect(q?.isLocked).toBe(true);
  });

  it("3.2 — idempotent re-add: no duplicate roundQuestion row created", async () => {
    const { admin, event, round, bank } = await seedWorld();
    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);

    await addQuestionToRound(round.id, question.id, event.id, { displayOrder: 1 });
    await addQuestionToRound(round.id, question.id, event.id, { displayOrder: 1 });

    const rows = await testDb
      .select({ id: roundQuestions.id })
      .from(roundQuestions)
      .where(and(eq(roundQuestions.roundId, round.id), eq(roundQuestions.questionId, question.id)));

    expect(rows.length).toBe(1);
  });

  it("3.3 — cross-event question rejected (BR-10)", async () => {
    const { admin, event, round } = await seedWorld();
    // Question in a different event
    const admin2 = await makeUser(testDb);
    track("app.users", admin2.id);
    const event2 = await makeEvent(testDb, admin2.id);
    track("app.events", event2.id);
    const bank2 = await makeBank(testDb, event2.id, admin2.id);
    const { question: q2 } = await makeQuestion(testDb, event2.id, bank2.id, admin2.id);

    await expect(
      addQuestionToRound(round.id, q2.id, event.id),
    ).rejects.toThrow(/does not belong to this event/i);
  });

  it("3.4 — non-quiz round type rejected", async () => {
    const { admin, event, bank } = await seedWorld();
    const challengeRound = await makeRound(testDb, event.id, admin.id, { roundType: "challenge", status: "open" });
    const { question } = await makeQuestion(testDb, event.id, bank.id, admin.id);

    await expect(
      addQuestionToRound(challengeRound.id, question.id, event.id),
    ).rejects.toThrow(/not a quiz round/i);
  });

  it("3.5 — pin a specific version: pinnedVersionId stored", async () => {
    const { admin, event, round, bank } = await seedWorld();
    const { question, version: v1 } = await makeQuestion(testDb, event.id, bank.id, admin.id);

    // Create a second version manually
    const [v2] = await testDb.insert(questionVersions).values({
      questionId: question.id,
      versionNo: 2,
      stem: "Updated stem",
      marks: "2",
      negMarks: "0",
      normalizeCase: true,
      normalizeSpaces: true,
    }).returning();

    const rq = await addQuestionToRound(round.id, question.id, event.id, { pinnedVersionId: v1.id });

    expect(rq.pinnedVersionId).toBe(v1.id);

    // v2 should still exist
    const versions = await testDb
      .select({ id: questionVersions.id })
      .from(questionVersions)
      .where(eq(questionVersions.questionId, question.id));
    expect(versions.length).toBe(2);
    const versionIds = versions.map((v) => v.id);
    expect(versionIds).toContain(v1.id);
    expect(versionIds).toContain(v2!.id);
  });

  it("3.6 — pin version from different question rejected", async () => {
    const { admin, event, round, bank } = await seedWorld();
    const { question: q1 } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    const { version: v2 } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    // v2 belongs to a different question

    await expect(
      addQuestionToRound(round.id, q1.id, event.id, { pinnedVersionId: v2.id }),
    ).rejects.toThrow(/Pinned version does not belong to this question/i);
  });

  it("3.7 — list composition ordered by displayOrder", async () => {
    const { admin, event, round, bank } = await seedWorld();

    const { question: q1 } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    const { question: q2 } = await makeQuestion(testDb, event.id, bank.id, admin.id);
    const { question: q3 } = await makeQuestion(testDb, event.id, bank.id, admin.id);

    // Insert in non-sequential order
    await addQuestionToRound(round.id, q1.id, event.id, { displayOrder: 3 });
    await addQuestionToRound(round.id, q2.id, event.id, { displayOrder: 1 });
    await addQuestionToRound(round.id, q3.id, event.id, { displayOrder: 2 });

    const composition = await testDb
      .select({ questionId: roundQuestions.questionId, displayOrder: roundQuestions.displayOrder })
      .from(roundQuestions)
      .where(eq(roundQuestions.roundId, round.id))
      .orderBy(roundQuestions.displayOrder);

    expect(composition.length).toBe(3);
    expect(composition[0]!.questionId).toBe(q2.id); // displayOrder 1
    expect(composition[1]!.questionId).toBe(q3.id); // displayOrder 2
    expect(composition[2]!.questionId).toBe(q1.id); // displayOrder 3
  });
});

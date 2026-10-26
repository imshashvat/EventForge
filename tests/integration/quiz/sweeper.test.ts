/**
 * tests/integration/quiz/sweeper.test.ts — Suite 5
 *
 * Uses committed seed data (not withTestTx) because runSweeper opens its
 * own internal transactions and cannot read uncommitted rows.
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/sweeper.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeRound, makeBank, makeQuestion,
  makeRoundQuestion, makeParticipant, makeEntry, makeAttempt,
  makeAttemptQuestion,
} from "../../fixtures/factory";
import { runSweeper } from "@/modules/quiz/jobs/sweeper";
import { quizAttempts } from "@/core/db/schema";
import { eq } from "drizzle-orm";

beforeAll(verifyDb);
afterAll(closeDb);

let cleanupIds: Record<string, string[]> = {};
const track = (table: string, id: string) => {
  cleanupIds[table] ??= [];
  cleanupIds[table]!.push(id);
};

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
  }
  if (cleanupIds["app.question_versions"]?.length) {
    const vList = cleanupIds["app.question_versions"]!.map((id) => `'${id}'`).join(",");
    await testDb.execute(sql.raw(
      `DELETE FROM app.question_options WHERE version_id = ANY(ARRAY[${vList}]::uuid[])`,
    )).catch(() => {});
  }
  const ordered = [
    "app.question_options", "app.question_versions", "app.questions",
    "app.question_banks", "app.entries", "app.participants",
    "app.rounds", "app.events", "app.users",
  ];
  const toDelete: Record<string, string[]> = {};
  for (const table of ordered) {
    if (cleanupIds[table]?.length) toDelete[table] = cleanupIds[table]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

async function seedWorld() {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open" });
  track("app.rounds", round.id);
  const bank = await makeBank(testDb, event.id, admin.id);
  track("app.question_banks", bank.id);
  const { question, version, optionIds } = await makeQuestion(testDb, event.id, bank.id, admin.id);
  track("app.questions", question.id);
  track("app.question_versions", version.id);
  for (const optId of optionIds) track("app.question_options", optId);
  const rq = await makeRoundQuestion(testDb, round.id, event.id, question.id, 1);
  track("app.round_questions", rq.id);
  const pUser = await makeUser(testDb);
  track("app.users", pUser.id);
  const p = await makeParticipant(testDb, pUser.id, event.id);
  track("app.participants", p.id);
  const entry = await makeEntry(testDb, event.id, p.id);
  track("app.entries", entry.id);
  return { admin, event, round, question, version, entry };
}

describe("5: Auto-submit sweeper", () => {
  it("5.1 — finds and submits a stale in_progress attempt", async () => {
    const { event, round, question, version, entry } = await seedWorld();

    const attempt = await makeAttempt(testDb, round.id, event.id, entry.id, {
      deadlineAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    track("app.quiz_attempts", attempt.id);
    const aq = await makeAttemptQuestion(testDb, attempt.id, question.id, version.id, 1);
    track("app.attempt_questions", aq.id);

    const result = await runSweeper({ eventId: event.id }, "test-job-1");

    expect(result.swept).toBeGreaterThanOrEqual(1);

    const [row] = await testDb
      .select({ status: quizAttempts.status })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attempt.id));
    expect(["submitted", "auto_submitted"]).toContain(row?.status);
  });

  it("5.2 — ignores fresh attempt (deadline in future)", async () => {
    const { event, round, question, version, entry } = await seedWorld();

    const attempt = await makeAttempt(testDb, round.id, event.id, entry.id, {
      deadlineAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    track("app.quiz_attempts", attempt.id);
    const aq = await makeAttemptQuestion(testDb, attempt.id, question.id, version.id, 1);
    track("app.attempt_questions", aq.id);

    await runSweeper({ eventId: event.id }, "test-job-2");

    const [row] = await testDb
      .select({ status: quizAttempts.status })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attempt.id));
    expect(row?.status).toBe("in_progress");
  });

  it("5.3 — ignores already-submitted attempts", async () => {
    const { event, round, question, version, entry } = await seedWorld();

    const attempt = await makeAttempt(testDb, round.id, event.id, entry.id, {
      deadlineAt: new Date(Date.now() - 60_000),
      status: "submitted",
      submittedAt: new Date(),
    });
    track("app.quiz_attempts", attempt.id);

    await runSweeper({ eventId: event.id }, "test-job-3");

    const [row] = await testDb
      .select({ status: quizAttempts.status })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attempt.id));
    expect(row?.status).toBe("submitted");
  });
});

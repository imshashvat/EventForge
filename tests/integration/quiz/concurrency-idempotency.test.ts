/**
 * tests/integration/quiz/concurrency-idempotency.test.ts — M1-F3, F4, F5
 *
 * F3: Advisory lock idempotency — calling startAttempt() twice for the same
 *     entry+round returns the SAME attemptId, not a duplicate row.
 *
 * F4: clientSeq dedup — saveAnswers() with a lower clientSeq than what's
 *     already stored must NOT overwrite the stored answer (GREATEST() guard).
 *
 * F5: Double-submit idempotency — calling submitAttempt() twice returns the
 *     same scoreRecordId and does NOT create duplicate score_records rows.
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/concurrency-idempotency.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq, and, count } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeParticipant, makeEntry,
  makeRound, makeBank, makeQuestion, makeRoundQuestion,
} from "../../fixtures/factory";
import {
  startAttempt, saveAnswers, submitAttempt,
} from "@/modules/quiz/service";
import {
  quizAttempts, quizResponses, scoreRecords,
} from "@/core/db/schema";

// ── Infrastructure ─────────────────────────────────────────────────────────────

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

let cleanupIds: Record<string, string[]> = {};
const track = (table: string, id: string) => {
  cleanupIds[table] ??= [];
  cleanupIds[table]!.push(id);
};

afterEach(async () => {
  const eventIds = cleanupIds["app.events"] ?? [];
  if (eventIds.length > 0) {
    const idList = eventIds.map((id) => `'${id}'`).join(",");
    for (const t of ["app.quiz_responses", "app.attempt_questions"]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${t} WHERE attempt_id IN (
           SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${idList}]::uuid[])
         )`,
      )).catch(() => {});
    }
    await testDb.execute(sql.raw(
      `UPDATE app.quiz_attempts SET score_record_id = NULL WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
    )).catch(() => {});
    for (const t of ["app.quiz_attempts", "app.score_records", "app.round_questions"]) {
      await testDb.execute(sql.raw(
        `DELETE FROM ${t} WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
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
    "app.role_assignments", "app.rounds", "app.events", "app.users",
  ];
  const toDelete: Record<string, string[]> = {};
  for (const t of ordered) {
    if (cleanupIds[t]?.length) toDelete[t] = cleanupIds[t]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

// ── Seed helper ────────────────────────────────────────────────────────────────

async function seedWorld() {
  const admin = await makeUser(testDb, { displayName: "Admin-CI" });
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open", durationMs: 30 * 60 * 1000 });
  track("app.rounds", round.id);
  const bank = await makeBank(testDb, event.id, admin.id);
  track("app.question_banks", bank.id);
  const pUser = await makeUser(testDb, { displayName: "Player-CI" });
  track("app.users", pUser.id);
  const p = await makeParticipant(testDb, pUser.id, event.id);
  track("app.participants", p.id);
  const entry = await makeEntry(testDb, event.id, p.id);
  track("app.entries", entry.id);
  return { admin, event, round, bank, participant: p, entry };
}

async function addQ(eventId: string, bankId: string, adminId: string, roundId: string, displayOrder = 1) {
  const { question, version, optionIds } = await makeQuestion(testDb, eventId, bankId, adminId);
  track("app.questions", question.id);
  track("app.question_versions", version.id);
  for (const o of optionIds) track("app.question_options", o);
  const rq = await makeRoundQuestion(testDb, roundId, eventId, question.id, displayOrder);
  track("app.round_questions", rq.id);
  return { question, version, rq, optionIds };
}

// ── F3: Advisory lock / double startAttempt ────────────────────────────────────

describe("M1-F3: startAttempt idempotency (advisory lock)", () => {
  it("F3.1 — two concurrent startAttempt calls return the same attemptId", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQ(event.id, bank.id, admin.id, round.id);

    const input = {
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    };

    // Fire both concurrently
    const [r1, r2] = await Promise.all([
      startAttempt(input),
      startAttempt({ ...input, requestId: crypto.randomUUID() }),
    ]);

    expect(r1.attemptId).toBe(r2.attemptId);

    // Only ONE row in quiz_attempts for this entry+round
    const rows = await testDb
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(and(
        eq(quizAttempts.roundId, round.id),
        eq(quizAttempts.entryId, entry.id),
      ));
    expect(rows).toHaveLength(1);
  });

  it("F3.2 — sequential startAttempt resumes the existing in_progress attempt", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQ(event.id, bank.id, admin.id, round.id);

    const input = {
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    };

    const r1 = await startAttempt(input);
    const r2 = await startAttempt({ ...input, requestId: crypto.randomUUID() });

    // Same attempt resumed — same id and questions
    expect(r1.attemptId).toBe(r2.attemptId);
    expect(r1.questions.length).toBe(r2.questions.length);
  });
});

// ── F4: clientSeq dedup in saveAnswers ────────────────────────────────────────

describe("M1-F4: clientSeq dedup (saveAnswers GREATEST() guard)", () => {
  it("F4.1 — stale clientSeq does NOT overwrite a later-sequenced answer", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    const { optionIds } = await addQ(event.id, bank.id, admin.id, round.id);

    const attempt = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    // Get the attemptQuestionId for the single question in this attempt
    const [aqRow] = await testDb.execute(sql.raw(
      `SELECT id FROM app.attempt_questions WHERE attempt_id = '${attempt.attemptId}' LIMIT 1`,
    )) as unknown as [{ id: string }];
    const attemptQuestionId = aqRow!.id;

    const opt1 = optionIds[0]!;
    const opt2 = optionIds[1] ?? opt1;

    // Save seq=2 first (the "winner")
    await saveAnswers({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      answers: [{ attemptQuestionId, selectedOptionIds: [opt1], clientSeq: 2 }],
      requestId: crypto.randomUUID(),
    });

    // Try to overwrite with seq=1 (stale — must be ignored by GREATEST())
    await saveAnswers({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      answers: [{ attemptQuestionId, selectedOptionIds: [opt2], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    const [stored] = await testDb
      .select({ selectedOptionIds: quizResponses.selectedOptionIds, clientSeq: quizResponses.clientSeq })
      .from(quizResponses)
      .where(eq(quizResponses.attemptQuestionId, attemptQuestionId));

    // seq=2 answer must still be stored
    expect(Number(stored?.clientSeq)).toBe(2);
    expect((stored?.selectedOptionIds as string[])[0]).toBe(opt1);
  });

  it("F4.2 — higher clientSeq overwrites a lower one", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    const { optionIds } = await addQ(event.id, bank.id, admin.id, round.id);

    const attempt = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    const [aqRow] = await testDb.execute(sql.raw(
      `SELECT id FROM app.attempt_questions WHERE attempt_id = '${attempt.attemptId}' LIMIT 1`,
    )) as unknown as [{ id: string }];
    const attemptQuestionId = aqRow!.id;

    const opt1 = optionIds[0]!;
    const opt2 = optionIds[1] ?? opt1;

    await saveAnswers({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      answers: [{ attemptQuestionId, selectedOptionIds: [opt1], clientSeq: 1 }],
      requestId: crypto.randomUUID(),
    });

    // Higher seq wins
    await saveAnswers({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      answers: [{ attemptQuestionId, selectedOptionIds: [opt2], clientSeq: 5 }],
      requestId: crypto.randomUUID(),
    });

    const [stored] = await testDb
      .select({ clientSeq: quizResponses.clientSeq })
      .from(quizResponses)
      .where(eq(quizResponses.attemptQuestionId, attemptQuestionId));

    expect(Number(stored?.clientSeq)).toBe(5);
  });
});

// ── F5: Double-submit idempotency ─────────────────────────────────────────────

describe("M1-F5: submitAttempt idempotency (double-submit)", () => {
  it("F5.1 — submitting twice returns same scoreRecordId and creates only one score_record", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQ(event.id, bank.id, admin.id, round.id);

    const attempt = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    const submit1 = await submitAttempt({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    const submit2 = await submitAttempt({
      attemptId: attempt.attemptId,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    // Both must return the same scoreRecordId
    expect(submit1.scoreRecordId).toBe(submit2.scoreRecordId);
    expect(submit1.finalScore).toBe(submit2.finalScore);

    // Exactly one score_record linked to this entry+round
    const [countRow] = await testDb
      .select({ total: count() })
      .from(scoreRecords)
      .where(and(
        eq(scoreRecords.entryId, entry.id),
        eq(scoreRecords.roundId, round.id),
      ));
    expect(Number(countRow?.total ?? 0)).toBe(1);
  });

  it("F5.2 — concurrent double-submit produces exactly one score_record", async () => {
    const { event, round, bank, admin, participant, entry } = await seedWorld();
    await addQ(event.id, bank.id, admin.id, round.id);

    const attempt = await startAttempt({
      roundId: round.id,
      entryId: entry.id,
      participantId: participant.id,
      requestId: crypto.randomUUID(),
    });

    // Both fire simultaneously
    const results = await Promise.allSettled([
      submitAttempt({ attemptId: attempt.attemptId, participantId: participant.id, requestId: crypto.randomUUID() }),
      submitAttempt({ attemptId: attempt.attemptId, participantId: participant.id, requestId: crypto.randomUUID() }),
    ]);

    // At least one must succeed
    const successes = results.filter((r) => r.status === "fulfilled");
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Still only one score_record row for this entry+round
    const [countRow] = await testDb
      .select({ total: count() })
      .from(scoreRecords)
      .where(and(
        eq(scoreRecords.entryId, entry.id),
        eq(scoreRecords.roundId, round.id),
      ));
    expect(Number(countRow?.total ?? 0)).toBe(1);
  });
});

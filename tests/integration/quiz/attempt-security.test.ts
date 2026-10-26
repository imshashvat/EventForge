/**
 * tests/integration/quiz/attempt-security.test.ts — Phase 1 audit fixes
 *
 * Covers: entry-ownership IDOR (start/save/submit), cross-attempt answer writes,
 * and concurrent startAttempt (must resume, never 500).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeParticipant, makeEntry, makeRound,
  makeBank, makeQuestion, makeRoundQuestion,
} from "../../fixtures/factory";
import { startAttempt, saveAnswers, submitAttempt } from "@/modules/quiz/service";
import { quizAttempts, attemptQuestions } from "@/core/db/schema";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

let ids: Record<string, string[]> = {};
const track = (t: string, id: string) => { (ids[t] ??= []).push(id); };

afterEach(async () => {
  const ev = ids["app.events"] ?? [];
  if (ev.length) {
    const list = ev.map((i) => `'${i}'`).join(",");
    await testDb.execute(sql.raw(
      `DELETE FROM app.quiz_responses WHERE attempt_id IN (SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${list}]::uuid[]))`,
    )).catch(() => {});
    await testDb.execute(sql.raw(
      `DELETE FROM app.attempt_questions WHERE attempt_id IN (SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${list}]::uuid[]))`,
    )).catch(() => {});
    await testDb.execute(sql.raw(
      `UPDATE app.quiz_attempts SET score_record_id = NULL WHERE event_id = ANY(ARRAY[${list}]::uuid[])`,
    )).catch(() => {});
    for (const t of ["app.quiz_attempts", "app.score_records", "app.round_questions"]) {
      await testDb.execute(sql.raw(`DELETE FROM ${t} WHERE event_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
    }
  }
  const vs = ids["app.question_versions"] ?? [];
  if (vs.length) {
    const list = vs.map((i) => `'${i}'`).join(",");
    await testDb.execute(sql.raw(`DELETE FROM app.question_options WHERE version_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
  }
  const toDelete: Record<string, string[]> = {};
  for (const t of [
    "app.question_options", "app.question_versions", "app.questions", "app.question_banks",
    "app.entries", "app.participants", "app.role_assignments", "app.rounds", "app.events", "app.users",
  ]) if (ids[t]?.length) toDelete[t] = ids[t]!;
  if (Object.keys(toDelete).length) await deleteIds(toDelete).catch(() => {});
  ids = {};
});

async function seed() {
  const admin = await makeUser(testDb, { displayName: "Admin" });
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open", durationMs: 30 * 60 * 1000 });
  track("app.rounds", round.id);
  const bank = await makeBank(testDb, event.id, admin.id);
  track("app.question_banks", bank.id);
  const q = await makeQuestion(testDb, event.id, bank.id, admin.id, {});
  track("app.questions", q.question.id);
  track("app.question_versions", q.version.id);
  for (const o of q.optionIds) track("app.question_options", o);
  const rq = await makeRoundQuestion(testDb, round.id, event.id, q.question.id, 1);
  track("app.round_questions", rq.id);

  const mk = async (name: string) => {
    const u = await makeUser(testDb, { displayName: name });
    track("app.users", u.id);
    const p = await makeParticipant(testDb, u.id, event.id);
    track("app.participants", p.id);
    const e = await makeEntry(testDb, event.id, p.id);
    track("app.entries", e.id);
    return { p, e };
  };
  return { event, round, alice: await mk("Alice"), mallory: await mk("Mallory") };
}

describe("Phase 1: entry ownership (IDOR)", () => {
  it("S1 — another participant cannot start an attempt for a victim's entry", async () => {
    const { round, alice, mallory } = await seed();
    await expect(startAttempt({
      roundId: round.id, entryId: alice.e.id, participantId: mallory.p.id, requestId: crypto.randomUUID(),
    })).rejects.toThrow(/entry/i);
  });

  it("S2 — another participant cannot save answers or submit the victim's attempt", async () => {
    const { round, alice, mallory } = await seed();
    const a = await startAttempt({
      roundId: round.id, entryId: alice.e.id, participantId: alice.p.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", a.attemptId);
    const aq = a.questions[0]!;

    await expect(saveAnswers({
      attemptId: a.attemptId, participantId: mallory.p.id, requestId: crypto.randomUUID(),
      answers: [{ attemptQuestionId: aq.attemptQuestionId, selectedOptionIds: [], clientSeq: 1 }],
    })).rejects.toThrow(/entry/i);

    await expect(submitAttempt({
      attemptId: a.attemptId, participantId: mallory.p.id, requestId: crypto.randomUUID(),
    })).rejects.toThrow(/entry/i);

    const [row] = await testDb.select({ status: quizAttempts.status }).from(quizAttempts)
      .where(eq(quizAttempts.id, a.attemptId));
    expect(row?.status).toBe("in_progress");
  });

  it("S3 — answers targeting another attempt's question are rejected", async () => {
    const { round, alice, mallory } = await seed();
    const a = await startAttempt({
      roundId: round.id, entryId: alice.e.id, participantId: alice.p.id, requestId: crypto.randomUUID(),
    });
    const m = await startAttempt({
      roundId: round.id, entryId: mallory.e.id, participantId: mallory.p.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", a.attemptId);
    track("app.quiz_attempts", m.attemptId);

    await expect(saveAnswers({
      attemptId: m.attemptId, participantId: mallory.p.id, requestId: crypto.randomUUID(),
      answers: [{ attemptQuestionId: a.questions[0]!.attemptQuestionId, selectedOptionIds: [], clientSeq: 1 }],
    })).rejects.toThrow();

    const rows = await testDb.select({ id: attemptQuestions.id }).from(attemptQuestions)
      .where(and(eq(attemptQuestions.attemptId, a.attemptId)));
    expect(rows.length).toBe(1);
  });
});

describe("Phase 1: concurrent startAttempt", () => {
  it("S4 — 5 parallel starts all resolve to the same attempt (no 500)", async () => {
    const { round, alice } = await seed();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        startAttempt({
          roundId: round.id, entryId: alice.e.id, participantId: alice.p.id, requestId: crypto.randomUUID(),
        })),
    );
    const idsSet = new Set(results.map((r) => r.attemptId));
    expect(idsSet.size).toBe(1);
    track("app.quiz_attempts", results[0]!.attemptId);
  });
});

describe("Phase 2: lazy finalization (R-TIME-04, no sweeper)", () => {
  it("L1 — save after deadline finalizes the attempt itself and rejects the write", async () => {
    const { round, alice } = await seed();
    const a = await startAttempt({
      roundId: round.id, entryId: alice.e.id, participantId: alice.p.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", a.attemptId);

    await testDb.execute(sql`
      UPDATE app.quiz_attempts
      SET deadline_at = now() - interval '1 minute', started_at = now() - interval '2 minutes'
      WHERE id = ${a.attemptId}`);

    await expect(saveAnswers({
      attemptId: a.attemptId, participantId: alice.p.id, requestId: crypto.randomUUID(),
      answers: [{ attemptQuestionId: a.questions[0]!.attemptQuestionId, selectedOptionIds: [], clientSeq: 1 }],
    })).rejects.toThrow(/deadline/i);

    const [row] = await testDb.select({ status: quizAttempts.status }).from(quizAttempts)
      .where(eq(quizAttempts.id, a.attemptId));
    expect(row?.status).toBe("auto_submitted");
  });
});

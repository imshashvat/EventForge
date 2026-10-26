/**
 * tests/integration/quiz/round-control.test.ts — Phase 3 round lifecycle
 *
 * P1: pause blocks saves; resume extends every in-progress deadline by the pause (atomic)
 * P2: close finalizes in-progress attempts (close gate) and writes one score each
 * P3: invalid transitions are rejected
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeParticipant, makeEntry, makeRound,
  makeBank, makeQuestion, makeRoundQuestion,
} from "../../fixtures/factory";
import { startAttempt, saveAnswers } from "@/modules/quiz/service";
import { controlRound } from "@/modules/quiz/round-control";
import { quizAttempts, scoreRecords } from "@/core/db/schema";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

let ids: Record<string, string[]> = {};
const track = (t: string, id: string) => { (ids[t] ??= []).push(id); };

afterEach(async () => {
  const ev = ids["app.events"] ?? [];
  if (ev.length) {
    const list = ev.map((i) => `'${i}'`).join(",");
    for (const q of [
      `DELETE FROM app.quiz_responses WHERE attempt_id IN (SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${list}]::uuid[]))`,
      `DELETE FROM app.attempt_questions WHERE attempt_id IN (SELECT id FROM app.quiz_attempts WHERE event_id = ANY(ARRAY[${list}]::uuid[]))`,
      `UPDATE app.quiz_attempts SET score_record_id = NULL WHERE event_id = ANY(ARRAY[${list}]::uuid[])`,
      `DELETE FROM app.round_pauses WHERE event_id = ANY(ARRAY[${list}]::uuid[])`,
    ]) await testDb.execute(sql.raw(q)).catch(() => {});
    for (const t of ["app.quiz_attempts", "app.score_records", "app.round_questions"]) {
      await testDb.execute(sql.raw(`DELETE FROM ${t} WHERE event_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
    }
  }
  const vs = ids["app.question_versions"] ?? [];
  if (vs.length) {
    const list = vs.map((i) => `'${i}'`).join(",");
    await testDb.execute(sql.raw(`DELETE FROM app.question_options WHERE version_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
  }
  const del: Record<string, string[]> = {};
  for (const t of [
    "app.question_options", "app.question_versions", "app.questions", "app.question_banks",
    "app.entries", "app.participants", "app.rounds", "app.events", "app.users",
  ]) if (ids[t]?.length) del[t] = ids[t]!;
  if (Object.keys(del).length) await deleteIds(del).catch(() => {});
  ids = {};
});

async function seed(roundStatus = "open") {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: roundStatus, durationMs: 30 * 60 * 1000 });
  track("app.rounds", round.id);
  const bank = await makeBank(testDb, event.id, admin.id);
  track("app.question_banks", bank.id);
  const q = await makeQuestion(testDb, event.id, bank.id, admin.id, {});
  track("app.questions", q.question.id);
  track("app.question_versions", q.version.id);
  for (const o of q.optionIds) track("app.question_options", o);
  const rq = await makeRoundQuestion(testDb, round.id, event.id, q.question.id, 1);
  track("app.round_questions", rq.id);

  const u = await makeUser(testDb);
  track("app.users", u.id);
  const p = await makeParticipant(testDb, u.id, event.id);
  track("app.participants", p.id);
  const e = await makeEntry(testDb, event.id, p.id);
  track("app.entries", e.id);
  return { admin, event, round, p, e };
}

const ctl = (s: Awaited<ReturnType<typeof seed>>, action: "open" | "pause" | "resume" | "close") =>
  controlRound({
    eventId: s.event.id, roundId: s.round.id, action,
    actorUserId: s.admin.id, requestId: crypto.randomUUID(),
  });

describe("Phase 3: round control", () => {
  it("P1 — pause blocks saves; resume extends in-progress deadlines by the pause", async () => {
    const s = await seed();
    const a = await startAttempt({
      roundId: s.round.id, entryId: s.e.id, participantId: s.p.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", a.attemptId);
    const [before] = await testDb.select({ d: quizAttempts.deadlineAt }).from(quizAttempts)
      .where(eq(quizAttempts.id, a.attemptId));

    await ctl(s, "pause");
    await expect(saveAnswers({
      attemptId: a.attemptId, participantId: s.p.id, requestId: crypto.randomUUID(),
      answers: [{ attemptQuestionId: a.questions[0]!.attemptQuestionId, selectedOptionIds: [], clientSeq: 1 }],
    })).rejects.toThrow(/paused/i);

    await new Promise((r) => setTimeout(r, 1500));
    const resumed = await ctl(s, "resume");
    expect(resumed.status).toBe("open");
    expect(resumed.extendedMs ?? 0).toBeGreaterThanOrEqual(1000);

    const [after] = await testDb.select({ d: quizAttempts.deadlineAt }).from(quizAttempts)
      .where(eq(quizAttempts.id, a.attemptId));
    const delta = new Date(after!.d as unknown as string).getTime() - new Date(before!.d as unknown as string).getTime();
    expect(delta).toBeGreaterThanOrEqual(1000);
    expect(Math.abs(delta - resumed.extendedMs!)).toBeLessThan(5);
  });

  it("P2 — close finalizes in-progress attempts with exactly one score each", async () => {
    const s = await seed();
    const a = await startAttempt({
      roundId: s.round.id, entryId: s.e.id, participantId: s.p.id, requestId: crypto.randomUUID(),
    });
    track("app.quiz_attempts", a.attemptId);

    const closed = await ctl(s, "close");
    expect(closed.status).toBe("closed");
    expect(closed.finalized).toEqual({ submitted: 1, failed: 0 });

    const [row] = await testDb.select({ status: quizAttempts.status }).from(quizAttempts)
      .where(eq(quizAttempts.id, a.attemptId));
    expect(["submitted", "auto_submitted"]).toContain(row?.status);
    const scores = await testDb.select({ id: scoreRecords.id }).from(scoreRecords)
      .where(eq(scoreRecords.sourceRefId, a.attemptId));
    expect(scores.length).toBe(1);
  });

  it("P3 — invalid transitions are rejected", async () => {
    const s = await seed("draft");
    await expect(ctl(s, "resume")).rejects.toThrow(/cannot/i);
    await expect(ctl(s, "close")).rejects.toThrow(/cannot/i);
    await expect(ctl(s, "pause")).rejects.toThrow(/cannot/i);
    const opened = await ctl(s, "open");
    expect(opened.status).toBe("open");
    await expect(ctl(s, "open")).rejects.toThrow(/cannot/i);
  });
});

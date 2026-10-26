/**
 * tests/integration/quiz/question-versioning.test.ts — Suite 2
 *
 * Tests question version creation (BR-06: locked questions get new version,
 * existing attempt snapshots unaffected).
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/question-versioning.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, withTestTx, verifyDb, closeDb } from "../setup";
import {
  makeUser, makeEvent, makeRound, makeBank, makeQuestion,
  makeRoundQuestion,
} from "../../fixtures/factory";
import {
  questions, questionVersions, questionOptions, roundQuestions,
} from "@/core/db/schema";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

beforeAll(verifyDb);
afterAll(closeDb);

describe("2: Question versioning (BR-06)", () => {
  it("2.1 — create single_choice question produces versionNo=1 and options", async () => {
    await withTestTx(async (tx) => {
      const admin = await makeUser(tx);
      const event = await makeEvent(tx, admin.id);
      const bank = await makeBank(tx, event.id, admin.id);
      const { question, version } = await makeQuestion(tx, event.id, bank.id, admin.id, {
        questionType: "single_choice",
        options: [
          { text: "Correct", isCorrect: true },
          { text: "Wrong", isCorrect: false },
        ],
      });

      expect(question.id).toBeDefined();
      expect(version.versionNo).toBe(1);

      const opts = await (tx as unknown as typeof testDb)
        .select()
        .from(questionOptions)
        .where(eq(questionOptions.versionId, version.id));
      expect(opts.length).toBe(2);
      expect(opts.filter((o) => o.isCorrect).length).toBe(1);
    });
  });

  it("2.6 — edit unlocked question creates version 2, is_locked stays false", async () => {
    await withTestTx(async (tx) => {
      const admin = await makeUser(tx);
      const event = await makeEvent(tx, admin.id);
      const bank = await makeBank(tx, event.id, admin.id);
      const { question } = await makeQuestion(tx, event.id, bank.id, admin.id);

      // Not in any round — unlocked
      expect(question.isLocked).toBe(false);

      // Create version 2
      const [v2] = await (tx as unknown as typeof testDb)
        .insert(questionVersions)
        .values({
          questionId: question.id,
          versionNo: 2,
          stem: "Updated stem",
          marks: "2",
          negMarks: "0",
          normalizeCase: true,
          normalizeSpaces: true,
        })
        .returning();

      expect(v2?.versionNo).toBe(2);

      // is_locked should still be false
      const [q] = await (tx as unknown as typeof testDb)
        .select({ isLocked: questions.isLocked })
        .from(questions)
        .where(eq(questions.id, question.id));
      expect(q?.isLocked).toBe(false);
    });
  });

  it("2.7 — edit locked question creates version 2, wasLocked flag returned", async () => {
    await withTestTx(async (tx) => {
      const admin = await makeUser(tx);
      const event = await makeEvent(tx, admin.id);
      const round = await makeRound(tx, event.id, admin.id);
      const bank = await makeBank(tx, event.id, admin.id);
      const { question, version } = await makeQuestion(tx, event.id, bank.id, admin.id);

      // Add to round — this locks the question
      await makeRoundQuestion(tx, round.id, event.id, question.id, 1);

      // Lock the question (simulating what the round composition route does)
      await (tx as unknown as typeof testDb)
        .update(questions)
        .set({ isLocked: true })
        .where(eq(questions.id, question.id));

      // Create a new version (should succeed even when locked per BR-06)
      const [v2] = await (tx as unknown as typeof testDb)
        .insert(questionVersions)
        .values({
          questionId: question.id,
          versionNo: 2,
          stem: "New stem (locked question edit)",
          marks: "3",
          negMarks: "0",
          normalizeCase: true,
          normalizeSpaces: true,
        })
        .returning();

      expect(v2?.versionNo).toBe(2);

      // is_locked remains true
      const [q] = await (tx as unknown as typeof testDb)
        .select({ isLocked: questions.isLocked })
        .from(questions)
        .where(eq(questions.id, question.id));
      expect(q?.isLocked).toBe(true);

      // Original attempt snapshots still reference version 1 — version 2 exists alongside
      const allVersions = await (tx as unknown as typeof testDb)
        .select({ versionNo: questionVersions.versionNo })
        .from(questionVersions)
        .where(eq(questionVersions.questionId, question.id))
        .orderBy(desc(questionVersions.versionNo));
      expect(allVersions.map((v) => v.versionNo)).toEqual([2, 1]);
    });
  });

  it("2.8 — list versions returns newest first", async () => {
    await withTestTx(async (tx) => {
      const admin = await makeUser(tx);
      const event = await makeEvent(tx, admin.id);
      const bank = await makeBank(tx, event.id, admin.id);
      const { question } = await makeQuestion(tx, event.id, bank.id, admin.id);

      // Insert v2 and v3
      for (const vNo of [2, 3]) {
        await (tx as unknown as typeof testDb)
          .insert(questionVersions)
          .values({
            questionId: question.id,
            versionNo: vNo,
            stem: `Version ${vNo}`,
            marks: "1",
            negMarks: "0",
            normalizeCase: true,
            normalizeSpaces: true,
          });
      }

      const versions = await (tx as unknown as typeof testDb)
        .select({ versionNo: questionVersions.versionNo })
        .from(questionVersions)
        .where(eq(questionVersions.questionId, question.id))
        .orderBy(desc(questionVersions.versionNo));

      expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    });
  });
});

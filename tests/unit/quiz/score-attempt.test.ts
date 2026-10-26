/**
 * tests/unit/quiz/score-attempt.test.ts
 * Unit tests for the scoreAttempt() pure function (R-SCORE-01).
 * Run: npx vitest run tests/unit
 */
import { describe, it, expect } from "vitest";
import { scoreAttempt, type QuestionInput, type ResponseInput } from "@/modules/quiz/score-attempt";
import { Decimal } from "decimal.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sc = (id: string): QuestionInput => ({
  attemptQuestionId: id,
  questionType: "single_choice",
  marks: "2",
  negMarks: "0.5",
  options: [{ id: "A", isCorrect: true }, { id: "B", isCorrect: false }],
  acceptedAnswers: null,
  normalizeCase: true,
  normalizeSpaces: true,
});

const mc = (id: string): QuestionInput => ({
  attemptQuestionId: id,
  questionType: "multi_choice",
  marks: "4",
  negMarks: "1",
  options: [
    { id: "A", isCorrect: true },
    { id: "B", isCorrect: true },
    { id: "C", isCorrect: false },
  ],
  acceptedAnswers: null,
  normalizeCase: true,
  normalizeSpaces: true,
});

const tf = (id: string): QuestionInput => ({
  attemptQuestionId: id,
  questionType: "true_false",
  marks: "1",
  negMarks: "0.25",
  options: [{ id: "T", isCorrect: true }, { id: "F", isCorrect: false }],
  acceptedAnswers: null,
  normalizeCase: true,
  normalizeSpaces: true,
});

const st = (id: string, accepted: string[]): QuestionInput => ({
  attemptQuestionId: id,
  questionType: "short_text",
  marks: "3",
  negMarks: "0",
  options: [],
  acceptedAnswers: accepted,
  normalizeCase: true,
  normalizeSpaces: true,
});

const r = (aqId: string, opts: string[], text?: string): ResponseInput => ({
  attemptQuestionId: aqId,
  selectedOptionIds: opts,
  textAnswer: text ?? null,
});

const blank = (aqId: string): ResponseInput => ({
  attemptQuestionId: aqId,
  selectedOptionIds: [],
  textAnswer: null,
});

// ── single_choice ─────────────────────────────────────────────────────────────

describe("single_choice", () => {
  it("awards full marks for correct answer", () => {
    const x = scoreAttempt([sc("q1")], [r("q1", ["A"])]);
    expect(x.questions[0]!.points.toFixed(4)).toBe("2.0000");
    expect(x.questions[0]!.isCorrect).toBe(true);
    expect(x.rawScore.toFixed(4)).toBe("2.0000");
  });

  it("applies neg_marks for wrong answer", () => {
    const x = scoreAttempt([sc("q1")], [r("q1", ["B"])]);
    expect(x.questions[0]!.points.toFixed(4)).toBe("-0.5000");
    expect(x.questions[0]!.isCorrect).toBe(false);
  });

  it("scores 0 and isCorrect=null for blank", () => {
    const x = scoreAttempt([sc("q1")], [blank("q1")]);
    expect(x.questions[0]!.points.toFixed(4)).toBe("0.0000");
    expect(x.questions[0]!.isCorrect).toBeNull();
    expect(x.questions[0]!.reviewStatus).toBe("auto_graded");
  });
});

// ── multi_choice ──────────────────────────────────────────────────────────────

describe("multi_choice", () => {
  it("awards full marks for all-correct selection", () => {
    const x = scoreAttempt([mc("q1")], [r("q1", ["A", "B"])]);
    expect(x.questions[0]!.points.toFixed(4)).toBe("4.0000");
    expect(x.questions[0]!.isCorrect).toBe(true);
  });

  it("partial credit for 1-of-2 correct without wrong selection", () => {
    const x = scoreAttempt([mc("q1")], [r("q1", ["A"])]);
    // 4 * (1/2) = 2, no penalty
    expect(x.questions[0]!.points.toFixed(4)).toBe("2.0000");
    expect(x.questions[0]!.isCorrect).toBe(false);
  });

  it("penalty reduces partial credit for wrong selection included", () => {
    const x = scoreAttempt([mc("q1")], [r("q1", ["A", "C"])]);
    // 4*(1/2) - 1 = 1
    expect(x.questions[0]!.points.toFixed(4)).toBe("1.0000");
  });

  it("clamps to 0 when penalty exceeds partial credit", () => {
    const x = scoreAttempt([mc("q1")], [r("q1", ["C"])]);
    // 4*(0/2) - 1 = -1 → clamped to 0
    expect(x.questions[0]!.points.toFixed(4)).toBe("0.0000");
  });
});

// ── true_false ────────────────────────────────────────────────────────────────

describe("true_false", () => {
  it("awards full marks for correct answer", () => {
    expect(scoreAttempt([tf("q1")], [r("q1", ["T"])]).questions[0]!.points.toFixed(4)).toBe("1.0000");
  });

  it("applies neg_marks for wrong answer", () => {
    expect(scoreAttempt([tf("q1")], [r("q1", ["F"])]).questions[0]!.points.toFixed(4)).toBe("-0.2500");
  });
});

// ── short_text ────────────────────────────────────────────────────────────────

describe("short_text", () => {
  it("awards marks for case-insensitive match", () => {
    const x = scoreAttempt([st("q1", ["paris"])], [r("q1", [], "PARIS")]);
    expect(x.questions[0]!.isCorrect).toBe(true);
    expect(x.questions[0]!.points.toFixed(4)).toBe("3.0000");
    expect(x.questions[0]!.reviewStatus).toBe("auto_graded");
  });

  it("sets pending_review when answer does not match", () => {
    const x = scoreAttempt([st("q1", ["paris"])], [r("q1", [], "london")]);
    expect(x.questions[0]!.reviewStatus).toBe("pending_review");
    expect(x.questions[0]!.isCorrect).toBeUndefined();
    expect(x.hasPendingReview).toBe(true);
  });

  it("sets pending_review when acceptedAnswers is empty", () => {
    const x = scoreAttempt([st("q1", [])], [r("q1", [], "anything")]);
    expect(x.questions[0]!.reviewStatus).toBe("pending_review");
  });

  it("normalizes whitespace before matching", () => {
    const x = scoreAttempt([st("q1", ["new york"])], [r("q1", [], "  New   York  ")]);
    expect(x.questions[0]!.isCorrect).toBe(true);
  });
});

// ── floorAtZero ──────────────────────────────────────────────────────────────

describe("floorAtZero", () => {
  it("allows negative finalScore by default", () => {
    const x = scoreAttempt([sc("q1")], [r("q1", ["B"])]);
    expect(x.finalScore.isNegative()).toBe(true);
  });

  it("clamps finalScore to 0 when floorAtZero=true", () => {
    const x = scoreAttempt([sc("q1")], [r("q1", ["B"])], true);
    expect(x.finalScore.toFixed(4)).toBe("0.0000");
    expect(x.rawScore.toFixed(4)).toBe("-0.5000"); // rawScore is unchanged
  });
});

// ── mixed attempt ─────────────────────────────────────────────────────────────

describe("mixed attempt", () => {
  it("sums scores correctly across all question types", () => {
    const qs = [sc("q1"), mc("q2"), tf("q3"), st("q4", ["photosynthesis"])];
    const rs = [
      r("q1", ["A"]),           // +2
      r("q2", ["A", "B"]),      // +4
      r("q3", ["F"]),           // -0.25
      r("q4", [], "photosynthesis"), // +3
    ];
    const x = scoreAttempt(qs, rs);
    const expected = new Decimal("2").plus("4").minus("0.25").plus("3");
    expect(x.rawScore.toFixed(4)).toBe(expected.toFixed(4));
    expect(x.hasPendingReview).toBe(false);
  });

  it("treats a missing response as blank (scores 0, isCorrect=null)", () => {
    const x = scoreAttempt([sc("q1"), sc("q2")], [r("q1", ["A"])]);
    expect(x.rawScore.toFixed(4)).toBe("2.0000");
    expect(x.questions[1]!.isCorrect).toBeNull();
  });
});

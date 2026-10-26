/**
 * modules/quiz/score-attempt.ts — Pure scoring function (R-SCORE-01)
 *
 * This is the SINGLE source of truth for quiz mark computation.
 * Called by: submit handler, auto-submit sweeper, admin rescore, and preview.
 *
 * RULES:
 *   R-SCORE-01  — scoreAttempt() is the only function that computes quiz marks.
 *   R-CODE-04   — No float arithmetic; uses Decimal.js for all score math.
 *   R-CODE-05   — Pure function: no I/O, no clock reads, no side effects.
 *   BR-05       — Client-submitted scores are never used.
 *   BR-07       — Correct-answer data must not be included in API responses
 *                 until results are released; this function is server-only.
 *   FR-QUIZ-10  — Supports per-question marks, neg_marks, partial credit.
 *   FR-QUIZ-11  — Text answers auto-graded against accepted-answers list.
 *   FR-QUIZ-12  — Unmatched text answers get reviewStatus = 'pending_review'.
 */
import { Decimal } from "decimal.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuestionType = "single_choice" | "multi_choice" | "true_false" | "short_text";

export interface ScoredOption {
  id: string;
  isCorrect: boolean;
}

export interface QuestionInput {
  attemptQuestionId: string;
  questionType: QuestionType;
  marks: string;
  negMarks: string;
  options: ScoredOption[];
  acceptedAnswers: string[] | null;
  normalizeCase: boolean;
  normalizeSpaces: boolean;
}

export interface ResponseInput {
  attemptQuestionId: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
}

export interface ScoredQuestion {
  attemptQuestionId: string;
  points: Decimal;
  isCorrect: boolean | null | undefined;
  reviewStatus: "auto_graded" | "pending_review";
}

export interface ScoreAttemptResult {
  questions: ScoredQuestion[];
  rawScore: Decimal;
  finalScore: Decimal;
  hasPendingReview: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeAnswer(answer: string, normalizeCase: boolean, normalizeSpaces: boolean): string {
  let s = answer;
  if (normalizeCase) s = s.toLowerCase();
  if (normalizeSpaces) s = s.replace(/\s+/g, " ").trim();
  return s;
}

function isBlank(response: ResponseInput): boolean {
  return response.selectedOptionIds.length === 0 &&
    (response.textAnswer == null || response.textAnswer.trim() === "");
}

// ── Core scoring logic ─────────────────────────────────────────────────────────

function scoreQuestion(question: QuestionInput, response: ResponseInput): ScoredQuestion {
  const marks = new Decimal(question.marks);
  const negMarks = new Decimal(question.negMarks);
  const aqId = question.attemptQuestionId;

  if (isBlank(response)) {
    return { attemptQuestionId: aqId, points: new Decimal(0), isCorrect: null, reviewStatus: "auto_graded" };
  }

  switch (question.questionType) {
    case "single_choice":
    case "true_false": {
      const selectedId = response.selectedOptionIds[0];
      const option = question.options.find((o) => o.id === selectedId);
      const correct = option?.isCorrect ?? false;
      return { attemptQuestionId: aqId, points: correct ? marks : negMarks.negated(), isCorrect: correct, reviewStatus: "auto_graded" };
    }

    case "multi_choice": {
      const correctOptions = question.options.filter((o) => o.isCorrect);
      const incorrectOptions = question.options.filter((o) => !o.isCorrect);
      const selectedSet = new Set(response.selectedOptionIds);
      const correctHits = correctOptions.filter((o) => selectedSet.has(o.id)).length;
      const incorrectHits = incorrectOptions.filter((o) => selectedSet.has(o.id)).length;
      const allCorrect = correctHits === correctOptions.length && incorrectHits === 0;

      if (allCorrect) return { attemptQuestionId: aqId, points: marks, isCorrect: true, reviewStatus: "auto_graded" };

      const partial = marks
        .times(correctHits)
        .dividedBy(Math.max(correctOptions.length, 1))
        .minus(incorrectHits > 0 ? negMarks : new Decimal(0));

      return { attemptQuestionId: aqId, points: Decimal.max(new Decimal(0), partial), isCorrect: false, reviewStatus: "auto_graded" };
    }

    case "short_text": {
      const rawText = response.textAnswer ?? "";
      const normalised = normalizeAnswer(rawText, question.normalizeCase, question.normalizeSpaces);
      const accepted = (question.acceptedAnswers ?? []).map((a) =>
        normalizeAnswer(a, question.normalizeCase, question.normalizeSpaces));

      if (accepted.length === 0) return { attemptQuestionId: aqId, points: new Decimal(0), isCorrect: undefined, reviewStatus: "pending_review" };

      const matched = accepted.includes(normalised);
      if (matched) return { attemptQuestionId: aqId, points: marks, isCorrect: true, reviewStatus: "auto_graded" };

      return { attemptQuestionId: aqId, points: new Decimal(0), isCorrect: undefined, reviewStatus: "pending_review" };
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function scoreAttempt(
  questions: QuestionInput[],
  responses: ResponseInput[],
  floorAtZero = false,
): ScoreAttemptResult {
  const responseMap = new Map(responses.map((r) => [r.attemptQuestionId, r]));

  const scored: ScoredQuestion[] = questions.map((q) => {
    const response = responseMap.get(q.attemptQuestionId) ?? {
      attemptQuestionId: q.attemptQuestionId,
      selectedOptionIds: [],
      textAnswer: null,
    };
    return scoreQuestion(q, response);
  });

  const rawScore = scored.reduce((sum, sq) => sum.plus(sq.points), new Decimal(0));
  const finalScore = floorAtZero ? Decimal.max(new Decimal(0), rawScore) : rawScore;
  const hasPendingReview = scored.some((sq) => sq.reviewStatus === "pending_review");

  return { questions: scored, rawScore, finalScore, hasPendingReview };
}

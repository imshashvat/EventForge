/**
 * modules/quiz/attempt-view.ts — Resume view for an in-progress/submitted attempt
 * (FR-QUIZ-07, R-API-02: server time + absolute deadline; BR-07: no correctness flags).
 */
import "server-only";
import { withTx } from "@/core/db";
import { quizAttempts, quizResponses, participants } from "@/core/db/schema";
import { dbNow } from "@/core/clock";
import { ConflictError, ForbiddenError, NotFoundError } from "@/core/errors";
import { eq, and } from "drizzle-orm";
import { assertEntryAccess, loadAttemptQuestions, submitAttempt, type AttemptQuestion } from "./service";

export interface AttemptView {
  attemptId: string;
  roundId: string;
  status: string;
  startedAt: Date;
  deadlineAt: Date;
  serverTime: Date;
  questions: AttemptQuestion[];
  /** Saved answers keyed by attemptQuestionId (no correctness data). */
  responses: Record<string, { selectedOptionIds: string[]; textAnswer: string | null; clientSeq: number }>;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

export async function getAttemptView(input: {
  attemptId: string;
  userId: string;
  requestId: string;
}): Promise<AttemptView> {
  const view = await withTx(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.id, input.attemptId))
      .limit(1);
    if (!attempt) throw new NotFoundError("Attempt");

    const [participant] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(and(
        eq(participants.userId, input.userId),
        eq(participants.eventId, attempt.eventId),
        eq(participants.status, "approved"),
      ))
      .limit(1);
    if (!participant) throw new ForbiddenError("Not an approved participant in this event");
    await assertEntryAccess(tx, attempt.entryId, participant.id);

    const now = await dbNow(tx);
    const deadlineAt = toDate(attempt.deadlineAt);
    const expired = attempt.status === "in_progress" && deadlineAt <= now;

    if (attempt.status !== "in_progress" || expired) {
      return { expired, attempt, view: null as AttemptView | null, now };
    }

    const questions = await loadAttemptQuestions(tx, attempt.id);
    const saved = await tx
      .select({
        attemptQuestionId: quizResponses.attemptQuestionId,
        selectedOptionIds: quizResponses.selectedOptionIds,
        textAnswer: quizResponses.textAnswer,
        clientSeq: quizResponses.clientSeq,
      })
      .from(quizResponses)
      .where(eq(quizResponses.attemptId, attempt.id));

    return {
      expired: false,
      attempt,
      now,
      view: {
        attemptId: attempt.id,
        roundId: attempt.roundId,
        status: attempt.status,
        startedAt: toDate(attempt.startedAt),
        deadlineAt,
        serverTime: now,
        questions,
        responses: Object.fromEntries(
          saved.map((r) => [r.attemptQuestionId, {
            selectedOptionIds: r.selectedOptionIds ?? [],
            textAnswer: r.textAnswer,
            clientSeq: r.clientSeq,
          }]),
        ),
      } satisfies AttemptView,
    };
  });

  if (view.view) return view.view;

  // Past deadline: finalize now (R-TIME-04), then tell the client it is over.
  if (view.expired) {
    await submitAttempt({ attemptId: input.attemptId, requestId: `lazy-${input.requestId}` });
  }
  throw new ConflictError("Attempt has already been submitted");
}

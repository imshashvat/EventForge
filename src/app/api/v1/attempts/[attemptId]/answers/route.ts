/**
 * PUT /api/v1/attempts/[attemptId]/answers
 * Save quiz answers (idempotent upsert with clientSeq guard).
 * Body: { answers: Array<{ attemptQuestionId, selectedOptionIds, textAnswer?, clientSeq }> }
 * Auth: participant whose entry owns this attempt.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { toHttpError, NotFoundError, ForbiddenError } from "@/core/errors";
import { saveAnswers } from "@/modules/quiz/service";
import { rateLimit } from "@/core/rate-limit";
import { db } from "@/core/db";
import { quizAttempts, entries, participants } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";

interface Params { params: Promise<{ attemptId: string }> }

const answerSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().uuid()).default([]),
  textAnswer: z.string().max(2000).nullable().optional(),
  clientSeq: z.number().int().nonnegative(),
});

const bodySchema = z.object({
  answers: z.array(answerSchema).min(1).max(200),
});

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { attemptId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate-limit: 30 saves/min/attempt (fail-open hot-path — ARCHITECTURE §17.1)
  // Uses attemptId so each active quiz session is limited independently.
  await rateLimit("answer-save", attemptId).catch(() => { /* fail-open: Redis unavailable */ });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });

  try {
    // Verify caller's participant owns this attempt's entry
    const [attempt] = await db.select({ entryId: quizAttempts.entryId, eventId: quizAttempts.eventId }).from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new NotFoundError("Attempt");

    const [participant] = await db.select({ id: participants.id }).from(participants).where(and(eq(participants.userId, appUser.id), eq(participants.eventId, attempt.eventId))).limit(1);
    if (!participant) throw new ForbiddenError("Not a participant in this event");

    const result = await saveAnswers({
      attemptId,
      participantId: participant.id,
      answers: parsed.data.answers.map((a) => ({
        attemptQuestionId: a.attemptQuestionId,
        selectedOptionIds: a.selectedOptionIds,
        ...(a.textAnswer !== undefined && { textAnswer: a.textAnswer }),
        clientSeq: a.clientSeq,
      })),
      requestId,
    });

    return NextResponse.json({ saved: result });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}
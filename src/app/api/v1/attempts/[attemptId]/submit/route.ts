/**
 * POST /api/v1/attempts/[attemptId]/submit
 * Submit a quiz attempt and trigger scoring.
 * Auth: participant whose entry owns this attempt.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser } from "@/core/auth";
import { toHttpError, NotFoundError, ForbiddenError } from "@/core/errors";
import { submitAttempt } from "@/modules/quiz/service";
import { rateLimit } from "@/core/rate-limit";
import { db } from "@/core/db";
import { quizAttempts, participants } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";

interface Params { params: Promise<{ attemptId: string }> }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { attemptId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate-limit: 10 submits/min/entry (fail-open hot-path — ARCHITECTURE §17.1)
  await rateLimit("quiz-submit", attemptId).catch(() => { /* fail-open */ });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    const [attempt] = await db.select({ eventId: quizAttempts.eventId }).from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new NotFoundError("Attempt");

    const [participant] = await db.select({ id: participants.id }).from(participants).where(and(eq(participants.userId, appUser.id), eq(participants.eventId, attempt.eventId))).limit(1);
    if (!participant) throw new ForbiddenError("Not a participant in this event");

    const result = await submitAttempt({ attemptId, participantId: participant.id, requestId });
    return NextResponse.json({ result });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}
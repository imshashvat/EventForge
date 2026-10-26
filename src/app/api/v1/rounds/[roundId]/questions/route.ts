/**
 * GET  /api/v1/rounds/[roundId]/questions  — list questions in round composition
 * POST /api/v1/rounds/[roundId]/questions  — add a question to a round
 *
 * Auth: event:manage for the round's event
 *
 * FR-QUIZ-04: round composition — fixed questions or pool-based sampling
 * BR-06: once a question version is referenced by an in-progress attempt,
 *        edits must create a new version (enforced by is_locked flag)
 * BR-10: question and round must belong to the same event (event isolation)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, NotFoundError, ValidationError } from "@/core/errors";
import { db, withTx } from "@/core/db";
import {
  rounds, questions, roundQuestions, questionVersions,
} from "@/core/db/schema";
import { eq, and } from "drizzle-orm";

interface Params { params: Promise<{ roundId: string }> }

const addQuestionSchema = z.object({
  questionId: z.string().uuid(),
  /** Pin a specific version. If omitted, latest version is pinned at attempt-start time. */
  pinnedVersionId: z.string().uuid().optional(),
  /** displayOrder for fixed-question composition (null for pool questions) */
  displayOrder: z.number().int().positive().optional(),
  /** Pool-based: tag to sample from */
  poolTag: z.string().max(50).optional(),
  /** Pool-based: number of questions to draw from pool */
  poolDrawN: z.number().int().positive().max(200).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    const [round] = await db.select({ id: rounds.id, eventId: rounds.eventId })
      .from(rounds).where(eq(rounds.id, roundId)).limit(1);
    if (!round) throw new NotFoundError("Round");

    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId: round.eventId });

    const composition = await db
      .select({
        id: roundQuestions.id,
        questionId: roundQuestions.questionId,
        pinnedVersionId: roundQuestions.pinnedVersionId,
        displayOrder: roundQuestions.displayOrder,
        poolTag: roundQuestions.poolTag,
        poolDrawN: roundQuestions.poolDrawN,
        createdAt: roundQuestions.createdAt,
      })
      .from(roundQuestions)
      .where(eq(roundQuestions.roundId, roundId))
      .orderBy(roundQuestions.displayOrder);

    return NextResponse.json({ questions: composition });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = addQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  const data = parsed.data;

  try {
    const result = await withTx(async (tx) => {
      // Load and validate round
      const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
      if (!round) throw new NotFoundError("Round");
      if (round.roundType !== "quiz") throw new ValidationError("Round is not a quiz round");

      // Authorize
      const actor = await buildActor(appUser.id);
      authorize(actor, "quiz:author", { type: "event", eventId: round.eventId });

      // Load and validate question — BR-10: must be same event
      const [question] = await tx
        .select({ id: questions.id, eventId: questions.eventId, isLocked: questions.isLocked })
        .from(questions)
        .where(and(eq(questions.id, data.questionId), eq(questions.eventId, round.eventId)))
        .limit(1);
      if (!question) {
        throw new NotFoundError("Question (or question does not belong to this event)");
      }

      // Validate pinned version belongs to this question
      if (data.pinnedVersionId) {
        const [ver] = await tx
          .select({ id: questionVersions.id })
          .from(questionVersions)
          .where(and(
            eq(questionVersions.id, data.pinnedVersionId),
            eq(questionVersions.questionId, data.questionId),
          ))
          .limit(1);
        if (!ver) throw new ValidationError("Pinned version does not belong to this question");
      }

      // Upsert into round_questions (idempotent on duplicate)
      const [rq] = await tx
        .insert(roundQuestions)
        .values({
          roundId,
          eventId: round.eventId,
          questionId: data.questionId,
          ...(data.pinnedVersionId !== undefined && { pinnedVersionId: data.pinnedVersionId }),
          ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
          ...(data.poolTag !== undefined && { poolTag: data.poolTag }),
          ...(data.poolDrawN !== undefined && { poolDrawN: data.poolDrawN }),
        })
        .onConflictDoUpdate({
          target: [roundQuestions.roundId, roundQuestions.questionId],
          set: {
            ...(data.pinnedVersionId !== undefined && { pinnedVersionId: data.pinnedVersionId }),
            ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
            ...(data.poolTag !== undefined && { poolTag: data.poolTag }),
            ...(data.poolDrawN !== undefined && { poolDrawN: data.poolDrawN }),
          },
        })
        .returning();

      if (!rq) throw new Error("Failed to add question to round");

      // Lock the question so edits create a new version (BR-06)
      if (!question.isLocked) {
        await tx.update(questions)
          .set({ isLocked: true, updatedAt: new Date() })
          .where(eq(questions.id, data.questionId));
      }

      return rq;
    });

    return NextResponse.json({ roundQuestion: result }, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

/**
 * GET  /api/v1/questions/[questionId]/versions  — list all versions of a question
 * POST /api/v1/questions/[questionId]/versions  — create new version (BR-06 edit flow)
 *
 * Auth: quiz:author on the question's event
 *
 * BR-06: once a question is referenced by a round (is_locked=true),
 *        edits MUST create a new version. Existing attempt snapshots are
 *        unaffected because attempt_questions stores a frozen versionId.
 *
 * FR-QUIZ-03: version_no increments atomically via MAX(version_no) + 1
 *             inside the same transaction to prevent gaps.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, NotFoundError } from "@/core/errors";
import { db, withTx } from "@/core/db";
import {
  questions, questionVersions, questionOptions,
} from "@/core/db/schema";
import { eq, sql, desc } from "drizzle-orm";

interface Params { params: Promise<{ questionId: string }> }

const optionSchema = z.object({
  optionText: z.string().min(1).max(1000),
  optionImageUrl: z.string().url().optional(),
  isCorrect: z.boolean(),
  displayOrder: z.number().int().positive(),
});

const createVersionSchema = z.object({
  stem: z.string().min(1).max(5000),
  stemImageUrl: z.string().url().optional(),
  marks: z.string().regex(/^\d+(\.\d{1,4})?$/).default("1"),
  negMarks: z.string().regex(/^\d+(\.\d{1,4})?$/).default("0"),
  options: z.array(optionSchema).optional(),
  acceptedAnswers: z.array(z.string().max(500)).optional(),
  normalizeCase: z.boolean().default(true),
  normalizeSpaces: z.boolean().default(true),
});

function validateOptions(
  questionType: string,
  options: z.infer<typeof optionSchema>[] | undefined,
): string | null {
  if (questionType === "short_text") return null;
  if (!options || options.length === 0) return "Options are required for choice questions";
  const correctCount = options.filter((o) => o.isCorrect).length;
  if (questionType === "single_choice" || questionType === "true_false") {
    if (correctCount !== 1) return `${questionType} requires exactly 1 correct option (got ${correctCount})`;
    if (questionType === "true_false" && options.length !== 2) return "true_false requires exactly 2 options";
  }
  if (questionType === "multi_choice") {
    if (correctCount < 1) return "multi_choice requires at least 1 correct option";
    if (options.length < 2) return "multi_choice requires at least 2 options";
  }
  return null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { questionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    const [question] = await db
      .select({ id: questions.id, eventId: questions.eventId, questionType: questions.questionType })
      .from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!question) throw new NotFoundError("Question");

    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId: question.eventId });

    const versions = await db
      .select({
        id: questionVersions.id,
        versionNo: questionVersions.versionNo,
        stem: questionVersions.stem,
        stemImageUrl: questionVersions.stemImageUrl,
        marks: questionVersions.marks,
        negMarks: questionVersions.negMarks,
        acceptedAnswers: questionVersions.acceptedAnswers,
        normalizeCase: questionVersions.normalizeCase,
        normalizeSpaces: questionVersions.normalizeSpaces,
        createdAt: questionVersions.createdAt,
      })
      .from(questionVersions)
      .where(eq(questionVersions.questionId, questionId))
      .orderBy(desc(questionVersions.versionNo));

    return NextResponse.json({ versions });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { questionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = createVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  const data = parsed.data;

  try {
    const result = await withTx(async (tx) => {
      // Load question + authorise
      const [question] = await tx
        .select({ id: questions.id, eventId: questions.eventId, questionType: questions.questionType, isLocked: questions.isLocked })
        .from(questions).where(eq(questions.id, questionId)).limit(1);
      if (!question) throw new NotFoundError("Question");

      const actor = await buildActor(appUser.id);
      authorize(actor, "quiz:author", { type: "event", eventId: question.eventId });

      // Validate options for the question's type
      const optionError = validateOptions(question.questionType, data.options);
      if (optionError) throw new Error(optionError); // will map to 422 via toHttpError? — return as ValidationError

      // Atomic next version number — MAX + 1 within this question
      const versionRows = await tx.execute<{ nextNo: number }>(sql`
        SELECT COALESCE(MAX(version_no), 0) + 1 AS "nextNo"
        FROM app.question_versions
        WHERE question_id = ${questionId}
      `);
      const nextNo = Array.from(versionRows)[0]?.nextNo ?? 1;

      const [version] = await tx
        .insert(questionVersions)
        .values({
          questionId,
          versionNo: nextNo,
          stem: data.stem,
          ...(data.stemImageUrl !== undefined && { stemImageUrl: data.stemImageUrl }),
          marks: data.marks,
          negMarks: data.negMarks,
          ...(data.acceptedAnswers !== undefined && { acceptedAnswers: data.acceptedAnswers }),
          normalizeCase: data.normalizeCase,
          normalizeSpaces: data.normalizeSpaces,
        })
        .returning();
      if (!version) throw new Error("Failed to create question version");

      if (data.options && data.options.length > 0) {
        await tx.insert(questionOptions).values(
          data.options.map((opt) => ({
            versionId: version.id,
            optionText: opt.optionText,
            ...(opt.optionImageUrl !== undefined && { optionImageUrl: opt.optionImageUrl }),
            isCorrect: opt.isCorrect,
            displayOrder: opt.displayOrder,
          })),
        );
      }

      // Update question's updatedAt
      await tx.update(questions)
        .set({ updatedAt: new Date() })
        .where(eq(questions.id, questionId));

      return { version, isLocked: question.isLocked };
    });

    return NextResponse.json(
      {
        version: {
          id: result.version.id,
          questionId,
          versionNo: result.version.versionNo,
          stem: result.version.stem,
          marks: result.version.marks,
          negMarks: result.version.negMarks,
          wasLocked: result.isLocked,
          note: result.isLocked
            ? "Question was locked — existing attempt snapshots use their frozen version and are unaffected."
            : undefined,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

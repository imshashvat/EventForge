/**
 * GET  /api/v1/question-banks/[bankId]/questions  — list questions in bank
 * POST /api/v1/question-banks/[bankId]/questions  — create question + first version + options
 *
 * Auth: event:manage for the bank's event
 *
 * FR-QUIZ-01: supports single_choice, multi_choice, true_false, short_text
 * FR-QUIZ-03: creates version_no=1 on first create; edits create new versions
 * BR-07: isCorrect fields are never returned to participant APIs
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, NotFoundError } from "@/core/errors";
import { db, withTx } from "@/core/db";
import {
  questionBanks, questions, questionVersions, questionOptions,
} from "@/core/db/schema";
import { eq } from "drizzle-orm";

interface Params { params: Promise<{ bankId: string }> }

// ── Validation schemas ────────────────────────────────────────────────────────

const optionSchema = z.object({
  optionText: z.string().min(1).max(1000),
  optionImageUrl: z.string().url().optional(),
  isCorrect: z.boolean(),
  displayOrder: z.number().int().positive(),
});

const createSchema = z.object({
  questionType: z.enum(["single_choice", "multi_choice", "true_false", "short_text"]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  tags: z.array(z.string().max(50)).max(20).default([]),
  // Version 1 content
  stem: z.string().min(1).max(5000),
  stemImageUrl: z.string().url().optional(),
  marks: z.string().regex(/^\d+(\.\d{1,4})?$/).default("1"),
  negMarks: z.string().regex(/^\d+(\.\d{1,4})?$/).default("0"),
  // For choice questions
  options: z.array(optionSchema).optional(),
  // For short_text questions
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
  const { bankId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    const [bank] = await db.select().from(questionBanks).where(eq(questionBanks.id, bankId)).limit(1);
    if (!bank) throw new NotFoundError("Question bank");

    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId: bank.eventId });

    const qs = await db
      .select({
        id: questions.id,
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        tags: questions.tags,
        isLocked: questions.isLocked,
        createdAt: questions.createdAt,
        updatedAt: questions.updatedAt,
      })
      .from(questions)
      .where(eq(questions.bankId, bankId))
      .orderBy(questions.createdAt);

    return NextResponse.json({ questions: qs });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { bankId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  const data = parsed.data;
  const optionError = validateOptions(data.questionType, data.options);
  if (optionError) {
    return NextResponse.json({ error: optionError }, { status: 422 });
  }

  try {
    const [bank] = await db.select().from(questionBanks).where(eq(questionBanks.id, bankId)).limit(1);
    if (!bank) throw new NotFoundError("Question bank");

    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId: bank.eventId });

    // Create question + version 1 + options atomically
    const result = await withTx(async (tx) => {
      const [question] = await tx
        .insert(questions)
        .values({
          eventId: bank.eventId,
          bankId,
          questionType: data.questionType,
          difficulty: data.difficulty,
          tags: data.tags,
          createdBy: appUser.id,
        })
        .returning({ id: questions.id });
      if (!question) throw new Error("Failed to create question");

      const [version] = await tx
        .insert(questionVersions)
        .values({
          questionId: question.id,
          versionNo: 1,
          stem: data.stem,
          ...(data.stemImageUrl !== undefined && { stemImageUrl: data.stemImageUrl }),
          marks: data.marks,
          negMarks: data.negMarks,
          ...(data.acceptedAnswers !== undefined && { acceptedAnswers: data.acceptedAnswers }),
          normalizeCase: data.normalizeCase,
          normalizeSpaces: data.normalizeSpaces,
        })
        .returning({ id: questionVersions.id });
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

      return { questionId: question.id, versionId: version.id };
    });

    return NextResponse.json(
      {
        question: {
          id: result.questionId,
          bankId,
          eventId: bank.eventId,
          questionType: data.questionType,
          latestVersionId: result.versionId,
          versionNo: 1,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

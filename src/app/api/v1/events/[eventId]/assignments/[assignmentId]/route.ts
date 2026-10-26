/**
 * PUT  /api/v1/events/[eventId]/assignments/[assignmentId]/evaluation
 *   → Save draft or submit evaluation (judging:score)
 *
 * POST /api/v1/events/[eventId]/assignments/[assignmentId]/finalize
 *   → Finalize judging for the submission tied to this assignment (judging:reconcile)
 *
 * POST /api/v1/events/[eventId]/assignments/[assignmentId]/resolve
 *   → Record a disagreement resolution (judging:reconcile)
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import {
  saveEvaluation,
  finalizeJudging,
  resolveDisagreement,
} from "@/modules/judging/service";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { judgingAssignments } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

type Ctx = { params: Promise<{ eventId: string; assignmentId: string }> };

const ScoreItemSchema = z.object({
  criterionId: z.string().uuid(),
  marksAwarded: z.number().min(0),
  comment: z.string().max(500).optional(),
});

const EvalBodySchema = z.object({
  scores: z.array(ScoreItemSchema).min(1),
  comment: z.string().max(2000).optional(),
  submit: z.boolean().default(false),
});

const FinalizeBodySchema = z.object({
  roundId: z.string().uuid(),
  entryId: z.string().uuid(),
  rubricId: z.string().uuid(),
});

const ResolveBodySchema = z.object({
  rubricId: z.string().uuid(),
  method: z.enum(["adopt_mean", "adopt_median", "manual_value"]),
  manualValue: z.number().optional(),
  reason: z.string().min(10).max(2000),
});

async function resolveAuth(req: NextRequest, eventId: string, permission: "judging:score" | "judging:reconcile") {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, permission, { type: "event", eventId });
  } catch {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { appUserId: appUserId! };
}

// ── PUT /evaluation ───────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, assignmentId } = await params;

  const auth = await resolveAuth(req, eventId, "judging:score");
  if ("error" in auth) return auth.error;

  let body: z.infer<typeof EvalBodySchema>;
  try {
    const parsed = EvalBodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await saveEvaluation({
      assignmentId,
      judgeUserId: auth.appUserId,
      eventId,
      scores: body.scores,
      comment: body.comment,
      submit: body.submit,
      requestId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

// ── POST /finalize ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, assignmentId } = await params;

  const auth = await resolveAuth(req, eventId, "judging:reconcile");
  if ("error" in auth) return auth.error;

  // Determine if this is a finalize or resolve call by looking at URL
  const url = new URL(req.url);
  const isResolve = url.pathname.endsWith("/resolve");

  if (isResolve) {
    let body: z.infer<typeof ResolveBodySchema>;
    try {
      const parsed = ResolveBodySchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
      body = parsed.data;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Get submissionId from assignment
    const [asgn] = await db
      .select({ submissionId: judgingAssignments.submissionId })
      .from(judgingAssignments)
      .where(eq(judgingAssignments.id, assignmentId))
      .limit(1);
    if (!asgn) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    try {
      const result = await resolveDisagreement({
        submissionId: asgn.submissionId,
        rubricId: body.rubricId,
        eventId,
        method: body.method,
        ...(body.manualValue !== undefined ? { manualValue: body.manualValue } : {}),
        reason: body.reason,
        actorUserId: auth.appUserId,
        requestId,
      });
      return NextResponse.json(result, { status: 200 });
    } catch (err) {
      const http = toHttpError(err, requestId);
      return NextResponse.json(http, { status: http.statusCode });
    }
  }

  // Finalize
  let body: z.infer<typeof FinalizeBodySchema>;
  try {
    const parsed = FinalizeBodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const [asgn] = await db
    .select({ submissionId: judgingAssignments.submissionId })
    .from(judgingAssignments)
    .where(eq(judgingAssignments.id, assignmentId))
    .limit(1);
  if (!asgn) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  try {
    const result = await finalizeJudging({
      submissionId: asgn.submissionId,
      rubricId: body.rubricId,
      eventId,
      roundId: body.roundId,
      entryId: body.entryId,
      actorUserId: auth.appUserId,
      requestId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

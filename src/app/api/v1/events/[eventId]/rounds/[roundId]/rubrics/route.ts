/**
 * POST /api/v1/events/[eventId]/rounds/[roundId]/rubrics
 * GET  /api/v1/events/[eventId]/rounds/[roundId]/rubrics
 *
 * POST — create a rubric (with criteria) for a round. Idempotent if one exists (409 returned).
 * GET  — retrieve the rubric + criteria for a round.
 *
 * Auth: rubric:manage
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { createRubric, getRubric } from "@/modules/judging/service";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { evaluationRubrics } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

type Ctx = { params: Promise<{ eventId: string; roundId: string }> };

const CriterionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  maxMarks: z.number().positive(),
  weight: z.number().positive().optional(),
  displayOrder: z.number().int().positive().optional(),
});

const BodySchema = z.object({
  name: z.string().min(2).max(200),
  aggregation: z.enum(["mean", "median", "trimmed_mean", "max", "min", "weighted_judges"]).optional(),
  varianceThresholdPct: z.number().min(0).max(100).optional(),
  minJudges: z.number().int().positive().optional(),
  blind: z.boolean().optional(),
  criteria: z.array(CriterionSchema).min(1),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "rubric:manage", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await createRubric({
      roundId,
      eventId,
      name: body.name,
      aggregation: body.aggregation,
      varianceThresholdPct: body.varianceThresholdPct,
      minJudges: body.minJudges,
      blind: body.blind,
      criteria: body.criteria,
      actorUserId: appUserId,
      requestId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    // Judges + admins can view rubrics
    authorize(actor, "judging:score", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [rubric] = await db
      .select({ id: evaluationRubrics.id })
      .from(evaluationRubrics)
      .where(eq(evaluationRubrics.roundId, roundId))
      .limit(1);

    if (!rubric) return NextResponse.json({ error: "No rubric found for this round" }, { status: 404 });

    const full = await getRubric(rubric.id);
    return NextResponse.json(full);
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

/**
 * POST /api/v1/events/[eventId]/submissions/[submissionId]/assignments
 * GET  /api/v1/events/[eventId]/submissions/[submissionId]/assignments
 *
 * POST — assign judges to a submission (judging:assign permission).
 *         Body: { judgeUserIds: string[], rubricId: string }
 *         Idempotent: already-assigned judges are skipped, not errored.
 *
 * GET  — list all assignments for a submission (judging:assign or judging:score).
 *
 * Auth: judging:assign for POST; judging:score for GET
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { assignJudges } from "@/modules/judging/service";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { judgingAssignments } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

type Ctx = { params: Promise<{ eventId: string; submissionId: string }> };

const PostBodySchema = z.object({
  judgeUserIds: z.array(z.string().uuid()).min(1).max(20),
  rubricId: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, submissionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "judging:assign", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof PostBodySchema>;
  try {
    const parsed = PostBodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await assignJudges({
      submissionId,
      judgeUserIds: body.judgeUserIds,
      rubricId: body.rubricId,
      eventId,
      actorUserId: appUserId,
      requestId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, submissionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "judging:score", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const assignments = await db
      .select()
      .from(judgingAssignments)
      .where(eq(judgingAssignments.submissionId, submissionId));
    return NextResponse.json({ assignments });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

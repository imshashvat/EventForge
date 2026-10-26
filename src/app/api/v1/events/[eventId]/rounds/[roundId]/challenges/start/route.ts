/**
 * POST /api/v1/events/[eventId]/rounds/[roundId]/challenges/start
 *
 * Start a challenge for the authenticated participant's entry.
 * Idempotent: re-calling returns the existing start record.
 *
 * Body: { entryId: string }
 * Auth: participant (quiz:attempt)
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { startChallenge } from "@/modules/challenges/service";
import { toHttpError } from "@/core/errors";
import { z } from "zod";

const BodySchema = z.object({
  entryId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string; roundId: string }> },
) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "submission:create", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { db } = await import("@/core/db");
    const { challengeTasks } = await import("@/core/db/schema");
    const { eq } = await import("drizzle-orm");
    const [task] = await db
      .select({ id: challengeTasks.id })
      .from(challengeTasks)
      .where(eq(challengeTasks.roundId, roundId))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: "No challenge task found for this round" }, { status: 404 });
    }

    const result = await startChallenge({
      taskId: task.id,
      entryId: body.entryId,
      participantId: appUserId,
      requestId: req.headers.get("idempotency-key") ?? requestId,
    });

    return NextResponse.json(result, { status: result.alreadyStarted ? 200 : 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

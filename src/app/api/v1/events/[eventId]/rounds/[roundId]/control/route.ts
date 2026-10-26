/**
 * POST /api/v1/events/[eventId]/rounds/[roundId]/control
 * Body: { action: "open" | "pause" | "resume" | "close" }
 * Auth: round:control (event or round scope). Pause/resume extend deadlines
 * atomically (R-TIME-03); close finalizes in-progress attempts (R-TIME-04).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { controlRound } from "@/modules/quiz/round-control";

interface Params { params: Promise<{ eventId: string; roundId: string }> }

const bodySchema = z.object({
  action: z.enum(["open", "pause", "resume", "close"]),
}).strict();

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, roundId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let actorId: string;
  try {
    actorId = (await resolveAppUser(user)).id;
    authorize(await buildActor(actorId), "round:control", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const result = await controlRound({
      eventId, roundId, action: parsed.data.action, actorUserId: actorId, requestId,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

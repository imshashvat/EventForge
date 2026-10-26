/**
 * GET /api/v1/attempts/[attemptId] — resume an in-progress attempt after refresh/disconnect.
 * Returns serverTime + absolute deadlineAt (R-API-02); never includes correctness flags (BR-07).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser } from "@/core/auth";
import { toHttpError } from "@/core/errors";
import { getAttemptView } from "@/modules/quiz/attempt-view";

interface Params { params: Promise<{ attemptId: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { attemptId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUser = await resolveAppUser(session);
    const view = await getAttemptView({ attemptId, userId: appUser.id, requestId });
    return NextResponse.json(
      { attempt: view },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

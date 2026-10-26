/**
 * GET /api/v1/events/[eventId]/exports?type=<type>
 *
 * Streams a CSV export for admin download.
 * Types: participants | leaderboard | challenge_submissions | evaluations
 * Requires event:read permission (event_admin / super_admin).
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import {
  exportParticipants,
  exportLeaderboard,
  exportChallengeSubmissions,
  exportEvaluations,
} from "@/modules/exports/service";

interface Params { params: Promise<{ eventId: string }> }

const ALLOWED_TYPES = ["participants", "leaderboard", "challenge_submissions", "evaluations"] as const;
type ExportType = (typeof ALLOWED_TYPES)[number];

const FILENAMES: Record<ExportType, string> = {
  participants: "participants.csv",
  leaderboard: "leaderboard.csv",
  challenge_submissions: "submissions.csv",
  evaluations: "evaluations.csv",
};

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const typeParam = req.nextUrl.searchParams.get("type") as ExportType | null;
  if (!typeParam || !ALLOWED_TYPES.includes(typeParam)) {
    return NextResponse.json(
      { error: `Invalid type. Allowed: ${ALLOWED_TYPES.join(", ")}` },
      { status: 422 },
    );
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "export:create", { type: "event", eventId });

    let csv: string;
    switch (typeParam) {
      case "participants":
        csv = await exportParticipants(eventId);
        break;
      case "leaderboard":
        csv = await exportLeaderboard(eventId);
        break;
      case "challenge_submissions":
        csv = await exportChallengeSubmissions(eventId);
        break;
      case "evaluations":
        csv = await exportEvaluations(eventId);
        break;
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${FILENAMES[typeParam]}"`,
        "X-Request-Id": requestId,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

/**
 * GET   /api/v1/events/[eventId]/results/runs/[runId]
 *   → Fetch a single result run with its calculated_results.
 *     Auth: results:publish (all runs) | leaderboard:view (final only)
 *
 * POST  /api/v1/events/[eventId]/results/runs/[runId]/publish
 *   → Promote a dry_run|provisional run to final (supersedes any existing final run).
 *     Auth: results:publish
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { getResultRun, publishRun } from "@/modules/results/service";
import { toHttpError, ForbiddenError } from "@/core/errors";

type Ctx = { params: Promise<{ eventId: string; runId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, runId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let isStaff = false;
  try {
    const appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    try {
      authorize(actor, "results:publish", { type: "event", eventId });
      isStaff = true;
    } catch {
      authorize(actor, "leaderboard:view", { type: "event", eventId });
    }
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await getResultRun(runId);
    // Participants can only see final runs
    if (!isStaff && result.run.status !== "final") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, runId } = await params;

  // Only handle /publish suffix — Next.js routes all POST to this handler
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/publish")) {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "results:publish", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await publishRun({ runId, eventId, actorUserId: appUserId, requestId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

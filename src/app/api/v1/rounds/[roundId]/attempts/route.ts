/**
 * POST /api/v1/rounds/[roundId]/attempts
 * Start or resume a quiz attempt for the authenticated entry.
 * Body: { entryId: string }
 * Auth: participant with attempt:take in event scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { startAttempt } from "@/modules/quiz/service";
import { rateLimit } from "@/core/rate-limit";
import { db } from "@/core/db";
import { entries, participants, rounds } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";

interface Params { params: Promise<{ roundId: string }> }

const bodySchema = z.object({ entryId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { roundId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate-limit: 5 attempt starts/min/user (ARCHITECTURE §17.1)
  try { await rateLimit("attempt-start", sessionUser.id); }
  catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });

  try {
    const [round] = await db.select({ eventId: rounds.eventId }).from(rounds).where(eq(rounds.id, roundId)).limit(1);
    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

    const actor = await buildActor(appUser.id);
    authorize(actor, "attempt:take", { type: "event", eventId: round.eventId });

    const [entry] = await db.select({ id: entries.id }).from(entries).where(and(eq(entries.id, parsed.data.entryId), eq(entries.eventId, round.eventId))).limit(1);
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const [participant] = await db.select({ id: participants.id }).from(participants).where(and(eq(participants.userId, appUser.id), eq(participants.eventId, round.eventId))).limit(1);
    if (!participant) return NextResponse.json({ error: "Not a participant in this event" }, { status: 403 });

    const result = await startAttempt({ roundId, entryId: parsed.data.entryId, participantId: participant.id, requestId });
    return NextResponse.json({ attempt: result }, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}
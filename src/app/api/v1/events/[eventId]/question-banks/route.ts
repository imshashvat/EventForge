/**
 * GET  /api/v1/events/[eventId]/question-banks  — list banks for event
 * POST /api/v1/events/[eventId]/question-banks  — create a new bank
 *
 * Auth: event:manage (admin/organizer for this event)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, NotFoundError } from "@/core/errors";
import { db } from "@/core/db";
import { questionBanks, events } from "@/core/db/schema";
import { eq } from "drizzle-orm";


interface Params { params: Promise<{ eventId: string }> }

const createSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { eventId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId });

    const banks = await db
      .select({
        id: questionBanks.id,
        name: questionBanks.name,
        description: questionBanks.description,
        createdBy: questionBanks.createdBy,
        createdAt: questionBanks.createdAt,
        updatedAt: questionBanks.updatedAt,
      })
      .from(questionBanks)
      .where(eq(questionBanks.eventId, eventId))
      .orderBy(questionBanks.name);

    return NextResponse.json({ banks });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    // Verify event exists
    const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw new NotFoundError("Event");

    const actor = await buildActor(appUser.id);
    authorize(actor, "quiz:author", { type: "event", eventId });

    const [bank] = await db
      .insert(questionBanks)
      .values({
        eventId,
        name: parsed.data.name,
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        createdBy: appUser.id,
      })
      .returning();

    if (!bank) throw new Error("Failed to create question bank");

    return NextResponse.json({ bank }, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

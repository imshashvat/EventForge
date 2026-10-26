/**
 * GET    /api/v1/events/[eventId]     — get event by ID
 * PATCH  /api/v1/events/[eventId]     — update event fields
 * DELETE /api/v1/events/[eventId]     — archive event (soft-delete via status transition)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { getEventById, updateEvent } from "@/modules/events";
import { NotFoundError, ValidationError, toHttpError } from "@/core/errors";
import { z } from "zod";

interface Params {
  params: Promise<{ eventId: string }>;
}

const updateEventSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  tagline: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["draft", "published", "active", "paused", "completed", "archived"]).optional(),
  maxParticipants: z.number().int().positive().nullable().optional(),
  teamMode: z.enum(["individual", "team", "both"]).optional(),
  registrationMode: z.enum(["open", "approval", "closed", "invite_only"]).optional(),
  registrationOpensAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  registrationClosesAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  startsAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  endsAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { eventId } = await params;
  const event = await getEventById(eventId);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json({ event });
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(user)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "event:update", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const { name, tagline, description, maxParticipants, teamMode,
            registrationMode, status, registrationOpensAt, registrationClosesAt,
            startsAt, endsAt } = parsed.data;
    const updated = await updateEvent(
      { eventId },
      {
        ...(status !== undefined && { status }),
        ...(name !== undefined && { name }),
        ...(tagline !== undefined && { tagline }),
        ...(description !== undefined && { description }),
        ...(maxParticipants !== undefined && maxParticipants !== null && { maxParticipants }),
        ...(teamMode !== undefined && { teamMode }),
        ...(registrationMode !== undefined && { registrationMode }),
        ...(registrationOpensAt !== undefined && { registrationOpensAt }),
        ...(registrationClosesAt !== undefined && { registrationClosesAt }),
        ...(startsAt !== undefined && { startsAt }),
        ...(endsAt !== undefined && { endsAt }),
        actorId: appUserId,
        requestId,
      },
    );
    return NextResponse.json({ event: updated });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(user)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "event:lifecycle", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Archive the event instead of hard-delete (no physical delete — BR-29)
    await updateEvent({ eventId }, { status: "archived", actorId: appUserId, requestId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

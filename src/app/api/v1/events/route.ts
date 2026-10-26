/**
 * GET  /api/v1/events          — list published events
 * POST /api/v1/events          — create a new event (admin only)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { listPublishedEvents, createEvent } from "@/modules/events";
import { ConflictError, ValidationError } from "@/core/errors";
import { toHttpError } from "@/core/errors";
import { z } from "zod";

const createEventSchema = z.object({
  slug: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(200),
  tagline: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  maxParticipants: z.number().int().positive().optional(),
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  const events = await listPublishedEvents({ limit, offset });
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let appUserId: string;
  let actor: Awaited<ReturnType<typeof buildActor>>;
  try {
    appUserId = (await resolveAppUser(user)).id;
    actor = await buildActor(appUserId);
    authorize(actor, "event:create", { type: "global" });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const { slug, name, tagline, description, maxParticipants, teamMode,
            registrationMode, registrationOpensAt, registrationClosesAt,
            startsAt, endsAt } = parsed.data;
    const event = await createEvent({
      slug,
      name,
      ...(tagline !== undefined && { tagline }),
      ...(description !== undefined && { description }),
      ...(maxParticipants !== undefined && { maxParticipants }),
      ...(teamMode !== undefined && { teamMode }),
      ...(registrationMode !== undefined && { registrationMode }),
      ...(registrationOpensAt !== undefined && { registrationOpensAt }),
      ...(registrationClosesAt !== undefined && { registrationClosesAt }),
      ...(startsAt !== undefined && { startsAt }),
      ...(endsAt !== undefined && { endsAt }),
      createdBy: appUserId,
      requestId,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(
      { error: http.message, code: http.code },
      { status: http.statusCode },
    );
  }
}

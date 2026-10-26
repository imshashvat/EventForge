/**
 * GET  /api/v1/events/[eventId]/registrations — list participants (M1-B3)
 * POST /api/v1/events/[eventId]/registrations — register self for event (M1-B2)
 *
 * GET:  Paginated list of all participant records.
 *       Requires registration:read (event_admin / round_manager / reviewer).
 * POST: Register the authenticated user for the event.
 *       Requires registration:create (any authenticated user).
 *       Sends confirmation email after successful registration.
 *
 * Query params (GET only):
 *   status  — filter by status (pending|approved|rejected|waitlisted|withdrawn)
 *   limit   — default 50, max 200
 *   offset  — default 0
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { participants, users, events } from "@/core/db/schema";
import { and, eq, desc, count } from "drizzle-orm";
import { z } from "zod";
import { registerForEvent } from "@/modules/registration";
import { rateLimit } from "@/core/rate-limit";
import {
  sendMail,
  registrationConfirmationEmail,
} from "@/modules/notifications/service/email";

interface Params { params: Promise<{ eventId: string }> }

const VALID_STATUSES = ["pending", "approved", "rejected", "waitlisted", "withdrawn"] as const;
type ParticipantStatus = (typeof VALID_STATUSES)[number];

const postSchema = z.object({
  formAnswers: z.record(z.string(), z.unknown()).optional(),
  formId: z.string().uuid().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "registration:read", { type: "event", eventId });

    const sp = req.nextUrl.searchParams;
    const statusParam = sp.get("status") as ParticipantStatus | null;
    const limit = Math.min(Number(sp.get("limit") ?? "50"), 200);
    const offset = Math.max(0, Number(sp.get("offset") ?? "0"));

    if (statusParam && !VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}` },
        { status: 422 },
      );
    }

    const whereClause = statusParam
      ? and(eq(participants.eventId, eventId), eq(participants.status, statusParam))
      : eq(participants.eventId, eventId);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: participants.id,
          userId: participants.userId,
          displayName: users.displayName,
          participantNo: participants.participantNo,
          status: participants.status,
          registeredAt: participants.registeredAt,
          formAnswers: participants.formAnswers,
        })
        .from(participants)
        .innerJoin(users, eq(participants.userId, users.id))
        .where(whereClause)
        .orderBy(desc(participants.registeredAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(participants)
        .where(whereClause),
    ]);

    const total = countResult[0]?.total ?? 0;

    return NextResponse.json(
      {
        registrations: rows,
        pagination: { total, limit, offset, hasMore: offset + limit < total },
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate-limit: 5 registrations/min/user (ARCHITECTURE §17.1)
  try { await rateLimit("registration-submit", session.id); }
  catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "registration:create", { type: "event", eventId });

    const result = await registerForEvent({
      eventId,
      userId: appUser.id,
      requestId,
      ...(parsed.data.formAnswers !== undefined && { formAnswers: parsed.data.formAnswers }),
      ...(parsed.data.formId !== undefined && { formId: parsed.data.formId }),
    });

    // Fire confirmation email after commit (non-fatal)
    void (async () => {
      try {
        const [eventRow] = await db
          .select({ name: events.name, slug: events.slug })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);


        if (eventRow && session.email) {
          const emailContent = registrationConfirmationEmail({
            participantName: appUser.displayName ?? "Participant",
            eventName: eventRow.name,
            eventSlug: eventRow.slug,
            status: result.status === "pending" ? "pending" : "approved",
          });
          await sendMail({ to: session.email, ...emailContent });
        }
      } catch { /* email errors must not fail the registration */ }
    })();

    return NextResponse.json(
      {
        participantId: result.participantId,
        participantNo: result.participantNo,
        status: result.status,
      },
      { status: 201, headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

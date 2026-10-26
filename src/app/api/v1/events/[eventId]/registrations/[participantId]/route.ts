/**
 * POST /api/v1/events/[eventId]/registrations/[participantId]/review — M1-B4
 *
 * Approve, reject, or waitlist a participant registration.
 * Requires registration:review permission (event_admin / reviewer).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser, createSupabaseAdminClient } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, NotFoundError, ValidationError } from "@/core/errors";
import { writeAudit } from "@/core/audit";
import { withTx, db } from "@/core/db";
import { participants, users, events } from "@/core/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  sendMail,
  registrationStatusUpdateEmail,
} from "@/modules/notifications/service/email";

interface Params { params: Promise<{ eventId: string; participantId: string }> }

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "waitlisted"]),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, participantId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "registration:review", { type: "event", eventId });

    const { decision, reason } = parsed.data;

    const updated = await withTx(async (tx) => {
      // Fetch participant scoped to event (IDOR guard)
      const [existing] = await tx
        .select()
        .from(participants)
        .where(and(eq(participants.id, participantId), eq(participants.eventId, eventId)))
        .limit(1);

      if (!existing) throw new NotFoundError("Participant");

      // Only pending/waitlisted can be reviewed
      if (existing.status !== "pending" && existing.status !== "waitlisted") {
        throw new ValidationError(
          `Cannot review a registration with status "${existing.status}"`,
        );
      }

      const [row] = await tx
        .update(participants)
        .set({
          status: decision,
          reviewedAt: new Date(),
          reviewedBy: appUser.id,
          reviewNote: reason ?? null,
        })
        .where(and(eq(participants.id, participantId), eq(participants.eventId, eventId)))
        .returning();

      await writeAudit(
        {
          actorUserId: appUser.id,
          action: `registration.${decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "waitlist"}` as "registration.approve" | "registration.reject" | "registration.waitlist",
          targetType: "participant",
          targetId: participantId,
          eventId,
          before: { status: existing.status },
          after: { status: decision, reason: reason ?? null },
          requestId,
        },
        tx,
      );

      return row;
    });

    // Fire status update email (non-fatal, after tx commits)
    void (async () => {
      try {
        const [pRow] = await db
          .select({ userId: participants.userId, displayName: users.displayName, authUid: users.authUid })
          .from(participants)
          .innerJoin(users, eq(participants.userId, users.id))
          .where(eq(participants.id, participantId))
          .limit(1);
        const [eventRow] = await db
          .select({ name: events.name, slug: events.slug })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);

        if (pRow && eventRow) {
          // Email is stored in Supabase Auth, not in our DB — fetch via admin client
          const adminClient = createSupabaseAdminClient();
          const { data: authUser } = await adminClient.auth.admin.getUserById(pRow.authUid);
          const email = authUser?.user?.email;
          if (email) {
            const emailContent = registrationStatusUpdateEmail({
              participantName: pRow.displayName ?? "Participant",
              eventName: eventRow.name,
              eventSlug: eventRow.slug,
              newStatus: decision as "approved" | "rejected" | "waitlisted",
              reviewNote: reason ?? null,
            });
            await sendMail({ to: email, ...emailContent });
          }
        }
      } catch { /* email failure must not break the review flow */ }
    })();

    return NextResponse.json(
      {
        participantId: updated!.id,
        status: updated!.status,
        reviewedAt: updated!.reviewedAt,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

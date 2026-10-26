/**
 * Role assignment API routes for an event (M1-A4).
 *
 * POST /api/v1/events/[eventId]/roles   — Grant a role to a user
 * DELETE /api/v1/events/[eventId]/roles — Revoke a role from a user
 *
 * Requires event:assign_roles permission (event_admin or super_admin).
 * Assignable roles: event_admin, round_manager, judge, reviewer
 * (participant is auto-assigned on registration — not manually assignable here).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError, ValidationError } from "@/core/errors";
import { writeAudit } from "@/core/audit";
import { withTx } from "@/core/db";
import { roleAssignments, users } from "@/core/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

interface Params { params: Promise<{ eventId: string }> }

const ASSIGNABLE_ROLES = ["event_admin", "round_manager", "judge", "reviewer"] as const;

const roleSchema = z.object({
  userId: z.string().uuid(),
  roleKey: z.enum(ASSIGNABLE_ROLES),
  roundId: z.string().uuid().optional(),
});

// ── POST: grant role ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = roleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "event:assign_roles", { type: "event", eventId });

    const { userId, roleKey, roundId } = parsed.data;

    // Verify target user exists
    const [targetUser] = await withTx(async (tx) => {
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!u) throw new ValidationError("Target user not found");

      // Upsert — grant is idempotent
      const scopeType = roundId ? "round" : "event";
      const [assignment] = await tx
        .insert(roleAssignments)
        .values({
          userId,
          roleKey,
          scopeType,
          eventId,
          roundId: roundId ?? null,
          grantedBy: appUser.id,
        })
        .onConflictDoNothing()
        .returning();

      await writeAudit(
        {
          actorUserId: appUser.id,
          action: "role.assign",
          targetType: "role_assignment",
          targetId: assignment?.id ?? userId,
          eventId,
          after: { userId, roleKey, scopeType, roundId: roundId ?? null },
          requestId,
        },
        tx,
      );

      return [assignment];
    });

    return NextResponse.json(
      { assignment: targetUser },
      { status: 201, headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

// ── DELETE: revoke role ───────────────────────────────────────────────────────

const revokeSchema = z.object({
  userId: z.string().uuid(),
  roleKey: z.enum(ASSIGNABLE_ROLES),
  roundId: z.string().uuid().optional(),
});

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = revokeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "event:assign_roles", { type: "event", eventId });

    const { userId, roleKey, roundId } = parsed.data;

    await withTx(async (tx) => {
      const whereClause = roundId
        ? and(
            eq(roleAssignments.userId, userId),
            eq(roleAssignments.roleKey, roleKey),
            eq(roleAssignments.eventId, eventId),
            eq(roleAssignments.roundId, roundId),
          )
        : and(
            eq(roleAssignments.userId, userId),
            eq(roleAssignments.roleKey, roleKey),
            eq(roleAssignments.eventId, eventId),
          );

      await tx.delete(roleAssignments).where(whereClause);

      await writeAudit(
        {
          actorUserId: appUser.id,
          action: "role.revoke",
          targetType: "role_assignment",
          targetId: userId,
          eventId,
          before: { userId, roleKey, roundId: roundId ?? null },
          requestId,
        },
        tx,
      );
    });

    return new NextResponse(null, {
      status: 204,
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

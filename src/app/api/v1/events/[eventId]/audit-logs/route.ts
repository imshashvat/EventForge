/**
 * GET /api/v1/events/[eventId]/audit-logs
 *
 * Paginated audit log for an event. Admin-only.
 * Query params: limit (default 50, max 200), offset, action filter.
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { auditLogs } from "@/core/audit";
import { eq, and, desc, count } from "drizzle-orm";

interface Params { params: Promise<{ eventId: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const appUser = await resolveAppUser(session);
    const actor = await buildActor(appUser.id);
    authorize(actor, "event:update", { type: "event", eventId });

    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Number(sp.get("limit") ?? "50"), 200);
    const offset = Math.max(0, Number(sp.get("offset") ?? "0"));
    const actionFilter = sp.get("action");

    const whereClause = actionFilter
      ? and(eq(auditLogs.eventId, eventId), eq(auditLogs.action, actionFilter))
      : eq(auditLogs.eventId, eventId);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          actorUserId: auditLogs.actorUserId,
          actorRoleKey: auditLogs.actorRoleKey,
          action: auditLogs.action,
          targetType: auditLogs.targetType,
          targetId: auditLogs.targetId,
          before: auditLogs.before,
          after: auditLogs.after,
          reason: auditLogs.reason,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(auditLogs)
        .where(whereClause),
    ]);
    const total = totalResult[0]?.total ?? 0;

    return NextResponse.json(
      { logs: rows, total, limit, offset },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

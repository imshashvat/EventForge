/**
 * GET /api/v1/events/[eventId]/leaderboard?scope=overall|round:<id>
 *
 * ARCHITECTURE.md §15: ETag-based polling, leaderboard_policy enforcement,
 * stale-while-revalidate via snapshot service.
 *
 * Caching:
 *   public policy  → Cache-Control: public, s-maxage=5, stale-while-revalidate=10
 *   restricted     → Cache-Control: private, no-cache
 *
 * Client usage:
 *   Send If-None-Match: "<etag>" → 304 when unchanged (no body)
 *   Poll every 15s ± 20% jitter, back off to 30s after repeated 304s
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, lookupUserByAuthUid } from "@/core/auth";
import { can } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { events, entries, participants } from "@/core/db/schema";
import { and } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getOrRebuildSnapshot } from "@/modules/leaderboard/service";

interface Params { params: Promise<{ eventId: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { eventId } = await params;
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") ?? "overall";

  // Validate scope format
  if (scope !== "overall" && !scope.startsWith("round:")) {
    return NextResponse.json(
      { error: "Invalid scope. Must be 'overall' or 'round:<uuid>'" },
      { status: 400 },
    );
  }

  try {
    // Load event config
    const [event] = await db
      .select({
        id: events.id,
        status: events.status,
        settings: events.settings,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const settings = (event.settings ?? {}) as Record<string, unknown>;
    const policy = (settings["leaderboardPolicy"] as string | undefined) ?? "hidden_until_end";

    // ── Policy enforcement ────────────────────────────────────────────────────
    const sessionUser = await getSessionUser().catch(() => null);
    const appUser = sessionUser
      ? await lookupUserByAuthUid(sessionUser.id).catch(() => null)
      : null;
    const actor = appUser ? await buildActor(appUser.id).catch(() => null) : null;

    const eventScope = { type: "event" as const, eventId };
    const isStaff =
      actor &&
      (can(actor, "quiz:author", eventScope) ||
        can(actor, "judging:score", eventScope) ||
        can(actor, "leaderboard:configure", eventScope));

    let isAllowed = false;
    let isPublicPolicy = false;

    switch (policy) {
      case "public":
        isAllowed = true;
        isPublicPolicy = true;
        break;
      case "participants_only": {
        isAllowed = !!isStaff;
        if (!isAllowed && actor) {
          isAllowed = can(actor, "leaderboard:view", eventScope);
        }
        break;
      }
      case "during_rounds":
        // Authenticated participants/staff only while the event is running
        isAllowed =
          !!isStaff ||
          (event.status === "active" && !!actor && can(actor, "leaderboard:view", eventScope));
        break;
      case "hidden_until_end":
        isAllowed = !!isStaff || event.status === "completed" || event.status === "archived";
        break;
      case "staff_only":
        isAllowed = !!isStaff;
        break;
      default:
        isAllowed = !!isStaff;
    }

    if (!isAllowed) {
      // Return 403 — never reveal "not started yet" vs "staff only" (§15.5)
      return NextResponse.json({ error: "Leaderboard not available" }, { status: 403 });
    }

    // ── Fetch/rebuild snapshot ────────────────────────────────────────────────
    const snapshot = await getOrRebuildSnapshot(eventId, scope);

    // ── ETag / 304 ───────────────────────────────────────────────────────────
    const clientEtag = req.headers.get("if-none-match");
    if (clientEtag && clientEtag === `"${snapshot.etag}"`) {
      return new NextResponse(null, { status: 304 });
    }

    // ── Response ─────────────────────────────────────────────────────────────
    // Internal entry ids are staff-only (IDOR hardening). Others get entryCode.
    // The viewer's own rows are flagged only on private (non-shared-cache) responses.
    let myEntryIds = new Set<string>();
    if (!isStaff && !isPublicPolicy && appUser) {
      const mine = await db
        .select({ id: entries.id })
        .from(entries)
        .innerJoin(participants, eq(entries.participantId, participants.id))
        .where(and(eq(entries.eventId, eventId), eq(participants.userId, appUser.id)));
      myEntryIds = new Set(mine.map((m) => m.id));
    }
    const visibleEntries = snapshot.entries.map(({ entryId, ...rest }) =>
      isStaff
        ? { entryId, ...rest }
        : isPublicPolicy
          ? rest
          : { ...rest, isMe: myEntryIds.has(entryId) },
    );

    const body = {
      eventId: snapshot.eventId,
      scope: snapshot.scope,
      version: snapshot.version,
      generatedAt: snapshot.generatedAt.toISOString(),
      provisional: snapshot.provisional,
      etag: snapshot.etag,
      entries: visibleEntries,
    };

    const headers = new Headers({
      "Content-Type": "application/json",
      ETag: `"${snapshot.etag}"`,
    });

    if (isPublicPolicy) {
      headers.set("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
    } else {
      headers.set("Cache-Control", "private, no-cache");
    }

    return new NextResponse(JSON.stringify(body), { status: 200, headers });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

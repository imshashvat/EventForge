/**
 * POST /api/v1/events/[eventId]/results/runs
 *   → Trigger a new result run (dry_run or provisional).
 *     Body: { status: "dry_run"|"provisional", config?: ResultConfig }
 *     Auth: results:publish
 *
 * GET /api/v1/events/[eventId]/results/runs
 *   → List result runs for an event (most recent first).
 *     Auth: results:publish (staff) or leaderboard:view (public — only final runs)
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { runResults, getLatestFinalRun } from "@/modules/results/service";
import { toHttpError } from "@/core/errors";
import { db } from "@/core/db";
import { resultRuns } from "@/core/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import type { ResultConfig } from "@/modules/results/compute";

type Ctx = { params: Promise<{ eventId: string }> };

const RoundConfigSchema = z.object({
  roundId: z.string().uuid(),
  weight: z.number().min(0).max(1),
  include: z.boolean(),
  roundMax: z.number().positive(),
});

const ConfigSchema = z.object({
  mode: z.enum(["weighted", "sum"]),
  scale: z.number().positive().default(100),
  rounds: z.array(RoundConfigSchema).min(1),
  missingRoundPolicy: z.enum(["zero", "exclude", "rank_last"]).default("zero"),
  penaltyCap: z.number().optional(),
  tieBreak: z.array(z.string()).default([]),
  rankScope: z.enum(["active_only", "all"]).default("active_only"),
});

const PostBodySchema = z.object({
  status: z.enum(["dry_run", "provisional"]).default("dry_run"),
  config: ConfigSchema.optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

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

  let body: z.infer<typeof PostBodySchema>;
  try {
    const parsed = PostBodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await runResults({
      eventId,
      status: body.status,
      actorUserId: appUserId,
      requestId,
      configOverride: body.config as ResultConfig | undefined,
    });
    return NextResponse.json(result, { status: result.cached ? 200 : 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;

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
    const runs = isStaff
      ? await db.select().from(resultRuns)
          .where(eq(resultRuns.eventId, eventId))
          .orderBy(sql`${resultRuns.runNo} DESC`)
      : await db.select().from(resultRuns)
          .where(and(eq(resultRuns.eventId, eventId), eq(resultRuns.status, "final")))
          .orderBy(sql`${resultRuns.runNo} DESC`);

    return NextResponse.json({ runs });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

/**
 * GET  /api/v1/events/[eventId]/rounds — list rounds (authenticated)
 * POST /api/v1/events/[eventId]/rounds — create a round (round:manage)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { authorize } from "@/core/authz";
import { toHttpError } from "@/core/errors";
import { listRounds, createRound } from "@/modules/events";

interface Params { params: Promise<{ eventId: string }> }

const isoDate = z.string().datetime().transform((s) => new Date(s));

const createSchema = z.object({
  roundNo: z.number().int().positive(),
  name: z.string().min(1).max(200),
  roundType: z.enum(["quiz", "challenge", "judged"]),
  opensAt: isoDate.optional(),
  closesAt: isoDate.optional(),
  durationMs: z.number().int().positive().max(24 * 3600 * 1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rounds = await listRounds({ eventId });
    return NextResponse.json({ rounds });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let actorId: string;
  try {
    actorId = (await resolveAppUser(user)).id;
    authorize(await buildActor(actorId), "round:manage", { type: "event", eventId });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const { opensAt, closesAt, durationMs, config, ...rest } = parsed.data;
    const round = await createRound({ eventId }, {
      ...rest,
      ...(opensAt && { opensAt }),
      ...(closesAt && { closesAt }),
      ...(durationMs !== undefined && { durationMs }),
      ...(config && { config }),
      actorId,
      requestId,
    });
    return NextResponse.json({ round }, { status: 201 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json({ error: http.message, code: http.code }, { status: http.statusCode });
  }
}

/**
 * PUT  /api/v1/events/[eventId]/rounds/[roundId]/challenges/[taskId]
 *   → Save a draft revision (is_draft=true, URLs validated but not all required)
 *
 * POST /api/v1/events/[eventId]/rounds/[roundId]/challenges/[taskId]/submit
 *   → Final submission; idempotent on counted_revision_id; late flag from DB clock
 *
 * Auth: participant (quiz:attempt) for both.
 */
import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { authorize } from "@/core/authz";
import { saveDraft, submitChallenge } from "@/modules/challenges/service";
import { toHttpError } from "@/core/errors";
import { z } from "zod";

type Ctx = { params: Promise<{ eventId: string; roundId: string; taskId: string }> };

const UrlsSchema = z.object({
  githubUrl: z.string().url().optional(),
  demoUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
}).passthrough();

const BodySchema = z.object({
  entryId: z.string().uuid(),
  urls: UrlsSchema,
  notes: z.string().max(2000).optional(),
});

async function resolveAuth(req: NextRequest, eventId: string) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  let appUserId: string;
  try {
    appUserId = (await resolveAppUser(sessionUser)).id;
    const actor = await buildActor(appUserId);
    authorize(actor, "submission:create", { type: "event", eventId });
  } catch {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { appUserId: appUserId! };
}

async function parseBody(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return { error: NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 }) };
    }
    return { body: parsed.data };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

// ── PUT /draft ────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, taskId } = await params;

  const auth = await resolveAuth(req, eventId);
  if ("error" in auth) return auth.error;

  const parsed = await parseBody(req);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await saveDraft({
      taskId,
      entryId: parsed.body.entryId,
      participantId: auth.appUserId,
      urls: parsed.body.urls as import("@/modules/challenges/service").SubmissionUrlsInput,
      notes: parsed.body.notes,
      requestId: req.headers.get("idempotency-key") ?? requestId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

// ── POST /submit ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { eventId, taskId } = await params;

  const auth = await resolveAuth(req, eventId);
  if ("error" in auth) return auth.error;

  const parsed = await parseBody(req);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await submitChallenge({
      taskId,
      entryId: parsed.body.entryId,
      participantId: auth.appUserId,
      urls: parsed.body.urls as import("@/modules/challenges/service").SubmissionUrlsInput,
      notes: parsed.body.notes,
      requestId: req.headers.get("idempotency-key") ?? requestId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const http = toHttpError(err, requestId);
    return NextResponse.json(http, { status: http.statusCode });
  }
}

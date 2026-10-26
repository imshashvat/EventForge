import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/core/config";
import { timingSafeEqual } from "node:crypto";
import { claimJobs, completeJob, failJob, ensureJob } from "@/core/jobs";
import { logger } from "@/core/logger";
import { runSweeper, type SweeperPayload } from "@/modules/quiz/jobs/sweeper";
import { runLbRebuild, type LbRebuildPayload } from "@/modules/leaderboard/jobs/lb-rebuild";

/**
 * POST /api/v1/internal/jobs/tick
 *
 * Called by GitHub Actions cron (or Vercel Cron) with Authorization header.
 * Claims up to 10 ready jobs and processes them in sequence.
 *
 * Auth: Bearer <CRON_SECRET>
 * Source IP must be allowed (configured at infra level, not enforced here).
 */
export async function POST(req: NextRequest) {
  // Auth: verify CRON_SECRET bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const secret = env.CRON_SECRET ?? "";
  const valid =
    !!token &&
    secret.length > 0 &&
    token.length === secret.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(secret));

  if (!valid) {
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden" } }, { status: 403 });
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const log = logger;

  log.info("Tick started", { request_id: requestId, route: "/api/v1/internal/jobs/tick" });

  // Self-seed the recurring auto-submit sweeper: nothing else enqueues it.
  await ensureJob("sweeper");

  const claimed = await claimJobs();
  let processed = 0;
  let failed = 0;

  for (const job of claimed) {
    try {
      await processJob(job.type as string, job.payload as Record<string, unknown>, job.id);
      await completeJob(job.id);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(job.id, msg);
      log.error("Job processing failed", {
        request_id: requestId,
        error_code: "job_error",
        route: "jobs/tick",
      });
      failed++;
    }
  }

  log.info("Tick complete", {
    request_id: requestId,
    route: "/api/v1/internal/jobs/tick",
  });

  return NextResponse.json({ processed, failed, total: claimed.length });
}

/**
 * Dispatch to the appropriate job handler.
 * Each handler is imported dynamically to keep the tick function thin.
 */
async function processJob(
  type: string,
  payload: Record<string, unknown>,
  jobId: string,
): Promise<void> {
  switch (type) {
    case "sweeper": {
      const result = await runSweeper(payload as SweeperPayload, jobId);
      // Partial failures are logged inside runSweeper; only throw if 0 swept and all failed
      if (result.swept === 0 && result.failed > 0) {
        throw new Error(`Sweeper: all ${result.failed} attempt(s) failed to auto-submit`);
      }
      break;
    }
    case "email":
    case "export-chunk":
    case "cleanup":
      // Not implemented yet: fail loudly (dead-letter) rather than silently mark done.
      throw new Error(`Job type '${type}' is not implemented`);
    case "lb-rebuild": {
      const result = await runLbRebuild(payload as unknown as LbRebuildPayload, jobId);
      if (result.failed > 0 && result.rebuilt === 0 && result.skipped === 0) {
        throw new Error(`LbRebuild: all ${result.failed} scope(s) failed`);
      }
      break;
    }
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

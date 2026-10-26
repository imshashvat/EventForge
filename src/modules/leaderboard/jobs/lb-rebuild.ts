/**
 * modules/leaderboard/jobs/lb-rebuild.ts — Leaderboard rebuild job handler
 *
 * Called by POST /api/v1/internal/jobs/tick when a "lb-rebuild" job is dequeued.
 *
 * Payload shape:
 *   { eventId: string; scopes?: string[] }
 *
 * If scopes is omitted, rebuilds ["overall"] by default. Additional per-round
 * scopes (e.g. "round:<uuid>") can be added by the event lifecycle service when
 * a round closes and scores are finalised.
 *
 * The single-flight advisory lock inside getOrRebuildSnapshot() ensures that
 * even if multiple tick invocations run concurrently, only one rebuild executes
 * per (event, scope) — all others receive the previous snapshot (safe).
 */
import "server-only";
import { getOrRebuildSnapshot } from "@/modules/leaderboard/service";
import { logger } from "@/core/logger";

export interface LbRebuildPayload {
  eventId: string;
  /** Scopes to rebuild. Defaults to ["overall"]. */
  scopes?: string[];
}

export interface LbRebuildResult {
  rebuilt: number;
  skipped: number;
  failed: number;
  errors: Array<{ scope: string; error: string }>;
}

export async function runLbRebuild(
  payload: LbRebuildPayload,
  jobId: string,
): Promise<LbRebuildResult> {
  const log = logger;
  const { eventId, scopes = ["overall"] } = payload;

  if (!eventId) {
    throw new Error("lb-rebuild: missing eventId in payload");
  }

  log.info(`LbRebuild started eventId=${eventId} scopes=[${scopes.join(",")}] jobId=${jobId}`);

  let rebuilt = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ scope: string; error: string }> = [];

  for (const scope of scopes) {
    try {
      const snapshot = await getOrRebuildSnapshot(eventId, scope);

      // getOrRebuildSnapshot returns the latest snapshot (fresh or stale-served).
      // We consider it "rebuilt" if its generatedAt is within 2x min interval
      // (meaning a fresh build happened), otherwise "skipped" (served stale).
      const ageMs = Date.now() - snapshot.generatedAt.getTime();
      const minInterval = parseInt(process.env["LB_MIN_REBUILD_INTERVAL_MS"] ?? "5000", 10);

      if (ageMs <= minInterval * 2) {
        rebuilt++;
        log.info(`LbRebuild: rebuilt scope=${scope} version=${snapshot.version} entries=${snapshot.entries.length}`);
      } else {
        skipped++;
        log.info(`LbRebuild: skipped (not stale) scope=${scope} version=${snapshot.version}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push({ scope, error: msg });
      log.error(`LbRebuild: failed scope=${scope}: ${msg}`, { error_code: "lb_rebuild_error" });
    }
  }

  log.info(`LbRebuild done rebuilt=${rebuilt} skipped=${skipped} failed=${failed} jobId=${jobId}`);
  return { rebuilt, skipped, failed, errors };
}

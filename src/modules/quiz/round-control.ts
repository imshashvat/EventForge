/**
 * modules/quiz/round-control.ts — Round lifecycle control for timed quiz rounds
 *
 * R-TIME-03: pause/resume deadline extension is ONE transaction (all in-progress
 *            attempts + round.closes_at move together, or nothing does).
 * R-TIME-04: closing a round finalizes every in-progress attempt (close gate),
 *            so correctness never depends on the sweeper.
 * R-TIME-01: all durations are computed by Postgres (now()), never the app clock.
 * R-AUD-01 : audit rows are written in the same tx as the state change.
 *
 * Lives in the quiz module because it must touch quiz_attempts atomically;
 * round status itself is in the shared core schema.
 */
import "server-only";
import { withTx } from "@/core/db";
import { rounds, quizAttempts } from "@/core/db/schema";
import { writeAudit } from "@/core/audit";
import { NotFoundError, ValidationError } from "@/core/errors";
import { eq, and, sql } from "drizzle-orm";
import { submitAttempt } from "./service";

export type RoundAction = "open" | "pause" | "resume" | "close";

const ALLOWED_FROM: Record<RoundAction, string[]> = {
  open: ["draft", "published"],
  pause: ["open"],
  resume: ["paused"],
  close: ["open", "paused"],
};

const TARGET_STATUS: Record<RoundAction, string> = {
  open: "open",
  pause: "paused",
  resume: "open",
  close: "closed",
};

export interface ControlRoundInput {
  eventId: string;
  roundId: string;
  action: RoundAction;
  actorUserId: string;
  requestId: string;
}

export interface ControlRoundResult {
  status: string;
  /** Present for 'resume': milliseconds all deadlines were extended by. */
  extendedMs?: number;
  /** Present for 'close': finalization summary. Leftovers are retried by the sweeper. */
  finalized?: { submitted: number; failed: number };
}

export async function controlRound(input: ControlRoundInput): Promise<ControlRoundResult> {
  const result = await withTx(async (tx): Promise<ControlRoundResult> => {
    const [round] = await tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.id, input.roundId), eq(rounds.eventId, input.eventId)))
      .for("update");
    if (!round) throw new NotFoundError("Round");
    if (round.roundType !== "quiz" && (input.action === "pause" || input.action === "resume")) {
      throw new ValidationError("Pause/resume is only supported for quiz rounds");
    }
    if (!ALLOWED_FROM[input.action].includes(round.status)) {
      throw new ValidationError(`Cannot ${input.action} a round that is "${round.status}"`);
    }

    let extendedMs: number | undefined;

    if (input.action === "pause") {
      await tx.execute(sql`
        INSERT INTO app.round_pauses (round_id, event_id) VALUES (${input.roundId}, ${round.eventId})
      `);
    }

    if (input.action === "resume" || input.action === "close") {
      // Close the open pause interval (if any) using the DB clock.
      const closedPause = await tx.execute<{ pause_ms: string }>(sql`
        UPDATE app.round_pauses
        SET resumed_at = now(),
            pause_ms = (EXTRACT(EPOCH FROM (now() - paused_at)) * 1000)::BIGINT
        WHERE round_id = ${input.roundId} AND resumed_at IS NULL
        RETURNING pause_ms::TEXT AS pause_ms
      `);
      const pauseMs = Number(Array.from(closedPause)[0]?.pause_ms ?? 0);

      if (input.action === "resume") {
        extendedMs = pauseMs;
        if (pauseMs > 0) {
          // Atomic extension: every in-progress attempt + the round close time.
          await tx.execute(sql`
            UPDATE app.quiz_attempts
            SET deadline_at = deadline_at + make_interval(secs => ${pauseMs / 1000}),
                updated_at = now()
            WHERE round_id = ${input.roundId} AND status = 'in_progress'
          `);
          if (round.closesAt) {
            await tx.execute(sql`
              UPDATE app.rounds
              SET closes_at = closes_at + make_interval(secs => ${pauseMs / 1000})
              WHERE id = ${input.roundId}
            `);
          }
        }
      }
    }

    await tx
      .update(rounds)
      .set({ status: TARGET_STATUS[input.action], updatedAt: sql`now()` })
      .where(eq(rounds.id, input.roundId));

    await writeAudit(
      {
        actorUserId: input.actorUserId,
        action: "round.update",
        targetType: "round",
        targetId: input.roundId,
        eventId: round.eventId,
        before: { status: round.status },
        after: { status: TARGET_STATUS[input.action], action: input.action, extendedMs },
        requestId: input.requestId,
      },
      tx,
    );

    return { status: TARGET_STATUS[input.action], ...(extendedMs !== undefined && { extendedMs }) };
  });

  if (input.action === "close") {
    result.finalized = await finalizeRoundAttempts(input.roundId, input.requestId);
  }
  return result;
}

/**
 * Close gate (R-TIME-04): submit every in-progress attempt of a closed round.
 * Per-attempt failures never stop the batch; leftovers are picked up by the sweeper
 * (they are past-deadline-or-closed) and by lazy finalization.
 */
export async function finalizeRoundAttempts(
  roundId: string,
  requestId: string,
): Promise<{ submitted: number; failed: number }> {
  const pending = await withTx((tx) =>
    tx
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.roundId, roundId), eq(quizAttempts.status, "in_progress"))),
  );

  let submitted = 0;
  let failed = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + CONCURRENCY).map(async (a) => {
        try {
          await submitAttempt({ attemptId: a.id, requestId: `close-${requestId}-${a.id}` });
          submitted++;
        } catch {
          failed++;
        }
      }),
    );
  }
  return { submitted, failed };
}

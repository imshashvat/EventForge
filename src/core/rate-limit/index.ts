/**
 * core/rate-limit — Upstash Redis rate limiter (R-API-04, ARCHITECTURE.md §17.1)
 *
 * Uses sliding window algorithm. Each class maps to the limits in §17.1.
 * Fail behavior per class:
 *   - "participant-hot" (quiz save/submit): fail-open with in-memory fallback
 *   - all others: fail-closed → RateLimitError
 *
 * Usage:
 *   await rateLimit("auth-sign-in", identifier);  // throws RateLimitError if exceeded
 */
import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/core/config";
import { RateLimitError } from "@/core/errors";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// In-memory fallback for participant hot paths (fail-open, less precise)
const inMemoryStore = new Map<string, { count: number; resetAt: number }>();
function inMemoryLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = inMemoryStore.get(key);
  if (!entry || now > entry.resetAt) {
    inMemoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  entry.count++;
  return entry.count <= limit;
}

// Rate limit class definitions (ARCHITECTURE.md §17.1 — all [T])
type RateLimitClass =
  | "auth-sign-in"          // 10/min/IP + 5/min/account
  | "registration-submit"   // 5/min/user, 30/min/IP
  | "attempt-start"         // 5/min/user
  | "answer-save"           // burst 10, sustained 30/min/attempt
  | "quiz-submit"           // 10/min/entry
  | "export-create"         // 3/hour/user
  | "export-download"       // 10/hour/user
  | "admin-mutation";       // 60/min/user

const limiters: Record<RateLimitClass, Ratelimit> = {
  "auth-sign-in": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1m"),
    prefix: "rl:auth-sign-in",
  }),
  "registration-submit": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1m"),
    prefix: "rl:reg-submit",
  }),
  "attempt-start": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1m"),
    prefix: "rl:attempt-start",
  }),
  "answer-save": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "1m"),
    prefix: "rl:answer-save",
  }),
  "quiz-submit": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1m"),
    prefix: "rl:quiz-submit",
  }),
  "export-create": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1h"),
    prefix: "rl:export-create",
  }),
  "export-download": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1h"),
    prefix: "rl:export-download",
  }),
  "admin-mutation": new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "1m"),
    prefix: "rl:admin",
  }),
};

// Hot-path classes that fail-open (participant experience > strict limiting)
const FAIL_OPEN_CLASSES = new Set<RateLimitClass>(["answer-save", "quiz-submit"]);

/**
 * Enforce a rate limit. Throws RateLimitError if exceeded (fail-closed).
 * Hot-path classes silently allow requests when Redis is unavailable (fail-open).
 *
 * @param cls         The rate limit class
 * @param identifier  A stable identifier (user ID, IP, attempt ID, etc.)
 */
export async function rateLimit(
  cls: RateLimitClass,
  identifier: string,
): Promise<void> {
  if (!env.RATE_LIMIT_ENABLED) return;

  const limiter = limiters[cls];
  if (!limiter) return;

  try {
    const { success, reset } = await limiter.limit(identifier);
    if (!success) {
      const retryAfterMs = Math.max(0, reset - Date.now());
      throw new RateLimitError(retryAfterMs);
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;

    // Redis unavailable
    if (FAIL_OPEN_CLASSES.has(cls)) {
      // Fail-open: apply a rough in-memory fallback limit (30/min)
      const allowed = inMemoryLimit(identifier, 30, 60_000);
      if (!allowed) throw new RateLimitError(60_000);
      return;
    }
    // Fail-closed for auth/export
    throw new RateLimitError(60_000);
  }
}

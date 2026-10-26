/**
 * core/errors — Typed error hierarchy (ARCHITECTURE.md §17.1)
 *
 * All application errors extend AppError. Route handlers convert these to
 * HTTP responses using toHttpError(). Never include stack traces or SQL in
 * API responses (R-CODE-06).
 */

export interface HttpError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(opts: { code: string; message: string; statusCode: number; details?: unknown }) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }
}

// ── 400 Bad Request ─────────────────────────────────────────────────────────
export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super({ code: "bad_request", message, statusCode: 400, details });
    this.name = "BadRequestError";
  }
}

// ── 401 Unauthenticated ──────────────────────────────────────────────────────
export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super({ code: "unauthenticated", message, statusCode: 401 });
    this.name = "UnauthenticatedError";
  }
}

// ── 403 Forbidden ────────────────────────────────────────────────────────────
export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super({ code: "forbidden", message, statusCode: 403 });
    this.name = "ForbiddenError";
  }
}

// ── 404 Not Found ────────────────────────────────────────────────────────────
export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super({ code: "not_found", message: `${resource} not found`, statusCode: 404 });
    this.name = "NotFoundError";
  }
}

// ── 409 Conflict ─────────────────────────────────────────────────────────────
export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super({ code, message, statusCode: 409 });
    this.name = "ConflictError";
  }
}

// ── 422 Validation / Business Rule Violation ─────────────────────────────────
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ code: "validation_error", message, statusCode: 422, details });
    this.name = "ValidationError";
  }
}

// ── 429 Rate Limited ─────────────────────────────────────────────────────────
export class RateLimitError extends AppError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 60_000) {
    super({ code: "rate_limited", message: "Too many requests", statusCode: 429 });
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ── 503 Service Unavailable ──────────────────────────────────────────────────
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super({ code: "service_unavailable", message, statusCode: 503 });
    this.name = "ServiceUnavailableError";
  }
}

// Domain-specific errors
export class AttemptClosedError extends ConflictError {
  constructor() { super("Attempt is no longer accepting answers", "attempt_closed"); }
}
export class AttemptAlreadySubmittedError extends ConflictError {
  constructor() { super("Attempt has already been submitted", "attempt_already_submitted"); }
}
export class CapacityFullError extends ConflictError {
  constructor() { super("Event has reached capacity", "capacity_full"); }
}
export class AlreadyRegisteredError extends ConflictError {
  constructor() { super("Already registered for this event", "already_registered"); }
}
export class RoundNotOpenError extends ConflictError {
  constructor() { super("Round is not currently open", "round_not_open"); }
}
export class NotEligibleError extends ForbiddenError {
  constructor() { super("Not eligible for this round"); }
}
export class DeadlinePassedError extends ConflictError {
  constructor() { super("Submission deadline has passed", "deadline_passed"); }
}

/**
 * Convert any error to a safe HTTP error shape (no stack traces, no SQL).
 */
export function toHttpError(err: unknown, requestId: string): HttpError & { requestId: string } {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      requestId,
    };
  }
  // Unknown errors → opaque 500
  return {
    statusCode: 500,
    code: "internal_error",
    message: "An unexpected error occurred",
    requestId,
  };
}

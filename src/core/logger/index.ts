/**
 * core/logger — Structured JSON logger (R-CODE-07, R-CODE-08)
 *
 * All logs are emitted as JSON to stdout. Never include PII, passwords,
 * tokens, or full email addresses in log fields.
 *
 * Fields: ts, level, request_id, route, method, status, latency_ms,
 *         event_id, round_id, actor_hash, error_code, message
 */
import "server-only";
import { env } from "@/core/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  request_id?: string;
  route?: string;
  method?: string;
  status?: number;
  latency_ms?: number;
  event_id?: string;
  round_id?: string;
  actor_hash?: string;
  error_code?: string;
  [key: string]: unknown; // additional structured fields
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const configured = LEVELS[env.LOG_LEVEL as LogLevel] ?? 1;
  return (LEVELS[level] ?? 0) >= configured;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  // stdout only — never stderr for structured logs (R-CODE-08 compatible)
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};

/**
 * Create a child logger with pre-bound fields (e.g., per-request context).
 */
export function childLogger(bound: LogFields) {
  return {
    debug: (message: string, fields?: LogFields) =>
      emit("debug", message, { ...bound, ...fields }),
    info: (message: string, fields?: LogFields) =>
      emit("info", message, { ...bound, ...fields }),
    warn: (message: string, fields?: LogFields) =>
      emit("warn", message, { ...bound, ...fields }),
    error: (message: string, fields?: LogFields) =>
      emit("error", message, { ...bound, ...fields }),
  };
}

export type Logger = ReturnType<typeof childLogger>;

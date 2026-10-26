/**
 * core/config — Environment variable schema (R-CODE-02, ARCHITECTURE.md §21.3)
 * All env vars are validated at startup via Zod. Missing required vars crash
 * immediately with a clear error rather than failing silently at runtime.
 */
import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // App
  APP_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Database (pooled — transaction mode)
  DATABASE_URL: z.string().url(),
  DATABASE_READONLY_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(2),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

  // Rate limiting (optional in local dev — set RATE_LIMIT_ENABLED=false to skip)
  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal("")),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(""),
  RATE_LIMIT_ENABLED: z
    .string()
    .transform((v) => v !== "false")
    .catch(false),  // default off in dev; turn on in production

  // Email (optional in local dev — not all dev environments have SMTP)
  SMTP_HOST: z.string().optional().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  // Accepts "email@domain.com" or "Display Name <email@domain.com>" (Resend format)
  EMAIL_FROM: z
    .string()
    .refine(
      (v) => {
        const bare = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        const display = /^.+\s<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(v);
        return bare || display;
      },
      { message: "Must be an email address or 'Display Name <email>' format" },
    )
    .optional()
    .default("noreply@eventforge.local"),
  EMAIL_DAILY_CAP: z.coerce.number().int().min(1).default(300),

  // Jobs
  CRON_SECRET: z.string().min(32),

  // Observability
  SENTRY_DSN: z.string().url().optional(),

  // Tunables (all have defaults — override in prod as needed)
  ATTEMPT_SAVE_GRACE_MS: z.coerce.number().int().min(0).default(3000),
  ATTEMPT_SUBMIT_GRACE_MS: z.coerce.number().int().min(0).default(0),
  LB_MIN_REBUILD_MS: z.coerce.number().int().min(1000).default(5000),
  EXPORT_PACING_MS: z.coerce.number().int().min(0).default(150),
  EXPORT_CHUNK_ROWS: z.coerce.number().int().min(100).default(1000),
  EXPORT_FAST_PATH_ROWS: z.coerce.number().int().min(100).default(5000),

  // Feature flags
  FEATURE_REALTIME_PARTICIPANTS: z
    .string()
    .transform((v) => v === "true")
    .catch(false),
  FEATURE_EXPORT_BOM: z
    .string()
    .transform((v) => v !== "false")
    .catch(true),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[EventForge] Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

// Singleton — validated once at module load time.
// Throws at startup if any required variable is missing or invalid.
export const env = loadEnv();

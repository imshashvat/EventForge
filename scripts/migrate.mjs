/**
 * Applies all pending Drizzle migrations to Supabase.
 *
 * Supabase pooler modes:
 *  - Transaction mode (port 6543): user = postgres.{ref}  ← works with app queries
 *  - Session mode    (port 5432) : user = postgres         ← needed for DDL/migrations
 *
 * Run: node scripts/migrate.mjs
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(__dirname, "../.env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("✔ Loaded .env.local");
} catch {
  console.log("⚠ No .env.local found, using process.env");
}

// ── Build the correct session-mode URL ──────────────────────────────────────
// The stored DATABASE_MIGRATE_URL uses the Supabase pooler (port 5432, user=postgres.{ref})
// That format works for Supabase pooler session mode.
// Let's try to parse and reconstruct it correctly.

const rawUrl = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL || "";
if (!rawUrl) {
  console.error("✖ No DATABASE_MIGRATE_URL or DATABASE_URL in env");
  process.exit(1);
}

// Supabase direct connection (bypasses pooler entirely) for migrations:
// Format: postgresql://postgres:{password}@db.{ref}.supabase.co:5432/postgres
// Extract ref and password from pooler URL
const poolerMatch = rawUrl.match(/\/\/([^:]+):([^@]+)@([^:]+):(\d+)\//);
if (!poolerMatch) {
  console.error("✖ Cannot parse DATABASE_MIGRATE_URL:", rawUrl.replace(/:([^:@]+)@/, ":***@"));
  process.exit(1);
}

const [, user, password, poolerHost, port] = poolerMatch;
console.log(`  Parsed user: ${user}, host: ${poolerHost}, port: ${port}`);

// Extract the Supabase project ref from the hostname
// pooler hostname: aws-0-ap-south-1.pooler.supabase.com
// user for pooler: postgres.ssgsdkrvlpbmmgyeghbl
// Direct DB host: db.ssgsdkrvlpbmmgyeghbl.supabase.co
const refMatch = user.match(/postgres\.(.+)/);
const projectRef = refMatch ? refMatch[1] : null;

let migrateUrl;
if (projectRef) {
  // Use the direct database connection (not pooler) for migrations
  migrateUrl = `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
  console.log(`→ Using direct DB connection: postgresql://postgres:***@db.${projectRef}.supabase.co:5432/postgres`);
} else {
  // Fall back to original URL
  migrateUrl = rawUrl + (rawUrl.includes("?") ? "&" : "?") + "sslmode=require";
  console.log(`→ Using original URL: ${migrateUrl.replace(/:([^:@]+)@/, ":***@")}`);
}

// ── Connect ──────────────────────────────────────────────────────────────────
const sql = postgres(migrateUrl, {
  max: 1,
  ssl: "require",
  connect_timeout: 30,
  idle_timeout: 60,
  prepare: false,
  onnotice: (n) => console.log("  notice:", n.message),
});

// ── Quick connectivity test ──────────────────────────────────────────────────
console.log("→ Testing connection...");
try {
  const result = await sql`SELECT current_user, current_database(), version()`;
  const row = result[0];
  console.log(`  ✔ Connected as: ${row.current_user} | DB: ${row.current_database}`);
  console.log(`  ✔ PG: ${row.version.split(" ").slice(0, 2).join(" ")}`);
} catch (e) {
  console.error("✖ Connection test failed:", e.message);
  await sql.end();
  process.exit(1);
}

// ── Pre-create schemas ────────────────────────────────────────────────────────
console.log("→ Ensuring schemas exist...");
try {
  await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  console.log('  ✔ schema "drizzle" ready');
} catch (e) {
  console.log(`  ⚠ schema "drizzle": ${e.message} (may already exist or insufficient perms — continuing)`);
}
try {
  await sql`CREATE SCHEMA IF NOT EXISTS "app"`;
  console.log('  ✔ schema "app" ready');
} catch (e) {
  console.log(`  ⚠ schema "app": ${e.message} (may already exist — continuing)`);
}

// ── Run migrations ────────────────────────────────────────────────────────────
const db = drizzle(sql);
const migrationsFolder = resolve(__dirname, "../db/migrations");
console.log(`→ Applying migrations from: ${migrationsFolder}`);

try {
  await migrate(db, { migrationsFolder });
  console.log("\n✅ All migrations applied successfully!");
} catch (err) {
  console.error("\n✖ Migration failed:", err.message);
  if (err.cause) console.error("  Cause:", err.cause?.message ?? String(err.cause));
  process.exit(1);
} finally {
  await sql.end();
}

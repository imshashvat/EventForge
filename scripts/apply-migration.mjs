/**
 * Apply a specific migration SQL file directly to Supabase.
 * Usage: node scripts/apply-migration.mjs <filename>
 * Example: node scripts/apply-migration.mjs 0001_warm_bullseye.sql
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const filename = process.argv[2];
if (!filename) { console.error("Usage: node scripts/apply-migration.mjs <filename>"); process.exit(1); }

// Load .env.local
const envPath = resolve(__dirname, "../.env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim(), val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const rawUrl = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL || "";
const refMatch = rawUrl.match(/postgres\.([^:@]+)/);
const projectRef = refMatch?.[1];
const passMatch = rawUrl.match(/:([^:@]+)@/);
const password = passMatch?.[1] ?? "";

const directUrl = projectRef
  ? `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`
  : rawUrl;

const sql = postgres(directUrl, { max: 1, ssl: "require", connect_timeout: 30, prepare: false, onnotice: (n) => console.log("  notice:", n.message) });

const [{ current_user: user }] = await sql`SELECT current_user`;
console.log(`✔ Connected as: ${user}`);

const sqlFile = resolve(__dirname, "../db/migrations", filename);
const sqlContent = readFileSync(sqlFile, "utf8");
console.log(`→ Applying: ${filename} (${sqlContent.length} bytes)`);

try {
  await sql.unsafe(sqlContent);
  console.log(`✅ Migration applied: ${filename}`);
} catch (err) {
  console.error(`✖ Failed:`, err.message);
  if (err.detail) console.error("  Detail:", err.detail);
  process.exit(1);
} finally {
  await sql.end();
}

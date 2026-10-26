/**
 * Apply RLS policies dynamically — only to tables that actually exist in the app schema.
 * Then reports which tables are missing.
 *
 * Run: node scripts/apply-rls.mjs
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
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
} catch {}

const rawUrl = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL || "";
const refMatch = rawUrl.match(/postgres\.([^:@]+)/);
const projectRef = refMatch?.[1];
const passMatch = rawUrl.match(/:([^:@]+)@/);
const password = passMatch?.[1] ?? "";

const directUrl = projectRef
  ? `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`
  : rawUrl;

const sql = postgres(directUrl, { max: 1, ssl: "require", connect_timeout: 30, prepare: false, onnotice: () => {} });

// Get all tables actually in app schema
const existing = await sql`
  SELECT tablename FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename
`;
const existingNames = new Set(existing.map(r => r.tablename));
console.log(`✔ Found ${existingNames.size} tables in app schema:`, [...existingNames].join(", "));

// All expected tables
const allTables = [
  "users","role_assignments","events","event_counters",
  "registration_forms","registration_field_defs","participants",
  "participant_unique_values","teams","team_members","entries",
  "rounds","round_scoring_configs","round_pauses","entry_round_status",
  "score_records","question_banks","questions","question_versions",
  "question_options","round_questions","quiz_attempts","attempt_questions",
  "quiz_responses","leaderboard_snapshots","challenge_tasks","challenge_starts",
  "submissions","submission_revisions","evaluation_rubrics","evaluation_criteria",
  "judging_assignments","judge_evaluations","judge_evaluation_scores",
  "evaluation_resolutions","result_runs","calculated_results",
  "audit_logs","idempotency_keys","jobs","notifications","export_jobs",
  "roles","permissions","role_permissions"
];

const missingTables = allTables.filter(t => !existingNames.has(t));
if (missingTables.length > 0) {
  console.warn(`⚠ Missing tables (need migrations): ${missingTables.join(", ")}`);
}

// Only apply to existing tables
const presentTables = allTables.filter(t => existingNames.has(t));
console.log(`\n→ Applying RLS to ${presentTables.length} existing tables...`);

// Step 1: Enable RLS on all existing tables
for (const t of presentTables) {
  await sql.unsafe(`ALTER TABLE app.${t} ENABLE ROW LEVEL SECURITY`);
  process.stdout.write(`  ✔ RLS enabled: ${t}\n`);
}

// Step 2: BYPASSRLS for trusted app roles
console.log("\n→ Granting BYPASSRLS to app_rw, app_ro...");
try { await sql`ALTER ROLE app_rw BYPASSRLS`; console.log("  ✔ app_rw BYPASSRLS"); } catch (e) { console.log("  ⚠ app_rw:", e.message); }
try { await sql`ALTER ROLE app_ro BYPASSRLS`; console.log("  ✔ app_ro BYPASSRLS"); } catch (e) { console.log("  ⚠ app_ro:", e.message); }

// Step 3: Revoke anon/authenticated from app schema
console.log("\n→ Revoking anon/authenticated access from app schema...");
try { await sql.unsafe(`REVOKE ALL ON SCHEMA app FROM anon`); } catch {}
try { await sql.unsafe(`REVOKE ALL ON SCHEMA app FROM authenticated`); } catch {}
try { await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon`); } catch {}
try { await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated`); } catch {}
console.log("  ✔ Revoked");

// Step 4: Deny-by-default policies on each existing table
console.log("\n→ Creating deny-all policies for anon + authenticated...");
for (const t of presentTables) {
  // anon deny SELECT
  try {
    await sql.unsafe(`
      CREATE POLICY deny_anon_select ON app.${t}
      AS RESTRICTIVE FOR SELECT TO anon USING (false)
    `);
  } catch (e) {
    if (!e.message.includes("already exists")) console.log(`  ⚠ ${t} anon policy:`, e.message);
  }
  // authenticated deny ALL
  try {
    await sql.unsafe(`
      CREATE POLICY deny_authenticated_all ON app.${t}
      AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)
    `);
  } catch (e) {
    if (!e.message.includes("already exists")) console.log(`  ⚠ ${t} auth policy:`, e.message);
  }
}
console.log("  ✔ Deny-all policies created");

// Verification
const result = await sql`
  SELECT tablename, rowsecurity AS rls
  FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename
`;
const rlsOn = result.filter(r => r.rls).length;
console.log(`\n✅ RLS Status: ${rlsOn}/${result.length} tables have RLS enabled`);

const policies = await sql`
  SELECT tablename, count(*) as policy_count
  FROM pg_policies WHERE schemaname = 'app'
  GROUP BY tablename ORDER BY tablename
`;
console.log(`✅ ${policies.reduce((s, r) => s + Number(r.policy_count), 0)} deny policies across ${policies.length} tables`);

if (missingTables.length > 0) {
  console.log(`\n⚠ ${missingTables.length} tables still need migrations (run: node scripts/migrate.mjs after generating):`);
  console.log("  ", missingTables.join(", "));
}

await sql.end();

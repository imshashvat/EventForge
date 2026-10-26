#!/usr/bin/env node
/**
 * scripts/seed-admin.mjs
 *
 * Creates a super_admin account on the live Supabase instance.
 *
 * Usage:
 *   node scripts/seed-admin.mjs --email admin@example.com --password YourPassword123!
 *
 * What it does:
 *   1. Creates a Supabase Auth user (or skips if already exists)
 *   2. Inserts a row in app.users (identity bridge)
 *   3. Grants a global super_admin role in app.role_assignments
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import postgres from "postgres";

// ── Parse CLI args ──────────────────────────────────────────────────────────
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    email:    { type: "string" },
    password: { type: "string" },
    name:     { type: "string", default: "Super Admin" },
  },
});

if (!values.email || !values.password) {
  console.error("Usage: node scripts/seed-admin.mjs --email <email> --password <password> [--name <display name>]");
  process.exit(1);
}

// ── Load env ────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const env = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// Main client (auth admin only)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Direct Postgres for app-schema tables
const sql = postgres(env.DATABASE_MIGRATE_URL || env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  onnotice: () => {},
});

const email    = values.email.toLowerCase().trim();
const password = values.password;
const name     = values.name;

console.log(`\n🔧  EventForge Admin Seeder`);
console.log(`   Supabase: ${SUPABASE_URL}`);
console.log(`   Email:    ${email}`);
console.log(`   Name:     ${name}`);
console.log("");

// ── Step 1: Create Auth user ─────────────────────────────────────────────────
console.log("1/3  Creating Supabase Auth user…");
const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // skip email verification
  user_metadata: { display_name: name },
});

let authUserId;
if (createErr) {
  if (createErr.message?.includes("already been registered")) {
    // User already exists — look them up
    console.log("     ℹ️  Auth user already exists, fetching…");
    const { data: list } = await supabase.auth.admin.listUsers();
    const existing = list?.users?.find(u => u.email === email);
    if (!existing) {
      console.error("❌  Could not find existing user:", email);
      process.exit(1);
    }
    authUserId = existing.id;
    console.log(`     ✅  Found existing auth user: ${authUserId}`);
  } else {
    console.error("❌  Failed to create auth user:", createErr.message);
    process.exit(1);
  }
} else {
  authUserId = created.user.id;
  console.log(`     ✅  Auth user created: ${authUserId}`);
}

// ── Step 2: Upsert app.users row ─────────────────────────────────────────────
console.log("2/3  Upserting app.users record…");
try {
  // Hash the email for privacy (simple SHA-256 hex — matches resolveAppUser logic)
  const { createHash } = await import("crypto");
  const emailHash = createHash("sha256").update(email).digest("hex");

  await sql`
    INSERT INTO app.users (auth_uid, display_name, email_hash, status)
    VALUES (${authUserId}, ${name}, ${emailHash}, 'active')
    ON CONFLICT (auth_uid) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          status = 'active'
  `;
  console.log("     ✅  app.users record ready");
} catch (e) {
  console.error("❌  Failed to upsert app.users:", e.message);
  await sql.end();
  process.exit(1);
}

// ── Step 3: Grant global super_admin role ────────────────────────────────────
console.log("3/3  Granting global super_admin role…");
try {
  // Get the app.users.id (not the auth UUID) for the role assignment FK
  const [appUser] = await sql`SELECT id FROM app.users WHERE auth_uid = ${authUserId}`;
  if (!appUser) throw new Error("app.users row not found after insert");

  await sql`
    INSERT INTO app.role_assignments (user_id, role_key, scope_type)
    SELECT ${appUser.id}, 'super_admin', 'global'
    WHERE NOT EXISTS (
      SELECT 1 FROM app.role_assignments
      WHERE user_id = ${appUser.id}
        AND role_key = 'super_admin'
        AND scope_type = 'global'
    )
  `;
  console.log("     ✅  super_admin role granted");
} catch (e) {
  console.error("❌  Failed to grant super_admin role:", e.message);
  await sql.end();
  process.exit(1);
}
await sql.end();

console.log(`
✅  Admin account ready!

   Email:    ${email}
   Password: ${password}
   Role:     super_admin (global)

   Sign in at: ${SUPABASE_URL.replace("https://", "https://event-forge-pied.vercel.app").split(".")[0].replace("https://", "https://event-forge-pied.vercel.app").split("supabase")[0]}
   → https://event-forge-pied.vercel.app/sign-in
   → Then go to /admin to create your first event
`);

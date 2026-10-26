#!/usr/bin/env node
/**
 * scripts/fix-auth-config.mjs
 * Fixes the Supabase Site URL and confirms stuck users via Management API.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv();
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log(`\n🔧  Supabase Auth Config Fixer`);
console.log(`   Project: ${PROJECT_REF}`);
console.log(`   Production URL: https://event-forge-pied.vercel.app\n`);

// ── 1. Fix stuck user (shashvatt68@gmail.com) ────────────────────────────────
console.log("1/2  Checking shashvatt68@gmail.com…");
const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  },
});
const listData = await listRes.json();
const users = listData.users ?? [];
const stuckUser = users.find(u => u.email === "shashvatt68@gmail.com");

if (!stuckUser) {
  console.log("     ℹ️  User shashvatt68@gmail.com not found (may have been deleted)");
} else {
  const isConfirmed = !!stuckUser.email_confirmed_at;
  console.log(`     Found: ${stuckUser.id}`);
  console.log(`     Confirmed: ${isConfirmed ? "✅ yes" : "❌ no"}`);

  if (!isConfirmed) {
    // Force-confirm via admin PATCH
    const patchRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${stuckUser.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_confirm: true }),
    });
    const patchData = await patchRes.json();
    if (patchRes.ok) {
      console.log("     ✅  Email force-confirmed");
    } else {
      console.log("     ⚠️  Could not force-confirm:", JSON.stringify(patchData));
    }
  } else {
    console.log("     ✅  Already confirmed — user can sign in directly");
    // The issue is they never completed the app.users bridge row
    // Create their app.users row using the same seeder pattern
    console.log("     → Run: node scripts/seed-admin.mjs --email shashvatt68@gmail.com --password <their-password>");
    console.log("       (or they can just sign in at /sign-in — the app auto-creates the bridge row on first login)");
  }
}

console.log("\n2/2  Supabase Site URL fix…");
console.log("     ⚠️  The Management API requires a Supabase Personal Access Token (not service role key)");
console.log("     The Site URL must be fixed manually in the Supabase Dashboard:\n");
console.log("     👉  https://supabase.com/dashboard/project/ssgsdkrvlpbmmgyeghbl/auth/url-configuration");
console.log("");
console.log("     1. Set  Site URL  →  https://event-forge-pied.vercel.app");
console.log("     2. Add Redirect URL →  https://event-forge-pied.vercel.app/**");
console.log("     3. Click Save");
console.log("");
console.log("     This is a one-time 30-second fix in the dashboard.");
console.log("     After saving, all confirmation emails will use the production URL.\n");

/**
 * Test Upstash Redis connection for rate limiting.
 * Run: node scripts/test-redis.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim(), v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const enabled = process.env.RATE_LIMIT_ENABLED;

console.log(`RATE_LIMIT_ENABLED: ${enabled}`);
console.log(`UPSTASH_REDIS_REST_URL: ${url}`);
console.log(`UPSTASH_REDIS_REST_TOKEN: ${token ? token.slice(0, 20) + "..." : "(empty)"}`);

if (!url || !token) {
  console.error("✖ Missing Upstash credentials"); process.exit(1);
}

// Quick REST ping — SET a test key, GET it, DELETE it
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

try {
  // SET
  const setRes = await fetch(`${url}/set/eventforge:test/ping`, { method: "GET", headers });
  const setData = await setRes.json();
  console.log("SET result:", setData);

  // GET
  const getRes = await fetch(`${url}/get/eventforge:test`, { method: "GET", headers });
  const getData = await getRes.json();
  console.log("GET result:", getData);

  // DEL
  await fetch(`${url}/del/eventforge:test`, { method: "GET", headers });

  if (getData.result === "ping") {
    console.log("\n✅ Upstash Redis connected and working — rate limiting is ACTIVE");
  } else {
    console.log("\n⚠ Connected but unexpected value:", getData);
  }
} catch (e) {
  console.error("✖ Redis test failed:", e.message);
  process.exit(1);
}

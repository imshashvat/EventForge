/**
 * Test Resend email connection.
 * Run: node scripts/test-email.mjs
 * Sends a test email to a given address using the Resend API key from .env.local
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

// Load env vars
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "EventForge <onboarding@resend.dev>";
const to = process.argv[2] ?? "delivered@resend.dev"; // Resend test address

console.log(`RESEND_API_KEY: ${apiKey ? apiKey.slice(0, 10) + "..." : "(missing)"}`);
console.log(`FROM: ${from}`);
console.log(`TO: ${to}`);

if (!apiKey) {
  console.error("✖ RESEND_API_KEY not set"); process.exit(1);
}

// Call Resend REST API directly
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from,
    to,
    subject: "EventForge — Email test",
    html: `<p>This is a test email from <strong>EventForge</strong>. Your email setup is working! 🎉</p>`,
    text: "EventForge — email test. Your setup is working!",
  }),
});

const data = await res.json();
if (res.ok) {
  console.log(`\n✅ Email sent! Resend message ID: ${data.id}`);
} else {
  console.error(`\n✖ Resend error (${res.status}):`, data);
  process.exit(1);
}

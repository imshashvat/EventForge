/**
 * vitest.integration.config.ts
 *
 * Run with: npx vitest run --config vitest.integration.config.ts
 * Or add to package.json: "test:integration": "vitest run --config vitest.integration.config.ts"
 *
 * Requires: TEST_DATABASE_URL env var pointing to a real Postgres DB.
 * Tests run serially (pool=1) to prevent connection exhaustion on Supabase.
 */
import { defineConfig } from "vitest/config";
import path from "path";
import { readFileSync } from "fs";
import { resolve } from "path";

// Vitest workers don't auto-load .env.local — do it manually.
// Parse key=value pairs and inject into process.env.
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on environment variables set externally
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["tests/unit/**", "tests/e2e/**"],
    // Each test gets 30s — DB ops are slow in CI
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Serial: prevents connection pool exhaustion (Supabase free: max 60 conn)
    maxWorkers: 1,
    // Capture globalSetup errors clearly
    reporters: ["verbose"],
    // Mock server-only so modules importing it don't crash outside Next.js
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(import.meta.dirname, "./src/__mocks__/server-only.ts"),
    },
  },
});

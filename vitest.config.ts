import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({

  test: {
    globals: true,
    environment: "node",
    // Unit tests: no DB, no network
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.spec.ts", "tests/unit/**/*.test.ts"],
    exclude: ["tests/integration/**", "tests/e2e/**", "tests/security/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/*.config.*",
        "**/index.ts", // barrel files
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});

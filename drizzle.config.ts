import { type Config } from "drizzle-kit";

export default {
  schema: "./src/core/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_MIGRATE_URL"] ?? process.env["DATABASE_URL"] ?? "",
  },
  // Only manage tables in the app schema, not Supabase internals
  schemaFilter: ["app"],
  verbose: true,
  strict: true,
} satisfies Config;

import postgres from "postgres";
import { readFileSync } from "fs";

const lines = readFileSync(".env.local", "utf8").split("\n");
for (const l of lines) {
  const eq = l.indexOf("=");
  if (eq > 0) {
    const k = l.slice(0, eq).trim(), v = l.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const sql = postgres(
  "postgresql://postgres:Shashvat%40071817@db.ssgsdkrvlpbmmgyeghbl.supabase.co:5432/postgres?sslmode=require",
  { max: 1, ssl: "require", prepare: false }
);

const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='app' ORDER BY table_name`;
console.log("Tables in app schema:", tables.map(x => x.table_name).join(", "));

const migrations = await sql`SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at`;
console.log("\nApplied migrations:", migrations.map(x => x.name).join(", "));

await sql.end();

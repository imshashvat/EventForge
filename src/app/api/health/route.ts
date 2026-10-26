import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/health
 *
 * Shallow: just returns 200 (used by uptime monitors for basic availability)
 * Deep:    ?deep=1 — pings DB; returns component statuses
 */
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
  }

  const checks: Record<string, "ok" | "error"> = {};

  // DB check
  try {
    await db.execute(sql`SELECT 1`);
    checks["db"] = "ok";
  } catch {
    checks["db"] = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}

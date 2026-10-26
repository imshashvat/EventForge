/**
 * tests/integration/quiz/leaderboard-watermark.test.ts — Phase 2 audit fixes
 *
 * W1: no new scores => no new snapshot version (ETag stable, no unbounded growth)
 * W2: penalty / admin_adjust rows ADD to the base score (do not replace it)
 * W3: a new score row bumps the version
 * W4: DB rejects a second quiz_auto row for the same attempt (idempotency)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeRound, makeParticipant, makeEntry,
} from "../../fixtures/factory";
import { scoreRecords } from "@/core/db/schema";
import { getOrRebuildSnapshot } from "@/modules/leaderboard/service";

process.env["LB_MIN_REBUILD_INTERVAL_MS"] = "0";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

let ids: Record<string, string[]> = {};
const track = (t: string, id: string) => { (ids[t] ??= []).push(id); };

afterEach(async () => {
  const ev = ids["app.events"] ?? [];
  if (ev.length) {
    const list = ev.map((i) => `'${i}'`).join(",");
    await testDb.execute(sql.raw(`DELETE FROM app.leaderboard_snapshots WHERE event_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
    for (const t of ["app.score_records", "app.entries", "app.participants", "app.rounds"]) {
      await testDb.execute(sql.raw(`DELETE FROM ${t} WHERE event_id = ANY(ARRAY[${list}]::uuid[])`)).catch(() => {});
    }
  }
  const toDelete: Record<string, string[]> = {};
  for (const t of ["app.events", "app.users"]) if (ids[t]?.length) toDelete[t] = ids[t]!;
  if (Object.keys(toDelete).length) await deleteIds(toDelete).catch(() => {});
  ids = {};
});

async function seed() {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  const round = await makeRound(testDb, event.id, admin.id, { status: "open" });
  const u = await makeUser(testDb);
  track("app.users", u.id);
  const p = await makeParticipant(testDb, u.id, event.id);
  const entry = await makeEntry(testDb, event.id, p.id);
  return { event, round, entry };
}

async function addScore(
  eventId: string, roundId: string, entryId: string,
  source: string, finalScore: string, ref?: string,
) {
  const [row] = await testDb.insert(scoreRecords).values({
    eventId, roundId, entryId, source,
    rawScore: finalScore, finalScore,
    ...(ref !== undefined && { sourceRefId: ref }),
  }).returning({ id: scoreRecords.id });
  return row!;
}

describe("Phase 2: leaderboard watermark & aggregation", () => {
  it("W1 — unchanged scores do not create a new snapshot version", async () => {
    const { event, round, entry } = await seed();
    await addScore(event.id, round.id, entry.id, "quiz_auto", "10", crypto.randomUUID());
    const a = await getOrRebuildSnapshot(event.id, "overall");
    const b = await getOrRebuildSnapshot(event.id, "overall");
    const c = await getOrRebuildSnapshot(event.id, "overall");
    expect(b.version).toBe(a.version);
    expect(c.etag).toBe(a.etag);
  });

  it("W2 — penalty adds to the base score", async () => {
    const { event, round, entry } = await seed();
    await addScore(event.id, round.id, entry.id, "quiz_auto", "10", crypto.randomUUID());
    await addScore(event.id, round.id, entry.id, "penalty", "-2");
    const snap = await getOrRebuildSnapshot(event.id, "overall");
    expect(Number(snap.entries[0]!.finalScore)).toBe(8);
  });

  it("W3 — a new score row bumps the version", async () => {
    const { event, round, entry } = await seed();
    await addScore(event.id, round.id, entry.id, "quiz_auto", "5", crypto.randomUUID());
    const a = await getOrRebuildSnapshot(event.id, "overall");
    await addScore(event.id, round.id, entry.id, "admin_adjust", "1");
    const b = await getOrRebuildSnapshot(event.id, "overall");
    expect(b.version).toBe(a.version + 1);
    expect(Number(b.entries[0]!.finalScore)).toBe(6);
  });

  it("W4 — a second quiz_auto row for the same attempt is rejected by the DB", async () => {
    const { event, round, entry } = await seed();
    const ref = crypto.randomUUID();
    await addScore(event.id, round.id, entry.id, "quiz_auto", "3", ref);
    await expect(addScore(event.id, round.id, entry.id, "quiz_auto", "3", ref)).rejects.toThrow();
  });
});

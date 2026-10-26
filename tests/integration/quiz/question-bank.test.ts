/**
 * Suite 1 — Question Bank CRUD
 *
 * Tests the question bank service layer via direct DB inserts/selects.
 * We bypass the HTTP layer (auth middleware) and test business logic:
 *   - Create bank for event
 *   - List banks ordered by name
 *   - Cross-event isolation (bank only visible in its own event)
 *   - Multiple banks with same name allowed (no unique constraint on name)
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/quiz/question-bank.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "../setup";
import {
  makeUser, makeEvent, makeBank,
} from "../../fixtures/factory";
import { questionBanks } from "@/core/db/schema";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

// ── Per-test cleanup tracker ──────────────────────────────────────────────────

let cleanupIds: Record<string, string[]> = {};

function track(table: string, id: string) {
  if (!cleanupIds[table]) cleanupIds[table] = [];
  cleanupIds[table]!.push(id);
}

afterEach(async () => {
  const eventIds = cleanupIds["app.events"] ?? [];
  if (eventIds.length > 0) {
    const idList = eventIds.map((id) => `'${id}'`).join(",");
    await testDb.execute(sql.raw(
      `DELETE FROM app.question_banks WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`,
    )).catch(() => {});
  }
  const ordered = ["app.question_banks", "app.events", "app.users"];
  const toDelete: Record<string, string[]> = {};
  for (const table of ordered) {
    if (cleanupIds[table]?.length) toDelete[table] = cleanupIds[table]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

// ── Test helpers ──────────────────────────────────────────────────────────────

async function seedBase() {
  const admin = await makeUser(testDb);
  track("app.users", admin.id);
  const event = await makeEvent(testDb, admin.id);
  track("app.events", event.id);
  return { admin, event };
}

// ── Suite 1 ───────────────────────────────────────────────────────────────────

describe("1: Question Bank CRUD", () => {
  it("1.1 — create bank returns id and eventId", async () => {
    const { admin, event } = await seedBase();

    const bank = await makeBank(testDb, event.id, admin.id, { name: "Alpha Bank" });
    track("app.question_banks", bank.id);

    expect(bank.id).toBeTruthy();
    expect(bank.eventId).toBe(event.id);
    expect(bank.name).toBe("Alpha Bank");
    expect(bank.createdBy).toBe(admin.id);
  });

  it("1.2 — duplicate bank name in the same event is rejected (unique event_id+name)", async () => {
    const { admin, event } = await seedBase();

    const b1 = await makeBank(testDb, event.id, admin.id, { name: "Duplicate Bank" });
    track("app.question_banks", b1.id);

    await expect(
      makeBank(testDb, event.id, admin.id, { name: "Duplicate Bank" }),
    ).rejects.toThrow();

    // Same name in a different event is fine
    const admin2 = await makeUser(testDb);
    track("app.users", admin2.id);
    const event2 = await makeEvent(testDb, admin2.id);
    track("app.events", event2.id);
    const b3 = await makeBank(testDb, event2.id, admin2.id, { name: "Duplicate Bank" });
    track("app.question_banks", b3.id);
    expect(b3.id).not.toBe(b1.id);
  });

  it("1.3 — list banks returns created banks ordered by name", async () => {
    const { admin, event } = await seedBase();

    const b1 = await makeBank(testDb, event.id, admin.id, { name: "Zeta" });
    const b2 = await makeBank(testDb, event.id, admin.id, { name: "Alpha" });
    const b3 = await makeBank(testDb, event.id, admin.id, { name: "Mu" });
    for (const b of [b1, b2, b3]) track("app.question_banks", b.id);

    const banks = await testDb
      .select({ id: questionBanks.id, name: questionBanks.name })
      .from(questionBanks)
      .where(eq(questionBanks.eventId, event.id))
      .orderBy(questionBanks.name);

    // Should be Alpha, Mu, Zeta
    expect(banks.length).toBeGreaterThanOrEqual(3);
    const names = banks.map((b) => b.name);
    expect(names.indexOf("Alpha")).toBeLessThan(names.indexOf("Mu"));
    expect(names.indexOf("Mu")).toBeLessThan(names.indexOf("Zeta"));
  });

  it("1.4 — cross-event isolation: bank is NOT visible in a different event", async () => {
    const { admin, event: eventA } = await seedBase();

    // Create a second event
    const admin2 = await makeUser(testDb);
    track("app.users", admin2.id);
    const eventB = await makeEvent(testDb, admin2.id);
    track("app.events", eventB.id);

    const bank = await makeBank(testDb, eventA.id, admin.id, { name: "Event A Bank" });
    track("app.question_banks", bank.id);

    // Event B should NOT see Event A's bank
    const banksInB = await testDb
      .select({ id: questionBanks.id })
      .from(questionBanks)
      .where(eq(questionBanks.eventId, eventB.id));

    const ids = banksInB.map((b) => b.id);
    expect(ids).not.toContain(bank.id);
  });

  it("1.5 — bank stores description when provided", async () => {
    const { admin, event } = await seedBase();

    const bank = await makeBank(testDb, event.id, admin.id, {
      name: "Described Bank",
      description: "A bank with a description",
    });
    track("app.question_banks", bank.id);

    const [row] = await testDb
      .select({ description: questionBanks.description })
      .from(questionBanks)
      .where(eq(questionBanks.id, bank.id));

    expect(row?.description).toBe("A bank with a description");
  });
});

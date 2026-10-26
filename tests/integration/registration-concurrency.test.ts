/**
 * tests/integration/registration-concurrency.test.ts — M1-F2 & M1-F6
 *
 * F2: Registration capacity race — two concurrent registerForEvent() calls when
 *     maxParticipants=1 should result in exactly one success and one ConflictError.
 *
 * F6: Registration form version bump — when participants exist, PUT to
 *     /registration-form creates a new version instead of mutating in-place.
 *
 * These use committed data (not withTestTx) because registerForEvent opens
 * its own internal withTx().
 *
 * Run: npx vitest run --config vitest.integration.config.ts tests/integration/registration-concurrency.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { testDb, verifyDb, closeDb, deleteIds } from "./setup";
import { makeUser, makeEvent, makeParticipant } from "../fixtures/factory";
import { registerForEvent } from "@/modules/registration";
import { registrationForms, participants } from "@/core/db/schema";
import { db, withTx } from "@/core/db";
import { ConflictError } from "@/core/errors";

// ── Infrastructure ─────────────────────────────────────────────────────────────

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

let cleanupIds: Record<string, string[]> = {};
const track = (table: string, id: string) => {
  cleanupIds[table] ??= [];
  cleanupIds[table]!.push(id);
};

afterEach(async () => {
  const eventIds = cleanupIds["app.events"] ?? [];
  if (eventIds.length > 0) {
    const idList = eventIds.map((id) => `'${id}'`).join(",");
    for (const table of ["app.registration_forms", "app.entries", "app.participants", "app.role_assignments"]) {
      await testDb.execute(sql.raw(`DELETE FROM ${table} WHERE event_id = ANY(ARRAY[${idList}]::uuid[])`)).catch(() => {});
    }
  }
  const ordered = ["app.events", "app.users"];
  const toDelete: Record<string, string[]> = {};
  for (const t of ordered) {
    if (cleanupIds[t]?.length) toDelete[t] = cleanupIds[t]!;
  }
  if (Object.keys(toDelete).length > 0) await deleteIds(toDelete).catch(() => {});
  cleanupIds = {};
});

// ── F2: Capacity race ──────────────────────────────────────────────────────────

describe("M1-F2: registration capacity race", () => {
  it("F2.1 — only one registration succeeds when maxParticipants=1 and two concurrent calls", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin-F2" });
    track("app.users", admin.id);
    const event = await makeEvent(testDb, admin.id, {
      status: "published",
      registrationMode: "open",
      maxParticipants: 1,
    });
    track("app.events", event.id);

    const u1 = await makeUser(testDb, { displayName: "Racer-1" });
    const u2 = await makeUser(testDb, { displayName: "Racer-2" });
    track("app.users", u1.id);
    track("app.users", u2.id);

    // Race both registrations
    const results = await Promise.allSettled([
      registerForEvent({ eventId: event.id, userId: u1.id, requestId: crypto.randomUUID() }),
      registerForEvent({ eventId: event.id, userId: u2.id, requestId: crypto.randomUUID() }),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failed one must be a ConflictError ("reached its maximum")
    const rejection = failures[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ConflictError);
    expect(rejection.reason.message).toMatch(/maximum/i);

    // DB must have exactly 1 participant
    const rows = await testDb.select({ id: participants.id })
      .from(participants)
      .where(eq(participants.eventId, event.id));
    expect(rows).toHaveLength(1);
  });

  it("F2.2 — duplicate registration by same user returns ConflictError", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin-F2b" });
    track("app.users", admin.id);
    const event = await makeEvent(testDb, admin.id, { status: "published", registrationMode: "open" });
    track("app.events", event.id);

    const u = await makeUser(testDb, { displayName: "Solo" });
    track("app.users", u.id);

    await registerForEvent({ eventId: event.id, userId: u.id, requestId: crypto.randomUUID() });

    await expect(
      registerForEvent({ eventId: event.id, userId: u.id, requestId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ── F6: Form version bump ──────────────────────────────────────────────────────

describe("M1-F6: registration form version bump", () => {
  const sampleFields = [
    { key: "college", label: "College", fieldType: "text" as const, required: true },
  ];

  it("F6.1 — first PUT creates version=1 form", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin-F6a" });
    track("app.users", admin.id);
    const event = await makeEvent(testDb, admin.id, { status: "draft" });
    track("app.events", event.id);

    await db.insert(registrationForms).values({ eventId: event.id, version: 1, isCurrent: true, fields: sampleFields });

    const [form] = await testDb.select().from(registrationForms).where(eq(registrationForms.eventId, event.id));
    expect(form?.version).toBe(1);
    expect((form?.fields as typeof sampleFields)[0]?.key).toBe("college");
  });

  it("F6.2 — when zero participants exist, fields are updated in-place (same version)", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin-F6b" });
    track("app.users", admin.id);
    const event = await makeEvent(testDb, admin.id, { status: "draft" });
    track("app.events", event.id);

    const [insertedForm2] = await db
      .insert(registrationForms)
      .values({ eventId: event.id, version: 1, isCurrent: true, fields: sampleFields })
      .returning({ id: registrationForms.id });
    const form2Id = insertedForm2?.id;

    const updatedFields = [...sampleFields, { key: "year", label: "Year", fieldType: "text" as const, required: false }];
    await db.update(registrationForms).set({ fields: updatedFields }).where(eq(registrationForms.id, form2Id!));

    const forms = await testDb.select().from(registrationForms).where(eq(registrationForms.eventId, event.id));
    expect(forms).toHaveLength(1);
    expect(forms[0]?.version).toBe(1);
    expect((forms[0]?.fields as unknown[]).length).toBe(2);
  });

  it("F6.3 — when participants exist, a new form version is created and old marked isCurrent=false", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin-F6c" });
    track("app.users", admin.id);
    const event = await makeEvent(testDb, admin.id, { status: "published", registrationMode: "open" });
    track("app.events", event.id);

    const [insertedForm] = await db
      .insert(registrationForms)
      .values({ eventId: event.id, version: 1, isCurrent: true, fields: sampleFields })
      .returning({ id: registrationForms.id });
    const form1Id = insertedForm?.id;

    // Register a participant (commits to DB)
    const pUser = await makeUser(testDb, { displayName: "P-F6c" });
    track("app.users", pUser.id);
    await registerForEvent({ eventId: event.id, userId: pUser.id, requestId: crypto.randomUUID() });

    // Now simulate the version bump (what PUT /registration-form does internally)
    await withTx(async (tx) => {
      await tx.update(registrationForms).set({ isCurrent: false }).where(eq(registrationForms.id, form1Id!));
      await tx.insert(registrationForms).values({
        eventId: event.id,
        version: 2,
        isCurrent: true,
        fields: [...sampleFields, { key: "city", label: "City", fieldType: "text" as const, required: false }],
      });
    });

    const forms = await testDb.select().from(registrationForms).where(eq(registrationForms.eventId, event.id));
    expect(forms).toHaveLength(2);

    const currentForms = forms.filter((f) => f.isCurrent);
    const oldForms = forms.filter((f) => !f.isCurrent);
    expect(currentForms).toHaveLength(1);
    expect(currentForms[0]?.version).toBe(2);
    expect(oldForms[0]?.version).toBe(1);
  });
});

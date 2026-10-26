/**
 * tests/integration/identity-registration.test.ts — Phase 1 identity bridge
 *
 * Covers: resolveAppUser JIT provisioning (idempotent + concurrent),
 * registerForEvent granting an event-scoped participant role + entry,
 * suspended users rejected by buildActor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { testDb, verifyDb, closeDb } from "./setup";
import { makeUser, makeEvent } from "../fixtures/factory";
import { resolveAppUser, buildActor } from "@/core/auth";
import { registerForEvent } from "@/modules/registration";
import { users, roleAssignments, entries, participants } from "@/core/db/schema";

beforeAll(async () => { await verifyDb(); });
afterAll(async () => { await closeDb(); });

describe("Phase 1: identity bridge", () => {
  it("I1 — first sign-in provisions app user; repeated/concurrent calls yield one row", async () => {
    const authUid = crypto.randomUUID();
    const email = `new-${authUid}@example.com`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => resolveAppUser({ id: authUid, email })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);

    const rows = await testDb.select().from(users).where(eq(users.authUid, authUid));
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).not.toBe(authUid); // app id is distinct from auth uid
    expect(rows[0]!.emailHash).not.toContain("@"); // PII not stored in clear
  });

  it("I2 — registration creates participant, entry and event-scoped participant role", async () => {
    const admin = await makeUser(testDb, { displayName: "Admin" });
    const event = await makeEvent(testDb, admin.id, { status: "published", registrationMode: "open" });
    const player = await resolveAppUser({
      id: crypto.randomUUID(), email: `p-${crypto.randomUUID()}@example.com`,
    });

    const reg = await registerForEvent({
      eventId: event.id, userId: player.id, requestId: crypto.randomUUID(),
    });
    expect(reg.status).toBe("approved");

    const [entry] = await testDb.select().from(entries)
      .where(and(eq(entries.eventId, event.id), eq(entries.participantId, reg.participantId)));
    expect(entry?.entryType).toBe("individual");

    const actor = await buildActor(player.id);
    expect(actor.assignments).toContainEqual({
      roleKey: "participant", scopeType: "event", eventId: event.id,
    });

    await expect(registerForEvent({
      eventId: event.id, userId: player.id, requestId: crypto.randomUUID(),
    })).rejects.toThrow(/already registered/i);

    const roles = await testDb.select().from(roleAssignments)
      .where(and(eq(roleAssignments.userId, player.id), eq(roleAssignments.eventId, event.id)));
    expect(roles.length).toBe(1);
    const parts = await testDb.select().from(participants).where(eq(participants.userId, player.id));
    expect(parts.length).toBe(1);
  });

  it("I3 — suspended user cannot build an actor", async () => {
    const u = await makeUser(testDb, { displayName: "Sus" });
    await testDb.update(users).set({ status: "suspended" }).where(eq(users.id, u.id));
    await expect(buildActor(u.id)).rejects.toThrow(/not active/i);
  });
});

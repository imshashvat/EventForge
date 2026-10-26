/**
 * modules/registration — types, service, and barrel.
 *
 * Implements the Registration Workflow from ARCHITECTURE.md §9.2:
 *   1. Check event published + window open
 *   2. Check not already registered
 *   3. Check capacity (SELECT FOR UPDATE on events row)
 *   4. Increment event_counters (participant_no)
 *   5. Insert participant + entry
 *   6. Set status pending|approved based on registrationMode
 *   All in a single transaction.
 */
import "server-only";

import { db, withTx } from "@/core/db";
import { participants, events, eventCounters, entries, roleAssignments } from "@/core/db/schema";
import { dbNow } from "@/core/clock";
import { writeAudit } from "@/core/audit";
import { ConflictError, ValidationError, NotFoundError } from "@/core/errors";
import { and, eq, sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegisterInput {
  eventId: string;
  userId: string;
  formAnswers?: Record<string, unknown>;
  formId?: string;
  requestId: string;
}

export interface RegistrationResult {
  participantId: string;
  participantNo: number;
  status: "pending" | "approved" | "waitlisted";
}

// ── Service function ──────────────────────────────────────────────────────────

/**
 * Register a user for an event.
 *
 * Implements ARCHITECTURE.md §9.2 workflow atomically in a single transaction.
 * Concurrency safety: event row is locked with SELECT FOR UPDATE before
 * capacity check to prevent race conditions.
 */
export async function registerForEvent(
  input: RegisterInput,
): Promise<RegistrationResult> {
  return withTx(async (tx) => {
    // 1. Lock event row for update (concurrency safety)
    const [evt] = await tx
      .select()
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");

    if (!evt) throw new NotFoundError("Event");

    // 2. Check event is accepting registrations
    const now = await dbNow(tx);
    if (evt.status !== "published" && evt.status !== "active") {
      throw new ValidationError("Event is not accepting registrations");
    }
    if (evt.registrationMode === "closed" || evt.registrationMode === "invite_only") {
      throw new ValidationError("Registrations are currently closed for this event");
    }
    const windowOpen =
      (evt.registrationOpensAt == null || evt.registrationOpensAt <= now) &&
      (evt.registrationClosesAt == null || evt.registrationClosesAt > now);
    if (!windowOpen) {
      throw new ValidationError("Registration window is not open");
    }

    // 3. Check not already registered
    const [existing] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.eventId, input.eventId),
          eq(participants.userId, input.userId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError("You are already registered for this event");
    }

    // 4. Capacity check
    if (evt.maxParticipants != null) {
      const [counter] = await tx
        .select({ value: eventCounters.value })
        .from(eventCounters)
        .where(
          and(
            eq(eventCounters.eventId, input.eventId),
            eq(eventCounters.counterKey, "participant_no"),
          ),
        )
        .limit(1);

      const currentCount = counter?.value ?? 0;
      if (currentCount >= evt.maxParticipants) {
        throw new ConflictError(
          "This event has reached its maximum number of participants",
        );
      }
    }

    // 5. Increment participant counter atomically
    await tx
      .insert(eventCounters)
      .values({ eventId: input.eventId, counterKey: "participant_no", value: 1 })
      .onConflictDoUpdate({
        target: [eventCounters.eventId, eventCounters.counterKey],
        set: { value: sql`${eventCounters.value} + 1` },
      });

    const [updatedCounter] = await tx
      .select({ value: eventCounters.value })
      .from(eventCounters)
      .where(
        and(
          eq(eventCounters.eventId, input.eventId),
          eq(eventCounters.counterKey, "participant_no"),
        ),
      );
    const participantNo = updatedCounter?.value ?? 1;

    // 6. Determine initial status
    // auto-approve for 'open' mode, 'pending' for 'approval' mode
    const participantStatus = evt.registrationMode === "approval" ? "pending" : "approved";

    // 7. Insert participant
    const [newParticipant] = await tx
      .insert(participants)
      .values({
        eventId: input.eventId,
        userId: input.userId,
        participantNo,
        status: participantStatus,
        formAnswers: input.formAnswers ?? {},
        formId: input.formId,
      })
      .returning({ id: participants.id, participantNo: participants.participantNo });

    if (!newParticipant) throw new Error("Failed to create participant record");

    // 8. Create individual entry (team assignment is a separate step)
    await tx
      .insert(entries)
      .values({
        eventId: input.eventId,
        entryType: "individual",
        participantId: newParticipant.id,
      });

    // 8b. Event-scoped participant role so authorize("attempt:take") works.
    // Pending/rejected participants are still blocked by status checks in services.
    await tx.insert(roleAssignments).values({
      userId: input.userId,
      roleKey: "participant",
      scopeType: "event",
      eventId: input.eventId,
      grantedBy: input.userId,
    });

    // 9. Audit log
    await writeAudit(
      {
        actorUserId: input.userId,
        action: "registration.create",
        targetType: "participant",
        targetId: newParticipant.id,
        eventId: input.eventId,
        after: { participantNo, status: participantStatus },
        requestId: input.requestId,
      },
      tx,
    );

    return {
      participantId: newParticipant.id,
      participantNo: Number(newParticipant.participantNo),
      status: participantStatus as RegistrationResult["status"],
    };
  });
}

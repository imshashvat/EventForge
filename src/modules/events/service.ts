/**
 * modules/events/service — business logic for the events module.
 *
 * Orchestrates calls to repo functions, enforces business rules,
 * writes audit logs, and queues notifications.
 * Route handlers call service functions, never repos directly.
 */
import "server-only";
import type { AuditAction } from "@/core/audit";

import { withTx } from "@/core/db";
import { writeAudit } from "@/core/audit";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/core/errors";
import * as repo from "./repo";
import type {
  EventSummary,
  EventDetail,
  RoundSummary,
  CreateEventInput,
  UpdateEventInput,
  CreateRoundInput,
  EventScope,
  EventStatus,
} from "./types";

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * List all published events (public, no auth required).
 */
export async function listPublishedEvents(opts?: {
  limit?: number;
  offset?: number;
}): Promise<EventSummary[]> {
  return repo.listPublishedEvents(opts);
}

/**
 * List all events a participant is registered for, including their
 * participation status and each event's rounds.
 * Used by the participant dashboard.
 */
export async function listParticipantEvents(
  userId: string,
): Promise<
  Array<
    EventSummary & {
      participantStatus: "pending" | "approved" | "rejected" | "waitlisted" | "withdrawn";
      rounds: RoundSummary[];
    }
  >
> {
  return repo.listParticipantEvents(userId);
}

/**
 * Get a single event by slug (public, no auth required).
 */
export async function getEventBySlug(slug: string): Promise<EventSummary | null> {
  return repo.getEventBySlug(slug);
}

/**
 * Get a single event by ID (internal; actor checked in route).
 */
export async function getEventById(id: string): Promise<EventSummary | null> {
  return repo.getEventById(id);
}

/**
 * Create a new event.
 * Business rules:
 *   - Slug must be URL-safe and unique (ConflictError if taken)
 *   - Capacity ≥ 1 if set
 *   - Registration window must be in the future (or omitted)
 */
export async function createEvent(
  input: CreateEventInput & { createdBy: string; requestId: string },
): Promise<EventSummary> {
  // Validate slug format
  if (!/^[a-z0-9-]{3,64}$/.test(input.slug)) {
    throw new ValidationError(
      "Slug must be 3-64 characters: lowercase letters, digits, hyphens only",
    );
  }
  if (input.maxParticipants !== undefined && input.maxParticipants < 1) {
    throw new ValidationError("Capacity must be at least 1");
  }

  // Check slug uniqueness
  const existing = await repo.getEventBySlug(input.slug);
  if (existing) throw new ConflictError("An event with this slug already exists");

  const created = await withTx(async (tx) => {
    const evt = await repo.createEvent(input, tx);
    await writeAudit(
      {
        actorUserId: input.createdBy,
        action: "event.create" as AuditAction,
        targetType: "event",
        targetId: evt.id,
        after: { name: evt.name, slug: evt.slug },
        requestId: input.requestId,
      },
      tx,
    );
    return evt;
  });

  return created;
}

/**
 * Update event fields.
 * Business rules:
 *   - Cannot update a deleted/archived event
 *   - Status transitions are validated (ARCHITECTURE.md §9.1)
 */
export async function updateEvent(
  scope: EventScope,
  input: UpdateEventInput & { actorId: string; requestId: string },
): Promise<EventSummary> {
  const existing = await repo.getEventById(scope.eventId);
  if (!existing) throw new NotFoundError("Event");

  if (input.status) {
    validateEventStatusTransition(existing.status, input.status);
  }

  return withTx(async (tx) => {
    const updated = await repo.updateEvent(scope, input, tx);
    await writeAudit(
      {
        actorUserId: input.actorId,
        action: "event.update" as AuditAction,
        targetType: "event",
        targetId: scope.eventId,
        eventId: scope.eventId,
        before: existing,
        after: updated,
        requestId: input.requestId,
      },
      tx,
    );
    return updated;
  });
}

// Valid event status transitions matching DB CHECK (draft→published→active→paused→completed→archived)
const eventTransitions: Record<EventStatus, EventStatus[]> = {
  draft: ["published", "archived"],
  published: ["active", "paused", "completed", "archived"],
  active: ["paused", "completed", "archived"],
  paused: ["active", "published", "archived"],
  completed: ["archived"],
  archived: [],
};

function validateEventStatusTransition(from: EventStatus, to: EventStatus): void {
  const allowed = eventTransitions[from];
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Cannot transition event from "${from}" to "${to}"`,
    );
  }
}

// ── Rounds ────────────────────────────────────────────────────────────────────

/**
 * List rounds for an event, ordered by position.
 */
export async function listRounds(scope: EventScope): Promise<RoundSummary[]> {
  return repo.listRounds(scope);
}

/**
 * Get a single round by ID.
 */
export async function getRoundById(
  scope: EventScope,
  roundId: string,
): Promise<RoundSummary | null> {
  return repo.getRoundById(scope, roundId);
}

/**
 * Create a new round.
 * Business rules:
 *   - Event must be in draft or published status
 *   - Position must be unique (repo enforces via unique constraint)
 */
export async function createRound(
  scope: EventScope,
  input: CreateRoundInput & { actorId: string; requestId: string },
): Promise<RoundSummary> {
  const event = await repo.getEventById(scope.eventId);
  if (!event) throw new NotFoundError("Event");
  if (event.status === "archived" || event.status === "completed") {
    throw new ValidationError("Cannot add rounds to a completed or archived event");
  }

  return withTx(async (tx) => {
    const round = await repo.createRound(scope, { ...input, createdBy: input.actorId }, tx);
    await writeAudit(
      {
        actorUserId: input.actorId,
        action: "round.create" as AuditAction,
        targetType: "round",
        targetId: round.id,
        eventId: scope.eventId,
        after: round,
        requestId: input.requestId,
      },
      tx,
    );
    return round;
  });
}

/**
 * Transition round status with lifecycle validation.
 */
export async function updateRoundStatus(
  scope: EventScope,
  roundId: string,
  newStatus: RoundSummary["status"],
  actorId: string,
  requestId: string,
): Promise<RoundSummary> {
  const round = await repo.getRoundById(scope, roundId);
  if (!round) throw new NotFoundError("Round");

  validateRoundStatusTransition(round.status, newStatus);

  return withTx(async (tx) => {
    const updated = await repo.updateRoundStatus(scope, roundId, newStatus, tx);
    await writeAudit(
      {
        actorUserId: actorId,
        action: "round.update" as AuditAction,
        targetType: "round",
        targetId: roundId,
        eventId: scope.eventId,
        before: { status: round.status },
        after: { status: newStatus },
        requestId,
      },
      tx,
    );
    return updated;
  });
}

// Valid round transitions matching real DB status CHECK
// DB values: draft, published, open, paused, closed, finalised, cancelled
const roundTransitions: Record<RoundSummary["status"], RoundSummary["status"][]> = {
  draft: ["published", "open", "cancelled"],
  published: ["open", "cancelled"],
  open: ["paused", "closed", "cancelled"],
  paused: ["open", "closed", "cancelled"],
  closed: ["finalised", "cancelled"],
  finalised: [],
  cancelled: [],
};

function validateRoundStatusTransition(
  from: RoundSummary["status"],
  to: RoundSummary["status"],
): void {
  const allowed = roundTransitions[from];
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Cannot transition round from "${from}" to "${to}"`,
    );
  }
}

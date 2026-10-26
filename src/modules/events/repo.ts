/**
 * modules/events/repo — database queries for the events module.
 *
 * All functions accept an explicit eventId or EventScope to prevent cross-event
 * data access (R-DB-09, ARCHITECTURE.md §7.5).
 * All write functions accept an optional Tx for transaction composition.
 *
 * NEVER call this module from UI components (R-MOD-03).
 *
 * Column mapping (schema → TS):
 *   events.name          → EventSummary.name
 *   events.max_participants → EventSummary.maxParticipants
 *   events.team_mode     → EventSummary.teamMode
 *   rounds.round_no      → RoundSummary.roundNo
 *   rounds.round_type    → RoundSummary.roundType
 *   rounds.opens_at      → RoundSummary.opensAt
 *   rounds.duration_ms   → RoundSummary.durationMs
 *   participants.participant_no → ParticipantRecord.participantNo
 */
import "server-only";

import { db, dbRo, type Tx } from "@/core/db";
import { events, rounds, participants, users, eventCounters } from "@/core/db/schema";
import { and, eq, sql, desc, asc, count, inArray } from "drizzle-orm";
import type {
  EventSummary,
  EventDetail,
  RoundSummary,
  ParticipantRecord,
  CreateEventInput,
  UpdateEventInput,
  CreateRoundInput,
  EventScope,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toEventSummary(
  row: typeof events.$inferSelect & { participantCount?: number },
): EventSummary {
  const now = new Date();
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const isRegistrationOpen =
    (row.status === "published" || row.status === "active") &&
    row.registrationMode !== "closed" &&
    (row.registrationOpensAt == null || row.registrationOpensAt <= now) &&
    (row.registrationClosesAt == null || row.registrationClosesAt > now);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    status: row.status as EventSummary["status"],
    registrationMode: row.registrationMode as EventSummary["registrationMode"],
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    maxParticipants: row.maxParticipants,
    teamMode: row.teamMode as EventSummary["teamMode"],
    leaderboardPublic: Boolean(settings.leaderboardPublic ?? true),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
    isRegistrationOpen,
    participantCount: row.participantCount,
  };
}

function toRoundSummary(row: typeof rounds.$inferSelect): RoundSummary {
  return {
    id: row.id,
    eventId: row.eventId,
    roundNo: row.roundNo,
    name: row.name,
    roundType: row.roundType as RoundSummary["roundType"],
    status: row.status as RoundSummary["status"],
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    durationMs: row.durationMs,
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * List published (or active) events, ordered by start date.
 * Used by the public events listing page.
 */
export async function listPublishedEvents(opts?: {
  limit?: number;
  offset?: number;
}): Promise<EventSummary[]> {
  const rows = await dbRo
    .select()
    .from(events)
    .where(
      inArray(events.status, ["published", "active"]),
    )
    .orderBy(desc(events.startsAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return rows.map((r) => toEventSummary(r));
}

/**
 * Get a single event by slug (public read — uses read-only client).
 */
export async function getEventBySlug(slug: string): Promise<EventSummary | null> {
  const rows = await dbRo
    .select()
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);

  return rows[0] ? toEventSummary(rows[0]) : null;
}

/**
 * Get event by id (uses read-write client for consistency after writes).
 */
export async function getEventById(
  id: string,
  tx?: Tx,
): Promise<EventSummary | null> {
  const client = tx ?? db;
  const rows = await client
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);

  return rows[0] ? toEventSummary(rows[0]) : null;
}

/**
 * Create a new event owned by the given userId.
 */
export async function createEvent(
  input: CreateEventInput & { createdBy: string },
  tx?: Tx,
): Promise<EventSummary> {
  const client = tx ?? db;
  const rows = await client
    .insert(events)
    .values({
      slug: input.slug,
      name: input.name,
      tagline: input.tagline,
      description: input.description,
      maxParticipants: input.maxParticipants,
      teamMode: input.teamMode ?? "individual",
      registrationMode: input.registrationMode ?? "open",
      registrationOpensAt: input.registrationOpensAt,
      registrationClosesAt: input.registrationClosesAt,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      settings: input.settings ?? {},
      createdBy: input.createdBy,
    })
    .returning();

  return toEventSummary(rows[0]!);
}

/**
 * Update event fields (scoped to event ID).
 */
export async function updateEvent(
  { eventId }: EventScope,
  input: UpdateEventInput,
  tx?: Tx,
): Promise<EventSummary> {
  const client = tx ?? db;
  const { status, name, description, tagline, registrationMode, registrationOpensAt,
          registrationClosesAt, maxParticipants, teamMode, startsAt, endsAt, settings } = input;

  const rows = await client
    .update(events)
    .set({
      ...(status && { status }),
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(tagline !== undefined && { tagline }),
      ...(registrationMode && { registrationMode }),
      ...(registrationOpensAt !== undefined && { registrationOpensAt }),
      ...(registrationClosesAt !== undefined && { registrationClosesAt }),
      ...(maxParticipants !== undefined && { maxParticipants }),
      ...(teamMode && { teamMode }),
      ...(startsAt !== undefined && { startsAt }),
      ...(endsAt !== undefined && { endsAt }),
      ...(settings && { settings }),
      updatedAt: new Date(),
    })
    .where(eq(events.id, eventId))
    .returning();

  if (!rows[0]) throw new Error("Event not found");
  return toEventSummary(rows[0]);
}

// ── Rounds ────────────────────────────────────────────────────────────────────

/**
 * List rounds for an event, ordered by round_no.
 */
export async function listRounds(
  { eventId }: EventScope,
  tx?: Tx,
): Promise<RoundSummary[]> {
  const client = tx ?? dbRo;
  const rows = await client
    .select()
    .from(rounds)
    .where(
      and(eq(rounds.eventId, eventId), inArray(rounds.status, [
        "draft", "published", "open", "paused", "closed", "finalised",
      ])),
    )
    .orderBy(asc(rounds.roundNo));

  return rows.map(toRoundSummary);
}

/**
 * Get a single round by ID, scoped to an event.
 */
export async function getRoundById(
  { eventId }: EventScope,
  roundId: string,
  tx?: Tx,
): Promise<RoundSummary | null> {
  const client = tx ?? dbRo;
  const rows = await client
    .select()
    .from(rounds)
    .where(and(eq(rounds.eventId, eventId), eq(rounds.id, roundId)))
    .limit(1);

  return rows[0] ? toRoundSummary(rows[0]) : null;
}

/**
 * Create a new round for an event.
 */
export async function createRound(
  { eventId }: EventScope,
  input: CreateRoundInput & { createdBy: string },
  tx?: Tx,
): Promise<RoundSummary> {
  const client = tx ?? db;
  const rows = await client
    .insert(rounds)
    .values({
      eventId,
      roundNo: input.roundNo,
      name: input.name,
      roundType: input.roundType,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      durationMs: input.durationMs,
      config: input.config ?? {},
      createdBy: input.createdBy,
    })
    .returning();

  return toRoundSummary(rows[0]!);
}

/**
 * Transition round status.
 */
export async function updateRoundStatus(
  { eventId }: EventScope,
  roundId: string,
  status: RoundSummary["status"],
  tx?: Tx,
): Promise<RoundSummary> {
  const client = tx ?? db;
  const rows = await client
    .update(rounds)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(rounds.eventId, eventId), eq(rounds.id, roundId)))
    .returning();

  if (!rows[0]) throw new Error("Round not found");
  return toRoundSummary(rows[0]);
}

// ── Participants ──────────────────────────────────────────────────────────────

/**
 * Count approved participants for an event.
 */
export async function countApprovedParticipants(
  { eventId }: EventScope,
  tx?: Tx,
): Promise<number> {
  const client = tx ?? dbRo;
  const rows = await client
    .select({ n: count() })
    .from(participants)
    .where(
      and(
        eq(participants.eventId, eventId),
        eq(participants.status, "approved"),
      ),
    );

  return rows[0]?.n ?? 0;
}

/**
 * Get participant record for a user in a specific event (includes user join).
 */
export async function getParticipant(
  { eventId }: EventScope,
  userId: string,
  tx?: Tx,
): Promise<ParticipantRecord | null> {
  const client = tx ?? dbRo;
  const rows = await client
    .select({
      id: participants.id,
      eventId: participants.eventId,
      userId: participants.userId,
      participantNo: participants.participantNo,
      status: participants.status,
      displayName: users.displayName,
      registeredAt: participants.registeredAt,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(
      and(
        eq(participants.eventId, eventId),
        eq(participants.userId, userId),
      ),
    )
    .limit(1);

  if (!rows[0]) return null;
  return {
    ...rows[0],
    status: rows[0].status as ParticipantRecord["status"],
  };
}

/**
 * List all events the user is registered for, with their participation status
 * and each event's rounds. Used by the participant dashboard.
 */
export async function listParticipantEvents(userId: string): Promise<
  Array<
    EventSummary & {
      participantStatus: ParticipantRecord["status"];
      rounds: RoundSummary[];
    }
  >
> {
  // Step 1: fetch all participant rows for this user, with the event row.
  const rows = await dbRo
    .select({
      participantStatus: participants.status,
      event: events,
    })
    .from(participants)
    .innerJoin(events, eq(participants.eventId, events.id))
    .where(eq(participants.userId, userId))
    .orderBy(desc(events.startsAt));

  if (rows.length === 0) return [];

  const eventIds = rows.map((r) => r.event.id);

  // Step 2: fetch all rounds for these events in one query (avoids N+1).
  const allRounds = await dbRo
    .select()
    .from(rounds)
    .where(inArray(rounds.eventId, eventIds))
    .orderBy(asc(rounds.roundNo));

  const roundsByEvent = new Map<string, RoundSummary[]>();
  for (const r of allRounds) {
    const list = roundsByEvent.get(r.eventId) ?? [];
    list.push(toRoundSummary(r));
    roundsByEvent.set(r.eventId, list);
  }

  return rows.map((r) => ({
    ...toEventSummary(r.event),
    participantStatus: r.participantStatus as ParticipantRecord["status"],
    rounds: roundsByEvent.get(r.event.id) ?? [],
  }));
}

/**
 * Get the current value of a named counter for an event.
 */
export async function getCounter(
  { eventId }: EventScope,
  counterKey: string,
  tx?: Tx,
): Promise<number> {
  const client = tx ?? dbRo;
  const rows = await client
    .select({ value: eventCounters.value })
    .from(eventCounters)
    .where(
      and(
        eq(eventCounters.eventId, eventId),
        eq(eventCounters.counterKey, counterKey),
      ),
    )
    .limit(1);

  return rows[0]?.value ?? 0;
}

/**
 * modules/events — public types and domain constants.
 *
 * These types reflect the actual DB schema (db/migrations/0002–0004).
 * Import from "@/modules/events" — never from ./repo or ./service directly.
 */

// ── Value types ───────────────────────────────────────────────────────────────

export type EventStatus =
  | "draft"
  | "published"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type RegistrationMode = "open" | "approval" | "closed" | "invite_only";

export type TeamMode = "individual" | "team" | "both";

export type RoundStatus =
  | "draft"
  | "published"
  | "open"
  | "paused"
  | "closed"
  | "finalised"
  | "cancelled";

export type RoundType = "quiz" | "challenge" | "judged";

// ── Read models (returned from repo → used in UI) ─────────────────────────────

export interface EventSummary {
  id: string;
  slug: string;
  /** DB column: name */
  name: string;
  tagline: string | null;
  description: string | null;
  status: EventStatus;
  registrationMode: RegistrationMode;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** DB column: max_participants */
  maxParticipants: number | null;
  teamMode: TeamMode;
  /** Derived from settings JSONB */
  leaderboardPublic: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  /** Derived: true when registration window is currently open */
  isRegistrationOpen: boolean;
  /** Populated only when explicitly counted */
  participantCount?: number | undefined;
}

export interface EventDetail extends EventSummary {
  rounds: RoundSummary[];
  createdByName: string;
}

export interface RoundSummary {
  id: string;
  eventId: string;
  roundNo: number;
  /** DB column: name */
  name: string;
  roundType: RoundType;
  status: RoundStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  /** DB column: duration_ms */
  durationMs: number | null;
  config: Record<string, unknown>;
}

export interface ParticipantRecord {
  id: string;
  eventId: string;
  userId: string;
  participantNo: number;
  status: "pending" | "approved" | "rejected" | "waitlisted" | "withdrawn";
  displayName: string;
  registeredAt: Date;
}

// ── Write models (input to service functions) ─────────────────────────────────

export interface CreateEventInput {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  maxParticipants?: number;
  teamMode?: TeamMode;
  registrationMode?: RegistrationMode;
  registrationOpensAt?: Date;
  registrationClosesAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
  settings?: Record<string, unknown>;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  status?: EventStatus;
}

export interface CreateRoundInput {
  roundNo: number;
  name: string;
  roundType: RoundType;
  opensAt?: Date;
  closesAt?: Date;
  durationMs?: number;
  config?: Record<string, unknown>;
}

// ── Event scope (passed to all repo functions for isolation) ──────────────────

export interface EventScope {
  eventId: string;
}

// ── Leaderboard read model ────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  entryId: string;
  displayName: string;
  score: number;
  maxScore: number;
  percentile: number;
  change: number | null;
}

export interface LeaderboardSnapshot {
  eventId: string;
  computedAt: Date;
  entries: LeaderboardEntry[];
}

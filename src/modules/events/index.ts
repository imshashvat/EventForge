/**
 * modules/events — public barrel export.
 *
 * Import ONLY from this file from route handlers and other modules.
 * Internal files (repo.ts, service.ts) are not re-exported here
 * to enforce the module boundary (R-MOD-01).
 */
export type {
  EventSummary,
  EventDetail,
  RoundSummary,
  ParticipantRecord,
  CreateEventInput,
  UpdateEventInput,
  CreateRoundInput,
  EventScope,
  LeaderboardEntry,
  LeaderboardSnapshot,
  EventStatus,
  RoundStatus,
  RoundType,
} from "./types";

export {
  listPublishedEvents,
  listParticipantEvents,
  getEventBySlug,
  getEventById,
  createEvent,
  updateEvent,
  listRounds,
  getRoundById,
  createRound,
  updateRoundStatus,
} from "./service";

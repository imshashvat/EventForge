/**
 * core/db/schema ? Drizzle ORM table definitions.
 *
 * These MUST reflect the hand-written SQL migrations in db/migrations/*.sql.
 * Do NOT generate migrations from this file ? the SQL files are the source
 * of truth. This file exists purely to give the TypeScript layer type-safe
 * table references and query building.
 *
 * Schema lives in the "app" Postgres schema (SET search_path TO app).
 */

import {
  pgTable,
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// All tables live in the "app" schema (migration 0000 creates it)
const app = pgSchema("app");

// ?? Shared timestamp helper ???????????????????????????????????????????????????

const ts = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ?? users (migration 0001) ????????????????????????????????????????????????????

export const users = app.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUid: uuid("auth_uid").notNull(),
    displayName: text("display_name").notNull(),
    emailHash: text("email_hash").notNull(),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    // status CHECK: 'active','suspended','deleted'
    ...ts,
  },
  (t) => [
    unique("uq_users_auth_uid").on(t.authUid),
    index("users_auth_uid_idx").on(t.authUid),
    index("users_status_idx").on(t.status),
  ],
);

// ?? role_assignments (migration 0001) ????????????????????????????????????????

export const roleAssignments = app.table(
  "role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    // scopeType CHECK: 'global','event','round'
    scopeType: text("scope_type").notNull().default("global"),
    eventId: uuid("event_id"),
    roundId: uuid("round_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("role_assignments_user_idx").on(t.userId),
    index("role_assignments_event_idx").on(t.eventId),
  ],
);

// ?? events (migration 0002) ???????????????????????????????????????????????????

export const events = app.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    // status CHECK: 'draft','published','active','paused','completed','archived'

    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("UTC"),

    registrationMode: text("registration_mode").notNull().default("open"),
    // registrationMode CHECK: 'open','approval','closed','invite_only'
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
    maxParticipants: integer("max_participants"),

    teamMode: text("team_mode").notNull().default("individual"),
    // teamMode CHECK: 'individual','team','both'
    minTeamSize: integer("min_team_size").notNull().default(1),
    maxTeamSize: integer("max_team_size").notNull().default(1),

    settings: jsonb("settings").notNull().default({}),

    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...ts,
  },
  (t) => [
    unique("uq_events_slug").on(t.slug),
    index("events_status_idx").on(t.status),
    index("events_starts_at_idx").on(t.startsAt),
  ],
);

// ?? event_counters (migration 0002) ??????????????????????????????????????????

export const eventCounters = app.table(
  "event_counters",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    counterKey: text("counter_key").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.counterKey] })],
);

// ?? registration_forms (migration 0002) ??????????????????????????????????????

export const registrationForms = app.table(
  "registration_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    // Array of FieldDef: { key, label, fieldType, required, options?, placeholder? }
    // fieldType: 'text' | 'email' | 'phone' | 'select' | 'checkbox' | 'url'
    fields: jsonb("fields").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ?? participants (migration 0003) ?????????????????????????????????????????????

export const participants = app.table(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    participantNo: bigint("participant_no", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"),
    // status CHECK: 'pending','approved','rejected','waitlisted','withdrawn'
    formAnswers: jsonb("form_answers").notNull().default({}),
    formId: uuid("form_id").references(() => registrationForms.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewNote: text("review_note"),
  },
  (t) => [
    unique("uq_participants_event_user").on(t.eventId, t.userId),
    unique("uq_participants_event_no").on(t.eventId, t.participantNo),
    index("participants_event_idx").on(t.eventId),
    index("participants_user_idx").on(t.userId),
    index("participants_status_idx").on(t.eventId, t.status),
  ],
);

// ?? teams (migration 0003) ????????????????????????????????????????????????????

export const teams = app.table(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    teamNo: bigint("team_no", { mode: "number" }).notNull(),
    status: text("status").notNull().default("forming"),
    captainParticipantId: uuid("captain_participant_id"),
    joinCode: text("join_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_teams_event_name").on(t.eventId, t.name),
    unique("uq_teams_event_no").on(t.eventId, t.teamNo),
    unique("uq_teams_event_code").on(t.eventId, t.joinCode),
    index("teams_event_idx").on(t.eventId),
  ],
);

// ?? entries (migration 0003) ??????????????????????????????????????????????????

export const entries = app.table(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    entryType: text("entry_type").notNull(),
    // entryType CHECK: 'individual','team'
    participantId: uuid("participant_id").references(() => participants.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_entries_event_participant").on(t.eventId, t.participantId),
    unique("uq_entries_event_team").on(t.eventId, t.teamId),
    index("entries_event_idx").on(t.eventId),
  ],
);

// ?? rounds (migration 0004) ???????????????????????????????????????????????????

export const rounds = app.table(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    roundNo: integer("round_no").notNull(),
    name: text("name").notNull(),
    roundType: text("round_type").notNull(),
    // roundType CHECK: 'quiz','challenge','judged'
    status: text("status").notNull().default("draft"),
    // status CHECK: 'draft','published','open','paused','closed','finalised','cancelled'
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    eligibility: text("eligibility").notNull().default("all"),
    advancementMode: text("advancement_mode").notNull().default("all"),
    config: jsonb("config").notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_rounds_event_no").on(t.eventId, t.roundNo),
    index("rounds_event_idx").on(t.eventId),
    index("rounds_status_idx").on(t.eventId, t.status),
  ],
);

// ?? score_records (migration 0005) ????????????????????????????????????????????

export const scoreRecords = app.table(
  "score_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    // source CHECK: 'quiz_auto','judge_final','admin_adjust','penalty'
    rawScore: numeric("raw_score", { precision: 10, scale: 4 }).notNull(),
    normalisedScore: numeric("normalised_score", { precision: 10, scale: 4 }),
    penalty: numeric("penalty", { precision: 10, scale: 4 }).notNull().default("0"),
    finalScore: numeric("final_score", { precision: 10, scale: 4 }).notNull(),
    supersededBy: uuid("superseded_by"),
    inputsHash: text("inputs_hash"),
    sourceRefId: uuid("source_ref_id"),
    computedByUserId: uuid("computed_by_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // migration 0009: monotonic watermark (GENERATED ALWAYS AS IDENTITY ? never insert)
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  },
  (t) => [
    index("score_records_round_entry_idx").on(t.roundId, t.entryId),
    index("score_records_event_idx").on(t.eventId),
  ],
);

// ?? question_banks (migration 0007) ??????????????????????????????????????????

export const questionBanks = app.table(
  "question_banks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...ts,
  },
  (t) => [
    index("question_banks_event_idx").on(t.eventId),
  ],
);

// ?? questions (migration 0007) ????????????????????????????????????????????????

export const questions = app.table(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id").notNull().references(() => questionBanks.id, { onDelete: "restrict" }),
    questionType: text("question_type").notNull(),
    // CHECK: 'single_choice','multi_choice','true_false','short_text'
    tags: text("tags").array().notNull().default(sql`'{}'`),
    difficulty: text("difficulty").notNull().default("medium"),
    isLocked: boolean("is_locked").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...ts,
  },
  (t) => [
    index("questions_bank_idx").on(t.bankId),
    index("questions_event_idx").on(t.eventId),
  ],
);

// ?? question_versions (migration 0007) ????????????????????????????????????????

export const questionVersions = app.table(
  "question_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    stem: text("stem").notNull(),
    stemImageUrl: text("stem_image_url"),
    marks: numeric("marks", { precision: 10, scale: 4 }).notNull().default("1"),
    negMarks: numeric("neg_marks", { precision: 10, scale: 4 }).notNull().default("0"),
    acceptedAnswers: text("accepted_answers").array(),
    normalizeCase: boolean("normalize_case").notNull().default(true),
    normalizeSpaces: boolean("normalize_spaces").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_qv_question_version").on(t.questionId, t.versionNo),
    index("question_versions_question_idx").on(t.questionId),
  ],
);

// ?? question_options (migration 0007) ?????????????????????????????????????????

export const questionOptions = app.table(
  "question_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => questionVersions.id, { onDelete: "restrict" }),
    optionText: text("option_text").notNull(),
    optionImageUrl: text("option_image_url"),
    isCorrect: boolean("is_correct").notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("question_options_version_idx").on(t.versionId),
  ],
);

// ?? round_questions (migration 0007) ??????????????????????????????????????????

export const roundQuestions = app.table(
  "round_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    pinnedVersionId: uuid("pinned_version_id").references(() => questionVersions.id),
    poolTag: text("pool_tag"),
    poolDrawN: integer("pool_draw_n"),
    displayOrder: integer("display_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_round_questions_round_q").on(t.roundId, t.questionId),
    index("round_questions_round_idx").on(t.roundId),
  ],
);

// ?? quiz_attempts (migration 0007, AD-16) ?????????????????????????????????????
// Scoped to entry_id (not participant_id) to support shared team attempts.

export const quizAttempts = app.table(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    startedByParticipantId: uuid("started_by_participant_id").references(() => participants.id),
    status: text("status").notNull().default("in_progress"),
    // CHECK: 'in_progress','submitted','auto_submitted','timed_out'
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    shuffleSeed: bigint("shuffle_seed", { mode: "bigint" }).notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    scoreRecordId: uuid("score_record_id"),
    ...ts,
  },
  (t) => [
    unique("uq_quiz_attempts_round_entry").on(t.roundId, t.entryId),
    index("quiz_attempts_round_idx").on(t.roundId),
    index("quiz_attempts_entry_idx").on(t.entryId),
    index("quiz_attempts_status_idx").on(t.status),
  ],
);

// ?? attempt_questions (migration 0007) ????????????????????????????????????????

export const attemptQuestions = app.table(
  "attempt_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "restrict" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    versionId: uuid("version_id").notNull().references(() => questionVersions.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull(),
    optionSeed: bigint("option_seed", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_attempt_questions_attempt_q").on(t.attemptId, t.questionId),
    index("attempt_questions_attempt_idx").on(t.attemptId),
  ],
);

// ?? quiz_responses (migration 0007) ???????????????????????????????????????????

export const quizResponses = app.table(
  "quiz_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "restrict" }),
    attemptQuestionId: uuid("attempt_question_id").notNull().references(() => attemptQuestions.id, { onDelete: "restrict" }),
    selectedOptionIds: uuid("selected_option_ids").array().notNull().default(sql`'{}'`),
    textAnswer: text("text_answer"),
    clientSeq: bigint("client_seq", { mode: "number" }).notNull().default(0),
    // AD-16: audit trail for team quizzes ? not used in scoring
    answeredByParticipantId: uuid("answered_by_participant_id").references(() => participants.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    isCorrect: boolean("is_correct"),
    reviewStatus: text("review_status").default("auto_graded"),
    // CHECK: 'auto_graded','pending_review','reviewed'
  },
  (t) => [
    unique("uq_quiz_responses_attempt_question").on(t.attemptQuestionId),
    index("quiz_responses_attempt_idx").on(t.attemptId),
  ],
);


// -- leaderboard_snapshots (migration 0008) -----------------------------------
// Versioned snapshot rows per (event_id, scope). Rebuilt via advisory lock (ss15.2).

export const leaderboardSnapshots = app.table(
  "leaderboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    version: integer("version").notNull().default(1),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    provisional: boolean("provisional").notNull().default(true),
    scoreWatermark: uuid("score_watermark"), // legacy (0008); superseded by scoreSeq
    scoreSeq: bigint("score_seq", { mode: "number" }), // migration 0009
    payload: jsonb("payload").notNull().default([]),
    etag: text("etag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lb_snapshots_event_scope_idx").on(t.eventId, t.scope, t.version),
  ],
);

// -- M2: Challenge (migration 0010) --------------------------------------------
// ARCHITECTURE.md ?12

export const challengeTasks = app.table(
  "challenge_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    allowedUrlTypes: jsonb("allowed_url_types").notNull().default(["github_repo"]),
    allowHttp: boolean("allow_http").notNull().default(false),
    videoAllowlist: jsonb("video_allowlist").notNull().default([]),
    clockMode: text("clock_mode").notNull().default("fixed_window"),
    timeLimitMs: integer("time_limit_ms"),
    ...ts,
  },
  (t) => [
    index("challenge_tasks_round_idx").on(t.roundId),
  ],
);

export const challengeStarts = app.table(
  "challenge_starts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => challengeTasks.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    startedByParticipantId: uuid("started_by_participant_id").references(() => participants.id),
    ...ts,
  },
  (t) => [
    unique("uq_challenge_starts_task_entry").on(t.taskId, t.entryId),
    index("challenge_starts_entry_idx").on(t.entryId),
  ],
);

export const submissions = app.table(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => challengeTasks.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    countedRevisionId: uuid("counted_revision_id"),
    status: text("status").notNull().default("not_started"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    isLate: boolean("is_late").notNull().default(false),
    ...ts,
  },
  (t) => [
    unique("uq_submissions_task_entry").on(t.taskId, t.entryId),
    index("submissions_entry_idx").on(t.entryId),
    index("submissions_event_idx").on(t.eventId),
  ],
);

export const submissionRevisions = app.table(
  "submission_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    revisionNo: integer("revision_no").notNull(),
    isDraft: boolean("is_draft").notNull().default(true),
    urls: jsonb("urls").notNull().default({}),
    notes: text("notes"),
    isLate: boolean("is_late").notNull().default(false),
    submittedByParticipantId: uuid("submitted_by_participant_id").references(() => participants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_submission_revisions_sub_no").on(t.submissionId, t.revisionNo),
    index("submission_revisions_submission_idx").on(t.submissionId),
  ],
);

// -- M2: Judging (migration 0011) ----------------------------------------------
// ARCHITECTURE.md ?13

export const evaluationRubrics = app.table(
  "evaluation_rubrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    aggregation: text("aggregation").notNull().default("mean"),
    varianceThresholdPct: numeric("variance_threshold_pct", { precision: 5, scale: 2 }).notNull().default("20"),
    minJudges: integer("min_judges").notNull().default(1),
    blind: boolean("blind").notNull().default(false),
    ...ts,
  },
  (t) => [
    unique("uq_rubrics_round").on(t.roundId),
    index("rubrics_event_idx").on(t.eventId),
  ],
);

export const evaluationCriteria = app.table(
  "evaluation_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rubricId: uuid("rubric_id").notNull().references(() => evaluationRubrics.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    maxMarks: numeric("max_marks", { precision: 10, scale: 4 }).notNull(),
    weight: numeric("weight", { precision: 8, scale: 6 }),
    displayOrder: integer("display_order").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("eval_criteria_rubric_idx").on(t.rubricId),
  ],
);

export const judgingAssignments = app.table(
  "judging_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "restrict" }),
    judgeUserId: uuid("judge_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    rubricId: uuid("rubric_id").notNull().references(() => evaluationRubrics.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id),
    ...ts,
  },
  (t) => [
    unique("uq_judging_assignment_sub_judge").on(t.submissionId, t.judgeUserId),
    index("judging_assignments_judge_idx").on(t.judgeUserId),
    index("judging_assignments_event_idx").on(t.eventId),
  ],
);

export const judgeEvaluations = app.table(
  "judge_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id").notNull().references(() => judgingAssignments.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "restrict" }),
    judgeUserId: uuid("judge_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    revisionNo: integer("revision_no").notNull().default(1),
    status: text("status").notNull().default("draft"),
    comment: text("comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    ...ts,
  },
  (t) => [
    index("judge_evaluations_assignment_idx").on(t.assignmentId),
    index("judge_evaluations_event_idx").on(t.eventId),
  ],
);

export const judgeEvaluationScores = app.table(
  "judge_evaluation_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id").notNull().references(() => judgeEvaluations.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id").notNull().references(() => evaluationCriteria.id, { onDelete: "restrict" }),
    marksAwarded: numeric("marks_awarded", { precision: 10, scale: 4 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_eval_scores_eval_criterion").on(t.evaluationId, t.criterionId),
    index("eval_scores_evaluation_idx").on(t.evaluationId),
  ],
);

export const evaluationResolutions = app.table(
  "evaluation_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "restrict" }),
    rubricId: uuid("rubric_id").notNull().references(() => evaluationRubrics.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    method: text("method").notNull(),
    manualValue: numeric("manual_value", { precision: 10, scale: 4 }),
    reason: text("reason").notNull(),
    resolvedByUserId: uuid("resolved_by_user_id").notNull().references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
    ...ts,
  },
  (t) => [
    index("eval_resolutions_submission_idx").on(t.submissionId),
  ],
);

// -- M2: Results (migration 0012) ----------------------------------------------
// ARCHITECTURE.md ?14

export const resultRuns = app.table(
  "result_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    runNo: integer("run_no").notNull(),
    status: text("status").notNull().default("dry_run"),
    configSnapshot: jsonb("config_snapshot").notNull(),
    inputsHash: text("inputs_hash").notNull(),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededByRunId: uuid("superseded_by_run_id"),
    ...ts,
  },
  (t) => [
    unique("uq_result_runs_event_no").on(t.eventId, t.runNo),
    index("result_runs_event_idx").on(t.eventId),
  ],
);

export const calculatedResults = app.table(
  "calculated_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => resultRuns.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "restrict" }),
    finalScore: numeric("final_score", { precision: 10, scale: 4 }),
    rank: integer("rank"),
    tieStatus: text("tie_status").notNull().default("none"),
    advancementStatus: text("advancement_status"),
    entryStatus: text("entry_status").notNull().default("active"),
    statusReason: text("status_reason"),
    roundBreakdown: jsonb("round_breakdown").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_calculated_results_run_entry").on(t.runId, t.entryId),
    index("calculated_results_run_idx").on(t.runId),
    index("calculated_results_entry_idx").on(t.entryId),
  ],
);
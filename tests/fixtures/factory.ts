/**
 * tests/fixtures/factory.ts — Minimal seed helpers for integration tests
 *
 * Each function inserts a single row and returns it. Pass a tx to keep
 * insertions inside the rollback boundary of withTestTx().
 *
 * These bypass the full service layer to avoid auth/validation overhead —
 * the service layer itself is what we're testing.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  users, events, participants, entries, rounds,
  questionBanks, questions, questionVersions, questionOptions,
  roundQuestions, quizAttempts, attemptQuestions, quizResponses,
  roleAssignments,
} from "@/core/db/schema";

type AnyDb = PostgresJsDatabase | Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

// ── Users ─────────────────────────────────────────────────────────────────────

export async function makeUser(db: AnyDb, overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(users)
    .values({
      authUid: crypto.randomUUID(),
      emailHash: `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      displayName: "Test User",
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function makeEvent(db: AnyDb, createdBy: string, overrides: Partial<typeof events.$inferInsert> = {}) {
  const slug = `test-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await (db as PostgresJsDatabase)
    .insert(events)
    .values({
      slug,
      name: "Test Event",
      status: "active",
      createdBy,
      teamMode: "individual",
      registrationMode: "open",
      timezone: "UTC",
      settings: {},
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Role assignments ──────────────────────────────────────────────────────────

export async function makeRoleAssignment(
  db: AnyDb,
  userId: string,
  roleKey: string,
  eventId: string | null = null,
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(roleAssignments)
    .values({
      userId,
      roleKey,
      scopeType: eventId ? "event" : "global",
      ...(eventId ? { eventId } : {}),
    })
    .returning();
  return row!;
}

// ── Participants ──────────────────────────────────────────────────────────────

export async function makeParticipant(
  db: AnyDb,
  userId: string,
  eventId: string,
  overrides: Partial<typeof participants.$inferInsert> = {},
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(participants)
    .values({
      userId,
      eventId,
      participantNo: Date.now() % 2147483647, // fits in int range
      status: "approved",
      formAnswers: {},
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Entries ───────────────────────────────────────────────────────────────────

export async function makeEntry(
  db: AnyDb,
  eventId: string,
  participantId: string,
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(entries)
    .values({
      eventId,
      entryType: "individual",
      participantId,
    })
    .returning();
  return row!;
}

// ── Rounds ────────────────────────────────────────────────────────────────────

export async function makeRound(
  db: AnyDb,
  eventId: string,
  createdBy: string,
  overrides: Partial<typeof rounds.$inferInsert> = {},
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(rounds)
    .values({
      eventId,
      roundNo: Math.floor(Math.random() * 9000) + 1000,
      name: "Test Round",
      roundType: "quiz",
      status: "open",
      durationMs: 30 * 60 * 1000, // 30 minutes
      createdBy,
      config: {},
      eligibility: "all",
      advancementMode: "all",
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Question banks ────────────────────────────────────────────────────────────

export async function makeBank(
  db: AnyDb,
  eventId: string,
  createdBy: string,
  overrides: Partial<typeof questionBanks.$inferInsert> = {},
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(questionBanks)
    .values({
      eventId,
      name: `Bank-${Date.now()}`,
      createdBy,
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Questions + version + options (all-in-one) ────────────────────────────────

export interface QuestionSpec {
  stem?: string;
  marks?: string;
  negMarks?: string;
  questionType?: "single_choice" | "multi_choice" | "true_false" | "short_text";
  options?: Array<{ text: string; isCorrect: boolean }>;
  acceptedAnswers?: string[];
}

export async function makeQuestion(
  db: AnyDb,
  eventId: string,
  bankId: string,
  createdBy: string,
  spec: QuestionSpec = {},
) {
  const questionType = spec.questionType ?? "single_choice";

  const [q] = await (db as PostgresJsDatabase)
    .insert(questions)
    .values({
      eventId,
      bankId,
      questionType,
      difficulty: "medium",
      tags: [],
      createdBy,
    })
    .returning();
  if (!q) throw new Error("makeQuestion: insert failed");

  const [v] = await (db as PostgresJsDatabase)
    .insert(questionVersions)
    .values({
      questionId: q.id,
      versionNo: 1,
      stem: spec.stem ?? "What is 2 + 2?",
      marks: spec.marks ?? "1",
      negMarks: spec.negMarks ?? "0",
      ...(spec.acceptedAnswers ? { acceptedAnswers: spec.acceptedAnswers } : {}),
      normalizeCase: true,
      normalizeSpaces: true,
    })
    .returning();
  if (!v) throw new Error("makeQuestion: version insert failed");

  const rawOptions = spec.options ?? [
    { text: "4", isCorrect: true },
    { text: "3", isCorrect: false },
  ];

  let optionIds: string[] = [];
  if (questionType !== "short_text") {
    const insertedOpts = await (db as PostgresJsDatabase).insert(questionOptions).values(
      rawOptions.map((opt, i) => ({
        versionId: v.id,
        optionText: opt.text,
        isCorrect: opt.isCorrect,
        displayOrder: i + 1,
      })),
    ).returning({ id: questionOptions.id });
    optionIds = insertedOpts.map((o) => o.id);
  }

  return { question: q, version: v, optionIds };
}

// ── Round question ────────────────────────────────────────────────────────────

export async function makeRoundQuestion(
  db: AnyDb,
  roundId: string,
  eventId: string,
  questionId: string,
  displayOrder: number = 1,
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(roundQuestions)
    .values({ roundId, eventId, questionId, displayOrder })
    .returning();
  return row!;
}

// ── Quiz attempt ──────────────────────────────────────────────────────────────

export async function makeAttempt(
  db: AnyDb,
  roundId: string,
  eventId: string,
  entryId: string,
  overrides: Partial<typeof quizAttempts.$inferInsert> = {},
) {
  const deadline = new Date(Date.now() + 30 * 60 * 1000);
  const [row] = await (db as PostgresJsDatabase)
    .insert(quizAttempts)
    .values({
      roundId,
      eventId,
      entryId,
      status: "in_progress",
      deadlineAt: deadline,
      shuffleSeed: BigInt(Math.floor(Math.random() * 2 ** 32)),
      ...overrides,
    })
    .returning();
  return row!;
}

// ── Attempt question ──────────────────────────────────────────────────────────

export async function makeAttemptQuestion(
  db: AnyDb,
  attemptId: string,
  questionId: string,
  versionId: string,
  displayOrder: number = 1,
) {
  const [row] = await (db as PostgresJsDatabase)
    .insert(attemptQuestions)
    .values({
      attemptId,
      questionId,
      versionId,
      displayOrder,
      optionSeed: BigInt(Math.floor(Math.random() * 2 ** 32)),
    })
    .returning();
  return row!;
}

// ── Full world builder ────────────────────────────────────────────────────────

/**
 * Build a complete world: admin user + event + round + bank + question + participant + entry.
 * Returns all created objects. Everything is inside the caller's tx.
 */
export async function makeWorld(db: AnyDb) {
  const admin = await makeUser(db, { displayName: "Admin" });
  const event = await makeEvent(db, admin.id);
  await makeRoleAssignment(db, admin.id, "event_admin", event.id);

  const round = await makeRound(db, event.id, admin.id);
  const bank = await makeBank(db, event.id, admin.id);

  const participant = await makeUser(db, { displayName: "Participant" });
  await makeParticipant(db, participant.id, event.id);
  const participantRecord = await makeParticipant(db, participant.id, event.id).catch(() =>
    // Already inserted — fetch
    (db as PostgresJsDatabase)
      .select()
      .from(participants)
      .then((rows) => rows.find((r) => r.userId === participant.id && r.eventId === event.id)!)
  );
  const entry = await makeEntry(db, event.id, participantRecord.id);

  return { admin, event, round, bank, participant, participantRecord, entry };
}

/**
 * modules/exports/service — CSV export generators (FR-EXP)
 *
 * Supported export types:
 *   participants          — one row per approved participant (FR-EXP-01/02)
 *   leaderboard           — one row per entry, ordered by rank (FR-EXP-03)
 *   challenge_submissions — one row per submission revision (FR-EXP-04)
 *   evaluations           — one row per judge × criterion (FR-EXP-05)
 *
 * Authorization is the caller's responsibility (route handlers call authorize()
 * before invoking these functions — R-AUTHZ-01).
 *
 * Formula injection is prevented by core/csv sanitizeCell (BR-28, FR-EXP-04).
 * UTF-8 BOM is added when FEATURE_EXPORT_BOM=true (spreadsheet compat).
 */
import "server-only";

import { db } from "@/core/db";
import {
  participants,
  users,
  events,
  entries,
  scoreRecords,
  rounds,
  submissions,
  submissionRevisions,
  challengeTasks,
  judgingAssignments,
  judgeEvaluations,
  judgeEvaluationScores,
  evaluationCriteria,
  evaluationRubrics,
} from "@/core/db/schema";
import { serializeCsv, type CsvColumnDef, type CellValue } from "@/core/csv";
import { NotFoundError } from "@/core/errors";
import { and, eq, desc, sql } from "drizzle-orm";

const withBom = process.env["FEATURE_EXPORT_BOM"] === "true";

// ── Participants export ───────────────────────────────────────────────────────

const PARTICIPANT_COLUMNS: CsvColumnDef[] = [
  { header: "Participant No", key: "participantNo", isNumeric: true },
  { header: "Display Name", key: "displayName" },
  { header: "Status", key: "status" },
  { header: "Entry Type", key: "entryType" },
  { header: "Registered At (UTC)", key: "registeredAt" },
];

/**
 * Export all approved participants for an event as CSV (FR-EXP-01/02).
 * Returns the CSV string — caller streams or writes it to the response.
 */
export async function exportParticipants(eventId: string): Promise<string> {
  // Verify event exists
  const [evt] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!evt) throw new NotFoundError("Event");

  const rows = await db
    .select({
      participantNo: participants.participantNo,
      displayName: users.displayName,
      status: participants.status,
      entryType: entries.entryType,
      registeredAt: participants.registeredAt,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .leftJoin(
      entries,
      and(
        eq(entries.eventId, participants.eventId),
        eq(entries.participantId, participants.id),
        eq(entries.entryType, "individual"),
      ),
    )
    .where(eq(participants.eventId, eventId))
    .orderBy(participants.participantNo);

  const csvRows: Record<string, CellValue>[] = rows.map((r) => ({
    participantNo: r.participantNo,
    displayName: r.displayName,
    status: r.status,
    entryType: r.entryType ?? "individual",
    registeredAt: r.registeredAt,
  }));

  return serializeCsv(PARTICIPANT_COLUMNS, csvRows, withBom);
}

// ── Leaderboard export ────────────────────────────────────────────────────────

const LEADERBOARD_COLUMNS: CsvColumnDef[] = [
  { header: "Rank", key: "rank", isNumeric: true },
  { header: "Display Name", key: "displayName" },
  { header: "Entry Type", key: "entryType" },
  { header: "Total Score", key: "totalScore", isNumeric: true },
  { header: "Rounds Attempted", key: "roundsAttempted", isNumeric: true },
];

/**
 * Export the event leaderboard as CSV (FR-EXP-03).
 * Aggregates final scores across all rounds per entry, ordered by total descending.
 * Only includes entries that have at least one scored attempt.
 */
export async function exportLeaderboard(eventId: string): Promise<string> {
  // Verify event exists
  const [evt] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!evt) throw new NotFoundError("Event");

  // Fetch all quiz rounds for this event to scope the score query
  const eventRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.eventId, eventId), eq(rounds.roundType, "quiz")));

  if (eventRounds.length === 0) {
    // No quiz rounds — return headers-only CSV
    return serializeCsv(LEADERBOARD_COLUMNS, [], withBom);
  }

  const roundIds = eventRounds.map((r) => r.id);

  // Aggregate: SUM(final_score) and COUNT(distinct round_id) per entry
  // Only the latest score row per (entry, round) using the monotonic seq watermark.
  // Drizzle doesn't support FILTER/PARTITION well here, so we use a raw SQL CTE.
  // The round ID array is passed as a parameterized JSON array to avoid injection.
  const aggregated = await db.execute<{
    entry_id: string;
    display_name: string;
    entry_type: string;
    total_score: string;
    rounds_attempted: string;
  }>(sql`
    WITH ranked_scores AS (
      SELECT
        sr.entry_id,
        sr.round_id,
        sr.final_score,
        ROW_NUMBER() OVER (PARTITION BY sr.entry_id, sr.round_id ORDER BY sr.seq DESC) AS rn
      FROM app.score_records sr
      WHERE sr.round_id = ANY(${roundIds}::uuid[])
        AND sr.source IN ('quiz_auto', 'admin_adjust', 'penalty')
    ),
    entry_totals AS (
      SELECT
        rs.entry_id,
        SUM(rs.final_score) AS total_score,
        COUNT(DISTINCT rs.round_id) AS rounds_attempted
      FROM ranked_scores rs
      WHERE rs.rn = 1
      GROUP BY rs.entry_id
    )
    SELECT
      et.entry_id,
      u.display_name,
      e.entry_type,
      et.total_score::TEXT,
      et.rounds_attempted::TEXT
    FROM entry_totals et
    JOIN app.entries e ON e.id = et.entry_id
    JOIN app.participants p ON p.id = e.participant_id
    JOIN app.users u ON u.id = p.user_id
    ORDER BY et.total_score DESC, u.display_name ASC
  `);


  const rows = Array.from(aggregated);
  const csvRows: Record<string, CellValue>[] = rows.map((r, i) => ({
    rank: i + 1,
    displayName: r.display_name,
    entryType: r.entry_type,
    totalScore: Number(r.total_score ?? 0),
    roundsAttempted: Number(r.rounds_attempted ?? 0),
  }));

  return serializeCsv(LEADERBOARD_COLUMNS, csvRows, withBom);
}

// ── Challenge submissions export ──────────────────────────────────────────────

const CHALLENGE_COLUMNS: CsvColumnDef[] = [
  { header: "Submission ID", key: "submissionId" },
  { header: "Entry ID", key: "entryId" },
  { header: "Round ID", key: "roundId" },
  { header: "Revision No", key: "revisionNo", isNumeric: true },
  { header: "Is Draft", key: "isDraft" },
  { header: "Is Counted", key: "isCounted" },
  { header: "Is Late", key: "isLate" },
  { header: "GitHub URL", key: "githubUrl" },
  { header: "Demo URL", key: "demoUrl" },
  { header: "Video URL", key: "videoUrl" },
  { header: "Notes", key: "notes" },
  { header: "Submitted At (UTC)", key: "submittedAt" },
];

/**
 * Export all submission revisions for an event as CSV (FR-EXP-04).
 * One row per revision — use 'is_counted' to identify the canonical submission.
 */
export async function exportChallengeSubmissions(eventId: string): Promise<string> {
  const [evt] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!evt) throw new NotFoundError("Event");

  const rows = await db
    .select({
      submissionId: submissions.id,
      entryId: submissions.entryId,
      roundId: challengeTasks.roundId,
      countedRevisionId: submissions.countedRevisionId,
      revisionNo: submissionRevisions.revisionNo,
      revisionId: submissionRevisions.id,
      isDraft: submissionRevisions.isDraft,
      isLate: submissionRevisions.isLate,
      urls: submissionRevisions.urls,
      notes: submissionRevisions.notes,
      createdAt: submissionRevisions.createdAt,
    })
    .from(submissionRevisions)
    .innerJoin(submissions, eq(submissionRevisions.submissionId, submissions.id))
    .innerJoin(challengeTasks, eq(submissions.taskId, challengeTasks.id))
    .where(eq(submissions.eventId, eventId))
    .orderBy(submissions.entryId, submissionRevisions.revisionNo);

  const csvRows: Record<string, CellValue>[] = rows.map((r) => {
    const urls = (r.urls ?? {}) as Record<string, string>;
    return {
      submissionId: r.submissionId,
      entryId: r.entryId,
      roundId: r.roundId,
      revisionNo: r.revisionNo,
      isDraft: r.isDraft ? "true" : "false",
      isCounted: r.countedRevisionId === r.revisionId ? "true" : "false",
      isLate: r.isLate ? "true" : "false",
      githubUrl: urls["githubUrl"] ?? "",
      demoUrl: urls["demoUrl"] ?? "",
      videoUrl: urls["videoUrl"] ?? "",
      notes: r.notes ?? "",
      submittedAt: r.createdAt?.toISOString() ?? "",
    };
  });

  return serializeCsv(CHALLENGE_COLUMNS, csvRows, withBom);
}

// ── Evaluations export ────────────────────────────────────────────────────────

const EVALUATION_COLUMNS: CsvColumnDef[] = [
  { header: "Submission ID", key: "submissionId" },
  { header: "Judge User ID", key: "judgeUserId" },
  { header: "Criterion", key: "criterionName" },
  { header: "Max Marks", key: "maxMarks", isNumeric: true },
  { header: "Marks Awarded", key: "marksAwarded", isNumeric: true },
  { header: "Criterion Comment", key: "criterionComment" },
  { header: "Overall Comment", key: "overallComment" },
  { header: "Evaluation Status", key: "evaluationStatus" },
  { header: "Revision No", key: "revisionNo", isNumeric: true },
  { header: "Submitted At (UTC)", key: "submittedAt" },
];

/**
 * Export all judge evaluations × criteria for an event as CSV (FR-EXP-05).
 * One row per judge × criterion (latest submitted revision per assignment).
 */
export async function exportEvaluations(eventId: string): Promise<string> {
  const [evt] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!evt) throw new NotFoundError("Event");

  // Get all rubrics for this event to join criteria
  const criteria = await db
    .select({
      id: evaluationCriteria.id,
      name: evaluationCriteria.name,
      maxMarks: evaluationCriteria.maxMarks,
      rubricId: evaluationCriteria.rubricId,
    })
    .from(evaluationCriteria)
    .innerJoin(evaluationRubrics, eq(evaluationCriteria.rubricId, evaluationRubrics.id))
    .where(eq(evaluationRubrics.eventId, eventId));

  const criteriaMap = new Map(criteria.map((c) => [c.id, c]));

  // Get latest submitted evaluation per (assignment, revisionNo DESC)
  const rawRows = await db.execute<{
    submission_id: string;
    judge_user_id: string;
    evaluation_id: string;
    evaluation_status: string;
    revision_no: number;
    overall_comment: string | null;
    submitted_at: string | null;
    criterion_id: string;
    marks_awarded: string;
    criterion_comment: string | null;
  }>(sql`
    WITH latest_evals AS (
      SELECT DISTINCT ON (je.assignment_id)
        je.id AS evaluation_id,
        ja.submission_id,
        je.judge_user_id,
        je.status AS evaluation_status,
        je.revision_no,
        je.comment AS overall_comment,
        je.submitted_at
      FROM app.judge_evaluations je
      JOIN app.judging_assignments ja ON ja.id = je.assignment_id
      WHERE je.event_id = ${eventId}
        AND je.status IN ('submitted', 'locked')
      ORDER BY je.assignment_id, je.revision_no DESC
    )
    SELECT
      le.submission_id,
      le.judge_user_id,
      le.evaluation_id,
      le.evaluation_status,
      le.revision_no,
      le.overall_comment,
      le.submitted_at::TEXT,
      jes.criterion_id,
      jes.marks_awarded,
      jes.comment AS criterion_comment
    FROM latest_evals le
    JOIN app.judge_evaluation_scores jes ON jes.evaluation_id = le.evaluation_id
    ORDER BY le.submission_id, le.judge_user_id, jes.criterion_id
  `);

  const csvRows: Record<string, CellValue>[] = Array.from(rawRows).map((r) => {
    const criterion = criteriaMap.get(r.criterion_id);
    return {
      submissionId: r.submission_id,
      judgeUserId: r.judge_user_id,
      criterionName: criterion?.name ?? r.criterion_id,
      maxMarks: criterion ? Number(criterion.maxMarks) : 0,
      marksAwarded: Number(r.marks_awarded ?? 0),
      criterionComment: r.criterion_comment ?? "",
      overallComment: r.overall_comment ?? "",
      evaluationStatus: r.evaluation_status,
      revisionNo: r.revision_no,
      submittedAt: r.submitted_at ?? "",
    };
  });

  return serializeCsv(EVALUATION_COLUMNS, csvRows, withBom);
}

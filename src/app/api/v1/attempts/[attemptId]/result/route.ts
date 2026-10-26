/**
 * GET /api/v1/attempts/[attemptId]/result
 *
 * Returns the scored result of a submitted quiz attempt.
 *
 * Auth:
 *   - Participants: can only retrieve their own entry's attempt (attempt:take scope)
 *   - Admins/judges: can retrieve any attempt in their event (quiz:author / judging:score)
 *
 * BR-07: isCorrect is intentionally omitted for participants until results are published.
 *        reviewStatus is included to indicate pending_review items.
 * BR-09: score_records is append-only — latest non-superseded record is canonical.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, buildActor, resolveAppUser } from "@/core/auth";
import { can } from "@/core/authz";
import { toHttpError, NotFoundError, ForbiddenError } from "@/core/errors";
import { db } from "@/core/db";
import {
  quizAttempts, attemptQuestions, quizResponses, questionVersions,
  questionOptions, scoreRecords, participants, entries, teams,
} from "@/core/db/schema";
import { eq, and, inArray } from "drizzle-orm";

interface Params { params: Promise<{ attemptId: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { attemptId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const appUser = await resolveAppUser(sessionUser);
  if (!appUser) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

  try {
    // Load attempt
    const [attempt] = await db
      .select({
        id: quizAttempts.id,
        roundId: quizAttempts.roundId,
        eventId: quizAttempts.eventId,
        entryId: quizAttempts.entryId,
        status: quizAttempts.status,
        startedAt: quizAttempts.startedAt,
        deadlineAt: quizAttempts.deadlineAt,
        submittedAt: quizAttempts.submittedAt,
        scoredAt: quizAttempts.scoredAt,
        scoreRecordId: quizAttempts.scoreRecordId,
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attemptId))
      .limit(1);

    if (!attempt) throw new NotFoundError("Attempt");

    // Auth: build actor and check permissions
    const actor = await buildActor(appUser.id);

    // Determine if requester is an admin/judge for this event
    const eventScope = { type: "event" as const, eventId: attempt.eventId };
    const isPrivileged =
      can(actor, "quiz:author", eventScope) ||
      can(actor, "judging:score", eventScope);

    if (!isPrivileged) {
      // Participant: must be a member of the attempt's entry
      const [participantRow] = await db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.userId, appUser.id),
            eq(participants.eventId, attempt.eventId),
            eq(participants.status, "approved"),
          ),
        )
        .limit(1);

      if (!participantRow) throw new ForbiddenError("Not a participant in this event");

      // Entry ownership: individual owner, or team captain (no team_members table yet).
      const [entryRow] = await db
        .select({
          entryType: entries.entryType,
          participantId: entries.participantId,
          captainParticipantId: teams.captainParticipantId,
        })
        .from(entries)
        .leftJoin(teams, eq(entries.teamId, teams.id))
        .where(and(eq(entries.id, attempt.entryId), eq(entries.eventId, attempt.eventId)))
        .limit(1);

      if (!entryRow) throw new ForbiddenError("Entry not found");
      const owner =
        entryRow.entryType === "team" ? entryRow.captainParticipantId : entryRow.participantId;
      if (owner !== participantRow.id) throw new ForbiddenError("Not a member of this entry");
    }

    // Only submitted attempts have results
    if (attempt.status === "in_progress") {
      return NextResponse.json(
        { error: "Attempt is still in progress", status: attempt.status },
        { status: 409 },
      );
    }

    // Load score record
    let scoreResult: { rawScore: string; finalScore: string; penalty: string } | null = null;
    if (attempt.scoreRecordId) {
      const [sr] = await db
        .select({
          rawScore: scoreRecords.rawScore,
          finalScore: scoreRecords.finalScore,
          penalty: scoreRecords.penalty,
        })
        .from(scoreRecords)
        .where(eq(scoreRecords.id, attempt.scoreRecordId))
        .limit(1);
      scoreResult = sr ?? null;
    }

    // Load per-question breakdown
    const aqRows = await db
      .select({
        aqId: attemptQuestions.id,
        questionId: attemptQuestions.questionId,
        versionId: attemptQuestions.versionId,
        displayOrder: attemptQuestions.displayOrder,
        stem: questionVersions.stem,
        stemImageUrl: questionVersions.stemImageUrl,
        marks: questionVersions.marks,
        negMarks: questionVersions.negMarks,
      })
      .from(attemptQuestions)
      .innerJoin(questionVersions, eq(attemptQuestions.versionId, questionVersions.id))
      .where(eq(attemptQuestions.attemptId, attemptId))
      .orderBy(attemptQuestions.displayOrder);

    // Load responses (what they answered)
    const responses = await db
      .select({
        attemptQuestionId: quizResponses.attemptQuestionId,
        selectedOptionIds: quizResponses.selectedOptionIds,
        textAnswer: quizResponses.textAnswer,
        isCorrect: quizResponses.isCorrect,
        reviewStatus: quizResponses.reviewStatus,
        savedAt: quizResponses.savedAt,
      })
      .from(quizResponses)
      .where(eq(quizResponses.attemptId, attemptId));

    const responseMap = new Map(responses.map((r) => [r.attemptQuestionId, r]));

    // Load participant-facing options (NO isCorrect — BR-07)
    const versionIds = aqRows.map((r) => r.versionId);
    const optRows = versionIds.length > 0
      ? await db
          .select({
            id: questionOptions.id,
            versionId: questionOptions.versionId,
            optionText: questionOptions.optionText,
            optionImageUrl: questionOptions.optionImageUrl,
            displayOrder: questionOptions.displayOrder,
            // isCorrect intentionally excluded (BR-07) for non-privileged
          })
          .from(questionOptions)
          .where(inArray(questionOptions.versionId, versionIds))
      : [];

    const optsByVersion = new Map<string, typeof optRows>();
    for (const opt of optRows) {
      const list = optsByVersion.get(opt.versionId) ?? [];
      list.push(opt);
      optsByVersion.set(opt.versionId, list);
    }

    const questions = aqRows.map((aq) => {
      const resp = responseMap.get(aq.aqId);
      const opts = (optsByVersion.get(aq.versionId) ?? [])
        .sort((a, b) => a.displayOrder - b.displayOrder);

      return {
        attemptQuestionId: aq.aqId,
        questionId: aq.questionId,
        displayOrder: aq.displayOrder,
        stem: aq.stem,
        stemImageUrl: aq.stemImageUrl,
        marks: aq.marks,
        negMarks: aq.negMarks,
        options: opts,
        // What the participant answered
        response: resp
          ? {
              selectedOptionIds: resp.selectedOptionIds ?? [],
              textAnswer: resp.textAnswer,
              savedAt: resp.savedAt,
              // isCorrect: only shown to privileged actors
              isCorrect: isPrivileged ? resp.isCorrect : undefined,
              reviewStatus: resp.reviewStatus,
            }
          : null,
      };
    });

    const hasPendingReview = responses.some((r) => r.reviewStatus === "pending_review");

    return NextResponse.json({
      attempt: {
        id: attempt.id,
        roundId: attempt.roundId,
        eventId: attempt.eventId,
        entryId: attempt.entryId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        submittedAt: attempt.submittedAt,
        scoredAt: attempt.scoredAt,
      },
      score: scoreResult,
      hasPendingReview,
      questions,
    });
  } catch (err) {
    const http = toHttpError(err, "");
    return NextResponse.json({ error: http.message }, { status: http.statusCode });
  }
}

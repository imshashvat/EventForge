/**
 * Round page â€” Server Component shell for quiz and challenge rounds.
 *
 * Dispatches to:
 *   - QuizClient    for roundType === "quiz"
 *   - ChallengeClient for roundType === "challenge"
 *
 * Route: /e/[slug]/rounds/[roundId]
 */
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, resolveAppUser } from "@/core/auth";
import { getEventBySlug, getRoundById } from "@/modules/events";
import { db } from "@/core/db";
import {
  participants,
  entries,
  challengeTasks,
  challengeStarts,
  submissions,
  submissionRevisions,
} from "@/core/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { startAttempt } from "@/modules/quiz/service";
import { QuizClient } from "./quiz-client";
import { ChallengeClient } from "./challenge-client";

interface Params {
  params: Promise<{ slug: string; roundId: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, roundId } = await params;
  const event = await getEventBySlug(slug).catch(() => null);
  const round = event ? await getRoundById({ eventId: event.id }, roundId).catch(() => null) : null;
  return {
    title: `${round?.name ?? "Round"} â€” ${event?.name ?? slug} â€” EventForge`,
  };
}

export default async function RoundPage({ params }: Params) {
  const { slug, roundId } = await params;

  // 1. Require auth
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect(`/sign-in?next=/e/${slug}/rounds/${roundId}`);

  // 2. Load event + round
  const event = await getEventBySlug(slug).catch(() => null);
  if (!event) notFound();

  const round = await getRoundById({ eventId: event.id }, roundId).catch(() => null);
  if (!round) notFound();

  // Unsupported round type â€” only quiz and challenge render a UI
  if (round.roundType !== "quiz" && round.roundType !== "challenge") redirect(`/e/${slug}`);

  // If the round isn't open, redirect to the event page
  if (round.status !== "open") redirect(`/e/${slug}`);

  // 3. Resolve app-layer user
  let appUser: { id: string; displayName: string };
  try {
    appUser = await resolveAppUser(sessionUser);
  } catch {
    redirect(`/sign-in?next=/e/${slug}/rounds/${roundId}`);
  }

  // 4. Look up the approved participant record
  const [participant] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.userId, appUser.id),
        eq(participants.eventId, event.id),
        eq(participants.status, "approved"),
      ),
    )
    .limit(1);

  if (!participant) redirect(`/e/${slug}`);

  // 5. Find the participant's individual entry
  const [entry] = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.eventId, event.id),
        eq(entries.participantId, participant.id),
        eq(entries.entryType, "individual"),
      ),
    )
    .limit(1);

  if (!entry) redirect(`/e/${slug}`);

  // â”€â”€ Header shared by both round types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const RoundHeader = ({ subtitle }: { subtitle: string }) => (
    <header
      className="sticky top-0 z-30 h-14 border-b flex items-center px-4 sm:px-6 gap-4"
      style={{
        background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
          {round.name}
        </p>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
      </div>
      <div className="badge badge-live shrink-0 text-xs">Live</div>
    </header>
  );

  // â”€â”€ QUIZ round â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (round.roundType === "quiz") {
    let attempt: Awaited<ReturnType<typeof startAttempt>>;
    try {
      attempt = await startAttempt({
        roundId,
        entryId: entry.id,
        participantId: participant.id,
        requestId: crypto.randomUUID(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("submitted") || msg.includes("closed") || msg.includes("not open")) {
        redirect(`/e/${slug}`);
      }
      throw err;
    }

    const clientQuestions = attempt.questions.map((q) => ({
      id: q.attemptQuestionId,
      body: q.stem,
      position: q.displayOrder,
      pointValue: 10,
      options: q.options.map((o) => ({
        id: o.id,
        body: o.optionText,
        position: o.displayOrder,
      })),
    }));

    const totalPoints = clientQuestions.reduce((s, q) => s + q.pointValue, 0);

    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <RoundHeader subtitle={`${event.name} Â· ${totalPoints} points total`} />
        <QuizClient
          attemptId={attempt.attemptId}
          eventId={event.id}
          roundId={roundId}
          questions={clientQuestions}
          deadlineAt={attempt.deadlineAt.toISOString()}
          totalPoints={totalPoints}
        />
      </main>
    );
  }

  // â”€â”€ CHALLENGE round â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Load the challenge task for this round
  const [task] = await db
    .select()
    .from(challengeTasks)
    .where(and(eq(challengeTasks.roundId, roundId), eq(challengeTasks.eventId, event.id)))
    .limit(1);

  if (!task) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <RoundHeader subtitle={event.name} />
        <div className="container py-16 text-center" style={{ color: "var(--text-2)" }}>
          <p>Challenge task not yet published. Check back soon.</p>
        </div>
      </main>
    );
  }

  // Load existing submission state
  const [submission] = await db
    .select({ id: submissions.id, status: submissions.status })
    .from(submissions)
    .where(and(eq(submissions.taskId, task.id), eq(submissions.entryId, entry.id)))
    .limit(1);

  // Load challenge start (for deadline)
  const [challengeStart] = await db
    .select({ deadlineAt: challengeStarts.deadlineAt })
    .from(challengeStarts)
    .where(and(eq(challengeStarts.taskId, task.id), eq(challengeStarts.entryId, entry.id)))
    .limit(1);

  // Load latest revision (for pre-filled URLs)
  const latestRevision = submission
    ? await db
        .select({ urls: submissionRevisions.urls })
        .from(submissionRevisions)
        .where(eq(submissionRevisions.submissionId, submission.id))
        .orderBy(desc(submissionRevisions.revisionNo))
        .limit(1)
        .then((rows) => rows[0])
    : null;

  // Count revisions
  const revisionCount = submission
    ? await db
        .select({ count: submissionRevisions.id })
        .from(submissionRevisions)
        .where(eq(submissionRevisions.submissionId, submission.id))
        .then((rows) => rows.length)
    : 0;

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <RoundHeader subtitle={`${event.name} Â· Challenge round`} />
      <ChallengeClient
        eventId={event.id}
        roundId={roundId}
        taskId={task.id}
        entryId={entry.id}
        task={{
          id: task.id,
          title: task.title,
          description: task.description ?? "",
          allowedUrlTypes: (task.allowedUrlTypes as string[] | null) ?? [],
          maxRevisions: null,
        }}
        deadlineAt={challengeStart?.deadlineAt?.toISOString() ?? null}
        initialUrls={(latestRevision?.urls as Record<string, string>) ?? {}}
        initialStatus={submission?.status === "submitted" ? "submitted" : "draft"}
        revisionCount={revisionCount}
      />
    </main>
  );
}

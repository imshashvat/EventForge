/**
 * Admin question authoring page — /admin/events/[eventId]/questions
 * Server Component shell — auth gate + renders the client island.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { getEventById } from "@/modules/events";
import { QuestionAuthoringClient } from "./question-authoring";

export const metadata: Metadata = {
  title: "Questions — Admin — EventForge",
};

interface Params { params: Promise<{ eventId: string }> }

export default async function QuestionsPage({ params }: Params) {
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) redirect(`/sign-in?next=/admin/events/${eventId}/questions`);

  const appUser = await resolveAppUser(session);
  const actor = await buildActor(appUser.id);

  if (!can(actor, "quiz:author", { type: "event", eventId })) redirect("/admin/events");

  const event = await getEventById(eventId);
  if (!event) notFound();

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header
        className="sticky top-0 z-30 h-14 border-b flex items-center px-6 gap-4"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderColor: "var(--border)",
        }}
      >
        <Link href={`/admin/events/${eventId}`} className="text-sm" style={{ color: "var(--text-secondary)" }}>
          ← {event.name}
        </Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
          Questions
        </span>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            Question Banks
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Organise questions into banks, then assign banks to quiz rounds.
          </p>
        </div>

        <div
          className="rounded-2xl border p-6"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <QuestionAuthoringClient eventId={eventId} />
        </div>
      </main>
    </div>
  );
}

/**
 * Admin registration form builder page — /admin/events/[eventId]/form
 */
import { type Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { getEventById } from "@/modules/events";
import { RegistrationFormBuilder } from "./form-builder";

export const metadata: Metadata = { title: "Registration Form — Admin — EventForge" };

interface Params { params: Promise<{ eventId: string }> }

export default async function FormBuilderPage({ params }: Params) {
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) redirect(`/sign-in?next=/admin/events/${eventId}/form`);

  const appUser = await resolveAppUser(session);
  const actor = await buildActor(appUser.id);

  if (!can(actor, "event:update", { type: "event", eventId })) redirect("/admin/events");

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
          Registration Form
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            Registration Form
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Add custom fields participants must fill when registering for this event.
          </p>
        </div>

        <div className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}>
          <RegistrationFormBuilder eventId={eventId} />
        </div>
      </main>
    </div>
  );
}

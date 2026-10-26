/**
 * Admin — Create new event page (/admin/events/new)
 *
 * Server Component shell: handles auth gate and renders the client form.
 */
import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { CreateEventForm } from "./create-form";

export const metadata: Metadata = {
  title: "Create Event — Admin — EventForge",
};

export default async function NewEventPage() {
  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin/events/new");

  const appUser = await resolveAppUser(session);
  const actor = await buildActor(appUser.id);

  // Only super_admin or event_admin at global scope can create events
  if (!can(actor, "event:create", { type: "global" })) {
    redirect("/admin/events");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-30 h-14 border-b flex items-center px-6 gap-4"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderColor: "var(--border)",
        }}
      >
        <Link
          href="/admin/events"
          className="text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Events
        </Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
        >
          Create event
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1
            className="text-2xl font-bold mb-1"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Create a new event
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Fill in the details below. You can edit these later and add rounds from the event management page.
          </p>
        </div>

        <div
          className="rounded-2xl border p-6 sm:p-8"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <CreateEventForm />
        </div>
      </main>
    </div>
  );
}

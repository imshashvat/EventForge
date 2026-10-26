/**
 * Admin participants page — /admin/events/[eventId]/participants
 *
 * Lists all participants for the event with status, registration date, and
 * export controls. Provides direct links to approve / reject pending entries.
 */
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/core/auth";
import { getEventById } from "@/modules/events";
import { db } from "@/core/db";
import { participants, users, entries } from "@/core/db/schema";
import { and, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Participants — Admin — EventForge",
};

interface Params {
  params: Promise<{ eventId: string }>;
}

const STATUS_COLORS: Record<string, Parameters<typeof Badge>[0]["status"]> = {
  approved: "open",
  pending: "default",
  rejected: "default",
  withdrawn: "default",
};

export default async function AdminParticipantsPage({ params }: Params) {
  const { eventId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const event = await getEventById(eventId);
  if (!event) notFound();

  const rows = await db
    .select({
      participantId: participants.id,
      participantNo: participants.participantNo,
      displayName: users.displayName,
      status: participants.status,
      registeredAt: participants.registeredAt,
      entryId: entries.id,
      entryType: entries.entryType,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .leftJoin(
      entries,
      and(
        eq(entries.eventId, participants.eventId),
        eq(entries.participantId, participants.id),
      ),
    )
    .where(eq(participants.eventId, eventId))
    .orderBy(participants.participantNo);

  const approved = rows.filter((r) => r.status === "approved").length;
  const pending = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-30 h-14 flex items-center border-b px-4 sm:px-6 gap-4"
        style={{
          background: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
          backdropFilter: "blur(12px)",
          borderColor: "var(--border)",
        }}
      >
        <Link
          href={`/admin/events/${eventId}`}
          className="text-sm hover:text-[var(--teal-300)] transition-colors"
          style={{ color: "var(--text-secondary)" }}
        >
          ← {event.name}
        </Link>
        <div className="w-px h-5 shrink-0" style={{ background: "var(--border)" }} aria-hidden="true" />
        <h1
          className="text-sm font-semibold flex-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          Participants
        </h1>

        <Button variant="secondary" size="sm" asChild>
          <Link href={`/api/v1/events/${eventId}/exports?type=participants`}>
            ↓ Export CSV
          </Link>
        </Button>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col gap-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total", value: rows.length },
            { label: "Approved", value: approved },
            { label: "Pending", value: pending },
          ].map(({ label, value }) => (
            <Card key={label} variant="compact">
              <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{label}</p>
              <p
                className="text-2xl font-bold tabular-nums"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                {value}
              </p>
            </Card>
          ))}
        </div>

        {/* Participants table */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div
            className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: "var(--border)" }}
          >
            <h2
              className="font-semibold text-sm"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              All participants ({rows.length})
            </h2>
          </div>

          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                No registrations yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Name", "Entry", "Status", "Registered"].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: "var(--text-disabled)" }}
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.participantId}
                      className="grid transition-colors hover:bg-white/[0.03]"
                      style={{ gridTemplateColumns: "3rem 1fr 8rem 8rem 10rem", borderBottom: "1px solid var(--border)" }}
                    >
                      <td
                        className="px-5 py-3 tabular-nums font-mono text-xs"
                        style={{ color: "var(--text-disabled)" }}
                      >
                        {row.participantNo}
                      </td>
                      <td className="px-5 py-3 font-medium" style={{ color: "var(--text-primary)" }}>
                        {row.displayName}
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {row.entryType ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Badge status={STATUS_COLORS[row.status ?? "pending"] ?? "default"}>
                          {row.status ?? "pending"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {row.registeredAt
                          ? new Date(row.registeredAt).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {row.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <form
                              action={`/api/v1/events/${eventId}/registrations/${row.participantId}`}
                              method="PATCH"
                            >
                              <input type="hidden" name="status" value="approved" />
                              <Button type="submit" size="sm" variant="primary">
                                Approve
                              </Button>
                            </form>
                            <form
                              action={`/api/v1/events/${eventId}/registrations/${row.participantId}`}
                              method="PATCH"
                            >
                              <input type="hidden" name="status" value="rejected" />
                              <Button type="submit" size="sm" variant="danger">
                                Reject
                              </Button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

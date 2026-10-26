/**
 * Admin Staff Management — /admin/events/[eventId]/staff
 *
 * Add/remove staff roles (event_admin, round_manager, judge, reviewer, observer).
 * Uses the roles API endpoint via client actions.
 */
import "server-only";
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { getEventById } from "@/modules/events";
import { db } from "@/core/db";
import { roleAssignments, users } from "@/core/db/schema";
import { eq, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { StaffActions } from "./staff-actions";

interface Params { params: Promise<{ eventId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getEventById(eventId).catch(() => null);
  return { title: `Staff — ${event?.name ?? "Event"} — Admin — EventForge` };
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  event_admin: "Event Admin",
  round_manager: "Round Manager",
  judge: "Judge",
  reviewer: "Reviewer",
  observer: "Observer",
  participant: "Participant",
};

const ROLE_COLORS: Record<string, Parameters<typeof Badge>[0]["status"]> = {
  super_admin: "live",
  event_admin: "open",
  round_manager: "published",
  judge: "pending",
  reviewer: "pending",
  observer: "draft",
};

export default async function StaffPage({ params }: Params) {
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin");

  const appUser = await resolveAppUser(session).catch(() => null);
  if (!appUser) redirect("/sign-in");

  const actor = await buildActor(appUser.id);
  if (!can(actor, "event:assign_roles", { type: "event", eventId })) redirect("/admin/events");

  const event = await getEventById(eventId).catch(() => null);
  if (!event) notFound();

  const staffRows = await db
    .select({
      id: roleAssignments.id,
      userId: roleAssignments.userId,
      roleKey: roleAssignments.roleKey,
      grantedAt: roleAssignments.createdAt,
      displayName: users.displayName,
    })
    .from(roleAssignments)
    .leftJoin(users, eq(roleAssignments.userId, users.id))
    .where(eq(roleAssignments.eventId, eventId))
    .orderBy(desc(roleAssignments.createdAt));

  // Group by userId
  const byUser = staffRows.reduce<Record<string, typeof staffRows>>((acc, r) => {
    if (!acc[r.userId]) acc[r.userId] = [];
    acc[r.userId]!.push(r);
    return acc;
  }, {});

  return (
    <div className="staff-page">
      <div className="staff-header">
        <nav className="staff-breadcrumb">
          <Link href="/admin/events">Events</Link>
          <span>›</span>
          <Link href={`/admin/events/${eventId}`}>{event.name}</Link>
          <span>›</span>
          <span>Staff</span>
        </nav>
        <h1 className="staff-title">Staff & Roles</h1>
        <p className="staff-subtitle">Manage who has admin access to this event.</p>
      </div>

      {/* Add staff form */}
      <div className="staff-add-card">
        <h2 className="staff-add-title">Add Staff Member</h2>
        <StaffActions eventId={eventId} action="add" />
      </div>

      {/* Current staff */}
      <div className="staff-list-card">
        <h2 className="staff-list-title">Current Staff ({Object.keys(byUser).length})</h2>
        {staffRows.length === 0 ? (
          <p className="staff-empty">No staff members added yet.</p>
        ) : (
          <div className="staff-list">
            {Object.entries(byUser).map(([userId, roles]) => (
              <div key={userId} className="staff-item">
                <div className="staff-item-info">
                  <span className="staff-item-name">{roles[0]?.displayName ?? userId.slice(0, 8)}</span>
                  <div className="staff-item-roles">
                    {roles.map(r => (
                      <Badge key={r.id} status={ROLE_COLORS[r.roleKey] ?? "draft"}>
                        {ROLE_LABELS[r.roleKey] ?? r.roleKey}
                      </Badge>
                    ))}
                  </div>
                </div>
                <StaffActions eventId={eventId} action="remove" userId={userId} {...(roles[0]?.roleKey ? { roleKey: roles[0].roleKey } : {})} />
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .staff-page { max-width: 800px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); display: flex; flex-direction: column; gap: var(--space-5); }
        .staff-header { margin-bottom: var(--space-2); }
        .staff-breadcrumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-2); margin-bottom: var(--space-3); }
        .staff-breadcrumb a { color: var(--text-2); text-decoration: none; }
        .staff-breadcrumb a:hover { color: var(--text-1); }
        .staff-title { font-family: Georgia, serif; font-size: var(--text-2xl); font-weight: 400; color: var(--text-1); margin: 0; }
        .staff-subtitle { font-size: var(--text-sm); color: var(--text-2); margin-top: var(--space-1); }
        .staff-add-card, .staff-list-card { border: 1px solid var(--border); background: var(--surface-1); }
        .staff-add-title, .staff-list-title { font-size: var(--text-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin: 0; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border); }
        .staff-empty { padding: var(--space-8) var(--space-5); color: var(--text-3); font-size: var(--text-sm); text-align: center; }
        .staff-list { display: flex; flex-direction: column; }
        .staff-item { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .staff-item:last-child { border-bottom: none; }
        .staff-item-info { display: flex; flex-direction: column; gap: var(--space-2); }
        .staff-item-name { font-size: var(--text-sm); font-weight: 500; color: var(--text-1); }
        .staff-item-roles { display: flex; gap: var(--space-2); flex-wrap: wrap; }
      `}</style>
    </div>
  );
}

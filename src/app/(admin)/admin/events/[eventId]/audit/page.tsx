/**
 * Admin Audit Log Viewer — /admin/events/[eventId]/audit
 *
 * Displays the append-only audit trail for an event.
 * Paginated, with action filter. Admin-only.
 */
import "server-only";
import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, resolveAppUser, buildActor } from "@/core/auth";
import { can } from "@/core/authz";
import { getEventById } from "@/modules/events";
import { db } from "@/core/db";
import { auditLogs } from "@/core/audit";
import { eq, desc, count } from "drizzle-orm";

interface Params { params: Promise<{ eventId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getEventById(eventId).catch(() => null);
  return { title: `Audit Log — ${event?.name ?? "Event"} — Admin — EventForge` };
}

const PAGE_SIZE = 50;

export default async function AuditPage({ params }: Params) {
  const { eventId } = await params;

  const session = await getSessionUser();
  if (!session) redirect("/sign-in?next=/admin");

  const appUser = await resolveAppUser(session).catch(() => null);
  if (!appUser) redirect("/sign-in");

  const actor = await buildActor(appUser.id);
  if (!can(actor, "event:update", { type: "event", eventId })) redirect("/admin/events");

  const event = await getEventById(eventId).catch(() => null);
  if (!event) notFound();

  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.eventId, eventId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE);

  const totalResult = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(eq(auditLogs.eventId, eventId));
  const total = totalResult[0]?.total ?? 0;

  function formatAction(action: string) {
    return action.replace(/\./g, " › ");
  }

  function actionColor(action: string) {
    if (action.includes("reject") || action.includes("delete") || action.includes("cancel")) return "var(--error)";
    if (action.includes("approve") || action.includes("create") || action.includes("open")) return "var(--success)";
    if (action.includes("update") || action.includes("pause") || action.includes("waitlist")) return "var(--amber, #f59e0b)";
    return "var(--text-2)";
  }

  return (
    <div className="audit-page">
      {/* Header */}
      <div className="audit-header">
        <nav className="audit-breadcrumb">
          <Link href="/admin/events">Events</Link>
          <span>›</span>
          <Link href={`/admin/events/${eventId}`}>{event.name}</Link>
          <span>›</span>
          <span>Audit Log</span>
        </nav>
        <h1 className="audit-title">Audit Log</h1>
        <p className="audit-subtitle">{total} entries · showing latest {Math.min(PAGE_SIZE, logs.length)}</p>
      </div>

      {/* Table */}
      {logs.length === 0 ? (
        <div className="audit-empty">No audit entries yet.</div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Target</th>
                <th>Actor</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="audit-row">
                  <td className="audit-ts tabular-nums">
                    {new Date(log.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td>
                    <span className="audit-action" style={{ color: actionColor(log.action) }}>
                      {formatAction(log.action)}
                    </span>
                  </td>
                  <td className="audit-target">
                    <span className="audit-type">{log.targetType}</span>
                    {log.targetId && (
                      <span className="audit-id">{log.targetId.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="audit-actor">
                    <span className="audit-role">{log.actorRoleKey ?? "system"}</span>
                    {log.actorUserId && (
                      <span className="audit-uid">{log.actorUserId.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="audit-diff">
                    {(log.before ?? log.after) ? (
                      <details className="audit-details">
                        <summary>View diff</summary>
                        <pre className="audit-json">{JSON.stringify({ before: log.before, after: log.after }, null, 2)}</pre>
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .audit-page { max-width: 1200px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); }
        .audit-header { margin-bottom: var(--space-6); }
        .audit-breadcrumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-2); margin-bottom: var(--space-3); }
        .audit-breadcrumb a { color: var(--text-2); text-decoration: none; }
        .audit-breadcrumb a:hover { color: var(--text-1); }
        .audit-title { font-family: Georgia, serif; font-size: var(--text-2xl); font-weight: 400; color: var(--text-1); margin: 0; }
        .audit-subtitle { font-size: var(--text-sm); color: var(--text-3); margin-top: var(--space-1); }
        .audit-empty { padding: var(--space-12); text-align: center; color: var(--text-3); border: 1px dashed var(--border); }
        .audit-table-wrap { overflow-x: auto; border: 1px solid var(--border); }
        .audit-table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); }
        .audit-table th { text-align: left; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface-1); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); white-space: nowrap; }
        .audit-table td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: top; }
        .audit-row:last-child td { border-bottom: none; }
        .audit-row:hover td { background: var(--surface-2); }
        .audit-ts { color: var(--text-3); white-space: nowrap; font-family: var(--font-mono, monospace); font-size: 11px; }
        .audit-action { font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; }
        .audit-target, .audit-actor { display: flex; flex-direction: column; gap: 2px; }
        .audit-type { font-size: var(--text-xs); color: var(--text-1); font-weight: 500; }
        .audit-id, .audit-uid { font-size: 10px; color: var(--text-3); font-family: var(--font-mono, monospace); }
        .audit-role { font-size: var(--text-xs); color: var(--text-2); }
        .audit-details summary { cursor: pointer; color: var(--teal); font-size: var(--text-xs); }
        .audit-json { font-size: 10px; color: var(--text-2); white-space: pre-wrap; max-height: 200px; overflow-y: auto; margin-top: var(--space-2); background: var(--surface-2); padding: var(--space-2); border: 1px solid var(--border); max-width: 400px; }
      `}</style>
    </div>
  );
}

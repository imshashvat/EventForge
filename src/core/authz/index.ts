/**
 * core/authz — Role-based authorization (R-SEC-01, R-SEC-02, ARCHITECTURE.md §8)
 *
 * RULE: Every route handler must call authorize() before touching data.
 * The central authorize() function is the ONLY allowed decision point — no
 * inline permission checks in services or repos.
 *
 * Permissions map to the role matrix in ARCHITECTURE.md §8.2 / PRD §4.
 */
import "server-only";
import { ForbiddenError, UnauthenticatedError } from "@/core/errors";

// ── Permission catalogue ──────────────────────────────────────────────────────
export type Permission =
  | "event:create" | "event:update" | "event:lifecycle" | "event:assign_roles"
  | "registration:read" | "registration:review"
  | "registration:create"  // participants registering themselves
  | "team:manage"
  | "round:manage" | "round:control"
  | "quiz:author" | "quiz:preview"
  | "challenge:author"
  | "rubric:manage"
  | "attempt:take"
  | "submission:create" | "submission:read"
  | "judging:assign" | "judging:score" | "judging:reconcile"
  | "scores:finalize" | "scores:unlock"
  | "results:publish"
  | "leaderboard:configure" | "leaderboard:view"
  | "export:create" | "export:pii"
  | "audit:read"
  | "system:settings";

// ── Role keys ─────────────────────────────────────────────────────────────────
export type RoleKey =
  | "super_admin"
  | "event_admin"
  | "round_manager"
  | "judge"
  | "reviewer"
  | "participant";

// ── Permission sets per role (deny-by-default; list only ALLOWED) ─────────────
const ROLE_PERMISSIONS: Record<RoleKey, Set<Permission>> = {
  super_admin: new Set<Permission>([
    "event:create", "event:update", "event:lifecycle", "event:assign_roles",
    "registration:read", "registration:review", "registration:create",
    "team:manage",
    "round:manage", "round:control",
    "quiz:author", "quiz:preview", "challenge:author", "rubric:manage",
    "attempt:take", "submission:create", "submission:read",
    "judging:assign", "judging:score", "judging:reconcile",
    "scores:finalize", "scores:unlock", "results:publish",
    "leaderboard:configure", "leaderboard:view",
    "export:create", "export:pii",
    "audit:read", "system:settings",
  ]),
  event_admin: new Set<Permission>([
    "event:update", "event:lifecycle", "event:assign_roles",
    "registration:read", "registration:review",
    "team:manage",
    "round:manage", "round:control",
    "quiz:author", "quiz:preview", "challenge:author", "rubric:manage",
    "submission:read",
    "judging:assign", "judging:reconcile",
    "scores:finalize", "scores:unlock", "results:publish",
    "leaderboard:configure", "leaderboard:view",
    "export:create", "export:pii",
    "audit:read",
  ]),
  round_manager: new Set<Permission>([
    "registration:read",
    "round:manage", "round:control",
    "quiz:author", "quiz:preview", "challenge:author", "rubric:manage",
    "submission:read",
    "judging:assign", "judging:reconcile",
    "leaderboard:view",
    "export:create",
  ]),
  judge: new Set<Permission>([
    "submission:read",
    "judging:score",
    "leaderboard:view",
    "export:create",
  ]),
  reviewer: new Set<Permission>([
    "registration:read",
    "submission:read",
    "leaderboard:view",
    "export:create",
  ]),
  participant: new Set<Permission>([
    "registration:create",
    "team:manage",        // own team only — enforced by resource check
    "attempt:take",
    "submission:create",
    "leaderboard:view",   // subject to event policy
    "export:create",      // own data only — enforced by resource check
  ]),
};

// ── Actor / scope types ───────────────────────────────────────────────────────
export type ScopeType = "global" | "event" | "round";

export interface RoleAssignment {
  roleKey: RoleKey;
  scopeType: ScopeType;
  eventId?: string;
  roundId?: string;
}

export interface Actor {
  userId: string;
  assignments: RoleAssignment[];
}

export interface AuthScope {
  type: ScopeType;
  eventId?: string;
  roundId?: string;
}

// ── Core authorize function ───────────────────────────────────────────────────

/**
 * The single authorization decision point (R-SEC-01).
 * Throws ForbiddenError if the actor does not have the permission in scope.
 * Throws UnauthenticatedError if actor is null/undefined.
 *
 * Resource-level checks (ownership, assignment, status) happen AFTER
 * this function returns — they are not a substitute for permission checks.
 */
export function authorize(
  actor: Actor | null | undefined,
  permission: Permission,
  scope: AuthScope,
): void {
  if (!actor) throw new UnauthenticatedError();

  for (const assignment of actor.assignments) {
    if (!hasPermission(assignment.roleKey, permission)) continue;
    if (scopeMatches(assignment, scope)) return; // ALLOWED
  }

  throw new ForbiddenError(`Permission denied: ${permission}`);
}

function hasPermission(role: RoleKey, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

function scopeMatches(assignment: RoleAssignment, required: AuthScope): boolean {
  if (assignment.scopeType === "global") return true;
  if (assignment.scopeType === "event" && required.type !== "global") {
    return assignment.eventId === required.eventId;
  }
  if (assignment.scopeType === "round" && required.type === "round") {
    return (
      assignment.eventId === required.eventId &&
      assignment.roundId === required.roundId
    );
  }
  return false;
}

/**
 * Quick check — like authorize() but returns boolean instead of throwing.
 * Use only for conditional UI rendering, not for data-access decisions.
 */
export function can(
  actor: Actor | null | undefined,
  permission: Permission,
  scope: AuthScope,
): boolean {
  try {
    authorize(actor, permission, scope);
    return true;
  } catch {
    return false;
  }
}

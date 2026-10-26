/**
 * Supabase Auth adapter — server-side session helpers.
 * All functions that call cookies() must be async (Next.js 16 breaking change).
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { UnauthenticatedError, ForbiddenError } from "@/core/errors";
import { type Actor, type RoleKey, type ScopeType } from "@/core/authz";
import { db } from "@/core/db";
import { users, roleAssignments } from "@/core/db/schema";
import { eq, and, or, isNull, lte, gte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

/**
 * Create a Supabase server client that reads/writes cookies via Next.js
 * cookie store. Must be called inside a Server Component or Route Handler.
 * cookies() is async in Next.js 16 — always await this function.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
}

/**
 * Create a Supabase admin client (service-role key).
 * Only for auth admin operations — NEVER expose to the browser.
 */
export function createSupabaseAdminClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Get the authenticated Supabase user from the current request's session.
 * Returns null if no valid session exists (does not throw).
 */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return { id: user.id, email: user.email };
  } catch {
    return null;
  }
}

/**
 * Require an authenticated session. Throws UnauthenticatedError if none.
 */
export async function requireSession(): Promise<{ id: string; email: string }> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

/**
 * Look up the app-layer user record by Supabase auth UID.
 * Returns null if user has not been synced yet (e.g. first sign-in race).
 */
export async function lookupUserByAuthUid(
  authUid: string,
): Promise<{ id: string; displayName: string } | null> {
  const [row] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.authUid, authUid))
    .limit(1);
  return row ?? null;
}

/**
 * Identity bridge: resolve (and on first sign-in, create) the app-layer user
 * for a Supabase session. Idempotent and race-safe via UNIQUE(auth_uid).
 * Only a salted hash of the email is stored (users.email_hash).
 * Participant roles are granted per-event at registration, not here.
 */
export async function resolveAppUser(session: {
  id: string;
  email: string;
}): Promise<{ id: string; displayName: string }> {
  const existing = await lookupUserByAuthUid(session.id);
  if (existing) return existing;

  const pepper = process.env["EMAIL_HASH_PEPPER"] ?? "";
  const emailHash = createHash("sha256")
    .update(pepper + session.email.trim().toLowerCase())
    .digest("hex");
  const displayName = session.email.split("@")[0]?.slice(0, 60) || "User";

  await db
    .insert(users)
    .values({ authUid: session.id, displayName, emailHash })
    .onConflictDoNothing({ target: users.authUid });

  const created = await lookupUserByAuthUid(session.id);
  if (!created) throw new Error("Failed to provision app user");
  return created;
}

/**
 * Build an Actor for the given app-layer userId by loading all active
 * role_assignments from the DB. Temporal validity (valid_from/valid_until)
 * is evaluated against DB now() so the DB clock rule (BR-02) is respected.
 *
 * Called once per request in route handlers before authorize().
 */
export async function buildActor(userId: string): Promise<Actor> {
  const [account] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account || account.status !== "active") {
    throw new ForbiddenError("Account is not active");
  }

  const now = sql`now()`;
  const rows = await db
    .select({
      roleKey: roleAssignments.roleKey,
      scopeType: roleAssignments.scopeType,
      eventId: roleAssignments.eventId,
      roundId: roleAssignments.roundId,
    })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        // valid_from <= now() OR valid_from IS NULL
        or(isNull(roleAssignments.validFrom), lte(roleAssignments.validFrom, now)),
        // valid_until >= now() OR valid_until IS NULL
        or(isNull(roleAssignments.validUntil), gte(roleAssignments.validUntil, now)),
      ),
    );

  return {
    userId,
    assignments: rows.map((r) => ({
      roleKey: r.roleKey as RoleKey,
      scopeType: r.scopeType as ScopeType,
      ...(r.eventId != null && { eventId: r.eventId }),
      ...(r.roundId != null && { roundId: r.roundId }),
    })),
  };
}

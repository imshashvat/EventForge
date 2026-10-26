-- =============================================================================
-- Migration 0001: Users, roles, and permissions (IAM core)
-- FR-AUTH-*, FR-AUTHZ-*, ARCHITECTURE.md §8
-- =============================================================================

SET search_path TO app;

-- ── Users ─────────────────────────────────────────────────────────────────────
-- Mirrors Supabase auth.users — we store app-level profile data only.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links to Supabase auth.users.id (same UUID)
  auth_uid        UUID NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  email_hash      TEXT NOT NULL,         -- SHA-256 of normalised email (for lookups, not storage)
  avatar_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_auth_uid_idx ON users (auth_uid);
CREATE INDEX users_status_idx   ON users (status);

-- ── Roles ─────────────────────────────────────────────────────────────────────
-- Static role catalogue — these are seeded, not user-created.
CREATE TABLE roles (
  key         TEXT PRIMARY KEY,           -- e.g. 'super_admin', 'event_admin', etc.
  label       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Permission catalogue ──────────────────────────────────────────────────────
CREATE TABLE permissions (
  key         TEXT PRIMARY KEY,           -- e.g. 'event:create', 'attempt:take'
  label       TEXT NOT NULL,
  description TEXT
);

-- ── Role <-> Permission mapping ───────────────────────────────────────────────
CREATE TABLE role_permissions (
  role_key        TEXT NOT NULL REFERENCES roles (key) ON DELETE CASCADE,
  permission_key  TEXT NOT NULL REFERENCES permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- ── Role assignments ──────────────────────────────────────────────────────────
-- Scoped assignments: a user can be event_admin for event X, judge for event Y.
CREATE TABLE role_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_key    TEXT NOT NULL REFERENCES roles (key),
  -- Scope: global, event, or round
  scope_type  TEXT NOT NULL DEFAULT 'global'
                CHECK (scope_type IN ('global', 'event', 'round')),
  event_id    UUID,   -- FK to events added in migration 0002
  round_id    UUID,   -- FK to rounds added in migration 0004
  -- Temporal scope (null = permanent)
  valid_from  TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  granted_by  UUID REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uniqueness: one role per user per scope combination
  UNIQUE (user_id, role_key, scope_type, event_id, round_id)
);

CREATE INDEX role_assignments_user_idx  ON role_assignments (user_id);
CREATE INDEX role_assignments_event_idx ON role_assignments (event_id) WHERE event_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;

-- Deny by default (no policies = no access for anon/authenticated roles)
-- app_rw bypasses RLS via role attribute set at connection time.
-- These policies exist as a second line of defense only.
CREATE POLICY deny_all ON users           AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON roles           AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON permissions     AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON role_permissions AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON role_assignments AS RESTRICTIVE TO PUBLIC USING (false);

-- ── Seed: Role catalogue ──────────────────────────────────────────────────────
INSERT INTO roles (key, label, description) VALUES
  ('super_admin',   'Super Admin',    'Full platform access across all events'),
  ('event_admin',   'Event Admin',    'Full control over an assigned event'),
  ('round_manager', 'Round Manager',  'Manage rounds and judging within assigned events'),
  ('judge',         'Judge',          'Evaluate assigned submissions'),
  ('reviewer',      'Reviewer',       'Read-only access to registrations and submissions'),
  ('participant',   'Participant',    'Register and compete in events')
ON CONFLICT (key) DO NOTHING;

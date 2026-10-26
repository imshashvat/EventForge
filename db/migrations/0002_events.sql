-- =============================================================================
-- Migration 0002: Events and registration forms
-- FR-EVENT-*, FR-REG-*, BR-01, BR-03, BR-05, ARCHITECTURE.md §9
-- =============================================================================

SET search_path TO app;

-- ── Events ────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,     -- URL-safe identifier
  name            TEXT NOT NULL,
  tagline         TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','active','paused','completed','archived')),
  -- Temporal
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  -- Registration settings
  registration_mode TEXT NOT NULL DEFAULT 'open'
                      CHECK (registration_mode IN ('open','approval','closed','invite_only')),
  registration_opens_at  TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  max_participants INT CHECK (max_participants IS NULL OR max_participants > 0),
  -- Team settings
  team_mode       TEXT NOT NULL DEFAULT 'individual'
                    CHECK (team_mode IN ('individual','team','both')),
  min_team_size   INT NOT NULL DEFAULT 1,
  max_team_size   INT NOT NULL DEFAULT 1,
  -- Settings JSONB (leaderboard policy, branding, custom fields)
  settings        JSONB NOT NULL DEFAULT '{}',
  -- Metadata
  created_by      UUID NOT NULL REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_size_valid CHECK (min_team_size <= max_team_size)
);

CREATE INDEX events_status_idx    ON events (status);
CREATE INDEX events_slug_idx      ON events (slug);
CREATE INDEX events_starts_at_idx ON events (starts_at);

-- Add FK from role_assignments to events (created here, referenced in 0001)
ALTER TABLE role_assignments
  ADD CONSTRAINT role_assignments_event_id_fk
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

-- ── Atomic counters per event ─────────────────────────────────────────────────
-- Used for generating sequential, human-readable participant/team numbers.
-- Updated with UPDATE ... RETURNING using row-level locking.
CREATE TABLE event_counters (
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  counter_key TEXT NOT NULL,      -- e.g. 'participant_no', 'team_no'
  value       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, counter_key)
);

-- ── Registration forms ────────────────────────────────────────────────────────
CREATE TABLE registration_forms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  version     INT NOT NULL DEFAULT 1,
  is_current  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reg_forms_current_idx ON registration_forms (event_id)
  WHERE is_current = true;

-- ── Registration field definitions ────────────────────────────────────────────
CREATE TABLE registration_field_defs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       UUID NOT NULL REFERENCES registration_forms (id) ON DELETE CASCADE,
  event_id      UUID NOT NULL,   -- denormalised for composite FK checks
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL
                  CHECK (field_type IN ('text','email','phone','number','select','multi_select','file','boolean','date')),
  is_required   BOOLEAN NOT NULL DEFAULT false,
  is_unique     BOOLEAN NOT NULL DEFAULT false,  -- e.g. college_roll_no must be unique per event
  display_order INT NOT NULL DEFAULT 0,
  validation    JSONB,            -- e.g. {"max_length": 100, "pattern": "..."}
  options       JSONB,            -- for select/multi_select
  UNIQUE (form_id, field_key),
  FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_forms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_field_defs ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON events                  AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON event_counters          AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON registration_forms      AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON registration_field_defs AS RESTRICTIVE TO PUBLIC USING (false);

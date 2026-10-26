-- =============================================================================
-- Migration 0003: Participants, teams, and entries
-- FR-REG-*, FR-TEAM-*, BR-06, BR-07, BR-08, ARCHITECTURE.md §9
-- =============================================================================

SET search_path TO app;

-- ── Participants ──────────────────────────────────────────────────────────────
-- One participant row per (user, event). A user can participate in many events.
CREATE TABLE participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  participant_no  BIGINT NOT NULL,   -- sequential, human-readable (from event_counters)
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','waitlisted','withdrawn')),
  -- Snapshot of registration answers (versioned form at time of registration)
  form_answers    JSONB NOT NULL DEFAULT '{}',
  form_id         UUID REFERENCES registration_forms (id),
  -- Metadata
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES users (id),
  review_note     TEXT,
  -- Composite FK enforces same event_id throughout
  UNIQUE (event_id, user_id),
  UNIQUE (event_id, participant_no)
);

CREATE INDEX participants_event_idx  ON participants (event_id);
CREATE INDEX participants_user_idx   ON participants (user_id);
CREATE INDEX participants_status_idx ON participants (event_id, status);

-- ── Unique field value enforcement (BR-06) ────────────────────────────────────
-- Ensures that fields marked is_unique (e.g. roll number) cannot be duplicated
-- within the same event. The app layer checks this, but this table is the DB
-- enforcement layer.
CREATE TABLE participant_unique_values (
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  value       TEXT NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, field_key, value)
);

-- ── Teams ─────────────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  team_no     BIGINT NOT NULL,   -- sequential (from event_counters)
  status      TEXT NOT NULL DEFAULT 'forming'
                CHECK (status IN ('forming','ready','locked','disqualified')),
  captain_participant_id UUID,  -- FK added after participants table
  join_code   TEXT NOT NULL,    -- short random code for joining
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (event_id, team_no),
  UNIQUE (event_id, join_code)
);

ALTER TABLE teams
  ADD CONSTRAINT teams_captain_fk
    FOREIGN KEY (captain_participant_id)
    REFERENCES participants (id)
    ON DELETE SET NULL;

CREATE INDEX teams_event_idx    ON teams (event_id);
CREATE INDEX teams_join_code_idx ON teams (event_id, join_code);

-- ── Team members ──────────────────────────────────────────────────────────────
CREATE TABLE team_members (
  team_id        UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  event_id       UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, participant_id)
);

CREATE INDEX team_members_participant_idx ON team_members (participant_id);

-- ── Entries ───────────────────────────────────────────────────────────────────
-- An "entry" is the competing unit for a round — either a participant or a team.
-- This table avoids the need to check both tables in round/scoring queries.
CREATE TABLE entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('individual', 'team')),
  participant_id  UUID REFERENCES participants (id) ON DELETE RESTRICT,
  team_id         UUID REFERENCES teams (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- XOR: exactly one of participant_id or team_id must be set
  CONSTRAINT entry_xor CHECK (
    (entry_type = 'individual' AND participant_id IS NOT NULL AND team_id IS NULL) OR
    (entry_type = 'team'       AND team_id IS NOT NULL AND participant_id IS NULL)
  ),
  UNIQUE (event_id, participant_id),
  UNIQUE (event_id, team_id)
);

CREATE INDEX entries_event_idx       ON entries (event_id);
CREATE INDEX entries_participant_idx ON entries (participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX entries_team_idx        ON entries (team_id)        WHERE team_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE participants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_unique_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries                   ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON participants              AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON participant_unique_values AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON teams                     AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON team_members              AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON entries                   AS RESTRICTIVE TO PUBLIC USING (false);

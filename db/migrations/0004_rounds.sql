-- =============================================================================
-- Migration 0004: Rounds and round engine
-- FR-ROUND-*, BR-02, BR-03, BR-04, ARCHITECTURE.md §10
-- =============================================================================

SET search_path TO app;

-- ── Rounds ────────────────────────────────────────────────────────────────────
CREATE TABLE rounds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  -- Identity
  round_no        INT NOT NULL,          -- display order within event
  name            TEXT NOT NULL,
  round_type      TEXT NOT NULL          -- 'quiz', 'challenge', 'judged'
                    CHECK (round_type IN ('quiz', 'challenge', 'judged')),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','open','paused','closed','finalised','cancelled')),
  -- Temporal (BR-02: absolute DB timestamps)
  opens_at        TIMESTAMPTZ,           -- null = manual open
  closes_at       TIMESTAMPTZ,           -- null = manual close; sweeper uses this
  duration_ms     BIGINT,                -- per-entry time limit (null = unlimited)
  -- Eligibility
  eligibility     TEXT NOT NULL DEFAULT 'all'
                    CHECK (eligibility IN ('all','approved_only','previous_round')),
  min_prev_score  NUMERIC(10,4),         -- for 'previous_round' eligibility
  preceding_round_id UUID REFERENCES rounds (id),
  -- Advancement (BR-05)
  advancement_mode TEXT NOT NULL DEFAULT 'all'
                    CHECK (advancement_mode IN ('all','top_n','min_score','manual')),
  advancement_n    INT,
  advancement_min_score NUMERIC(10,4),
  -- Configuration (round-type specific, stored as JSONB)
  config          JSONB NOT NULL DEFAULT '{}',
  -- Metadata
  created_by      UUID NOT NULL REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, round_no)
);

CREATE INDEX rounds_event_idx    ON rounds (event_id);
CREATE INDEX rounds_status_idx   ON rounds (event_id, status);
CREATE INDEX rounds_closes_at_idx ON rounds (closes_at) WHERE closes_at IS NOT NULL AND status = 'open';

-- Add FK from role_assignments.round_id (defined in 0001, FK added here)
ALTER TABLE role_assignments
  ADD CONSTRAINT role_assignments_round_id_fk
    FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE;

-- ── Round scoring configuration ───────────────────────────────────────────────
CREATE TABLE round_scoring_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID NOT NULL UNIQUE REFERENCES rounds (id) ON DELETE CASCADE,
  event_id          UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  -- Composite score formula across rounds (for multi-round weighting)
  weight            NUMERIC(6,4) NOT NULL DEFAULT 1.0,
  -- Tie-break priority list (e.g. ["completion_time_asc","score_desc"])
  tie_break_order   JSONB NOT NULL DEFAULT '["score_desc"]',
  -- Missing round policy (BR-13): 'zero', 'exclude', 'rank_last'
  missing_round_policy TEXT NOT NULL DEFAULT 'zero'
                          CHECK (missing_round_policy IN ('zero','exclude','rank_last')),
  -- Score visibility (BR-19): 'after_submit', 'after_round_close', 'after_results'
  score_visibility  TEXT NOT NULL DEFAULT 'after_round_close'
                      CHECK (score_visibility IN ('after_submit','after_round_close','after_results','never')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Round pauses (for duration-based deadlines) ───────────────────────────────
-- BR-04: when a round is paused, all in-progress attempt deadlines extend
-- by the pause duration. Each pause interval is recorded here.
CREATE TABLE round_pauses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  paused_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at  TIMESTAMPTZ,        -- null = currently paused
  pause_ms    BIGINT              -- computed on resume: EXTRACT(EPOCH FROM (resumed_at - paused_at)) * 1000
);

CREATE INDEX round_pauses_round_idx ON round_pauses (round_id);

-- ── Entry round status ────────────────────────────────────────────────────────
-- Tracks per-entry eligibility and advancement status for each round.
CREATE TABLE entry_round_status (
  entry_id    UUID NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  round_id    UUID NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  is_eligible BOOLEAN NOT NULL DEFAULT true,
  is_advanced BOOLEAN,     -- null = not yet determined
  PRIMARY KEY (entry_id, round_id)
);

CREATE INDEX entry_round_status_round_idx ON entry_round_status (round_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE rounds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_scoring_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_pauses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_round_status    ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON rounds                AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON round_scoring_configs AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON round_pauses          AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON entry_round_status    AS RESTRICTIVE TO PUBLIC USING (false);

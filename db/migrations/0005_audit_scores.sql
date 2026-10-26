-- =============================================================================
-- Migration 0005: Audit log (append-only, trigger-protected)
-- FR-AUDIT-01, BR-29, R-AUD-01, ARCHITECTURE.md §20
-- =============================================================================

SET search_path TO app;

-- ── Audit log table ───────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Actor
  actor_user_id   UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_role_key  TEXT,
  -- Action
  action          TEXT NOT NULL,
  -- Target
  target_type     TEXT NOT NULL,
  target_id       TEXT,
  -- Scope
  event_id        UUID REFERENCES events (id) ON DELETE SET NULL,
  round_id        UUID REFERENCES rounds (id) ON DELETE SET NULL,
  -- State snapshot (must not contain PII or secrets)
  before          JSONB,
  after           JSONB,
  reason          TEXT,
  -- Request context
  request_id      TEXT,
  ip_hash         TEXT,
  -- Timestamp (immutable after insert)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_idx   ON audit_logs (actor_user_id);
CREATE INDEX audit_logs_event_idx   ON audit_logs (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX audit_logs_action_idx  ON audit_logs (action);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at);
CREATE INDEX audit_logs_target_idx  ON audit_logs (target_type, target_id);

-- ── Append-only trigger (BR-29, R-AUD-01) ────────────────────────────────────
-- No UPDATE or DELETE is allowed on audit_logs — ever.
CREATE OR REPLACE FUNCTION audit_logs_no_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are prohibited (BR-29)';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutation();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON audit_logs AS RESTRICTIVE TO PUBLIC USING (false);

-- ── Score records (append-only) ───────────────────────────────────────────────
-- Defined here alongside audit_logs because both are append-only tables
-- protected by the same pattern.
-- BR-20, BR-21, R-AUD-04
CREATE TABLE score_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  round_id        UUID NOT NULL REFERENCES rounds (id) ON DELETE RESTRICT,
  entry_id        UUID NOT NULL REFERENCES entries (id) ON DELETE RESTRICT,
  -- Score source: 'quiz_auto', 'judge_final', 'admin_adjust', 'penalty'
  source          TEXT NOT NULL
                    CHECK (source IN ('quiz_auto','judge_final','admin_adjust','penalty')),
  raw_score       NUMERIC(10,4) NOT NULL,
  normalised_score NUMERIC(10,4),       -- computed by result run, null until then
  penalty         NUMERIC(10,4) NOT NULL DEFAULT 0,
  final_score     NUMERIC(10,4) NOT NULL, -- raw_score + penalty (can be negative)
  -- Append-only chain: newer record supersedes older
  superseded_by   UUID REFERENCES score_records (id),
  -- Hash of inputs used to compute this record (R-AUD-04)
  inputs_hash     TEXT,
  -- Context
  source_ref_id   UUID,   -- attempt_id, evaluation_id, or job_id
  computed_by_user_id UUID REFERENCES users (id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX score_records_round_entry_idx ON score_records (round_id, entry_id);
CREATE INDEX score_records_event_idx       ON score_records (event_id);
-- Query current (non-superseded) records efficiently
CREATE INDEX score_records_current_idx     ON score_records (round_id, entry_id)
  WHERE superseded_by IS NULL;

-- Append-only trigger for score_records
CREATE TRIGGER score_records_no_update
  BEFORE UPDATE ON score_records
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutation();

CREATE TRIGGER score_records_no_delete
  BEFORE DELETE ON score_records
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutation();

ALTER TABLE score_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON score_records AS RESTRICTIVE TO PUBLIC USING (false);

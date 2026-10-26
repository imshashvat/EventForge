-- =============================================================================
-- Migration 0006: Infrastructure tables (idempotency, jobs, notifications)
-- NFR-REL-04, ARCHITECTURE.md §17
-- =============================================================================

SET search_path TO app;

-- ── Idempotency keys ──────────────────────────────────────────────────────────
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'done')),
  response_status INT,
  response_body   JSONB,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

-- ── Background jobs ───────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL
                CHECK (type IN ('sweeper','email','export-chunk','cleanup','lb-rebuild')),
  status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','dead')),
  payload     JSONB NOT NULL DEFAULT '{}',
  attempts    INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  last_error  TEXT,
  event_id    UUID REFERENCES events (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the SKIP LOCKED claim query
CREATE INDEX jobs_claim_idx ON jobs (run_at ASC)
  WHERE status IN ('queued', 'running');
CREATE INDEX jobs_event_idx ON jobs (event_id) WHERE event_id IS NOT NULL;

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES events (id) ON DELETE SET NULL,
  -- Recipient
  user_id         UUID REFERENCES users (id) ON DELETE CASCADE,
  -- Channel and content
  channel         TEXT NOT NULL DEFAULT 'email'
                    CHECK (channel IN ('email','in_app')),
  subject         TEXT,
  body            TEXT NOT NULL,
  -- Status
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','failed','suppressed')),
  sent_at         TIMESTAMPTZ,
  failed_reason   TEXT,
  -- Deduplication
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx   ON notifications (user_id);
CREATE INDEX notifications_status_idx ON notifications (status) WHERE status = 'queued';

-- ── Export jobs ───────────────────────────────────────────────────────────────
CREATE TABLE export_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  -- Who requested and what
  requested_by  UUID NOT NULL REFERENCES users (id),
  export_type   TEXT NOT NULL
                  CHECK (export_type IN (
                    'participants','teams','scores','leaderboard',
                    'quiz_responses','audit_log'
                  )),
  -- State
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed')),
  -- Progress
  total_rows    BIGINT,
  processed_rows BIGINT NOT NULL DEFAULT 0,
  watermark     UUID,                  -- last processed record ID for resume
  -- Output
  storage_path  TEXT,                  -- Supabase Storage object path
  checksum      TEXT,                  -- SHA-256 of complete output
  row_count     BIGINT,
  -- Error
  error_message TEXT,
  -- Temporal
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,           -- download link expiry
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX export_jobs_event_idx  ON export_jobs (event_id);
CREATE INDEX export_jobs_user_idx   ON export_jobs (requested_by);
CREATE INDEX export_jobs_status_idx ON export_jobs (status) WHERE status IN ('queued','running');

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON idempotency_keys AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON jobs             AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON notifications    AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON export_jobs      AS RESTRICTIVE TO PUBLIC USING (false);

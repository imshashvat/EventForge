-- Migration 0009: Score watermark + score-record integrity + snapshot RLS
-- Audit findings (Phase 2): leaderboard watermark was MAX(uuid::text), which is
-- not monotonic; duplicate quiz_auto rows were guarded only by app locks.
-- Expand-only (R-DB-01): new columns/indexes, nothing dropped.

SET search_path TO app, public;

-- 1. Monotonic sequence on score_records (true watermark).
--    ADD COLUMN ... IDENTITY backfills existing rows without firing UPDATE triggers.
ALTER TABLE app.score_records
  ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS score_records_event_seq_idx
  ON app.score_records (event_id, seq);

-- 2. One auto-graded score per attempt (idempotency enforced by the database).
CREATE UNIQUE INDEX IF NOT EXISTS score_records_quiz_auto_attempt_uq
  ON app.score_records (source_ref_id)
  WHERE source = 'quiz_auto';

-- 3. Snapshot watermark becomes a bigint seq (old uuid column kept: contract later).
ALTER TABLE app.leaderboard_snapshots
  ADD COLUMN IF NOT EXISTS score_seq BIGINT;

-- 4. leaderboard_snapshots had no RLS (R-DB-05) — deny-all like every other table.
ALTER TABLE app.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app' AND tablename = 'leaderboard_snapshots' AND policyname = 'deny_all'
  ) THEN
    CREATE POLICY deny_all ON app.leaderboard_snapshots AS RESTRICTIVE TO PUBLIC USING (false);
  END IF;
END $$;

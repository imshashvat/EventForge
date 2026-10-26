-- Migration 0008: Leaderboard snapshots (ARCHITECTURE.md §15)
-- Versioned, scoped leaderboard snapshots served via ETag-based polling.
-- Single-flight rebuild via pg_try_advisory_xact_lock (§15.2).

SET search_path TO app, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- leaderboard_snapshots
-- PK: (event_id, scope, version)
-- scope: 'overall' | 'round:<round_id>' | custom string
-- payload: JSONB array of ranked entries (top-N only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.leaderboard_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id          UUID NOT NULL REFERENCES app.events(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL,               -- 'overall' or 'round:<uuid>'

  version           INTEGER NOT NULL DEFAULT 1,  -- monotonically increasing
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  provisional       BOOLEAN NOT NULL DEFAULT TRUE, -- false once round/event finalised

  -- Watermark: the MAX(id) of score_records at snapshot time.
  -- Used for stale-detection without a full aggregate scan.
  score_watermark   UUID,

  -- Top-N serialised rows (ARCHITECTURE.md §15.2, ≈8 KB raw / 3 KB gzip)
  -- Schema: [{ rank, entry_id, entry_code, display_name, team_name,
  --            final_score, round_scores, tied }]
  payload           JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Caching / HTTP
  etag              TEXT NOT NULL,               -- "<scope>-<version>"

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One authoritative snapshot per (event, scope) — we query by version DESC LIMIT 1
CREATE INDEX IF NOT EXISTS lb_snapshots_event_scope_idx
  ON app.leaderboard_snapshots (event_id, scope, version DESC);

-- GIN for fast jsonb rank lookup (used by /leaderboard/me endpoint)
CREATE INDEX IF NOT EXISTS lb_snapshots_payload_gin_idx
  ON app.leaderboard_snapshots USING GIN (payload jsonb_path_ops);

-- =============================================================================
-- EventForge — Row Level Security Policies
-- ARCHITECTURE.md §7.5 — Deny-by-default RLS for all app schema tables
--
-- Design:
--   - anon + authenticated Supabase roles: NO access to app schema (no grants)
--   - app_rw role: connects via DATABASE_URL (transaction pooler) — bypasses RLS
--     because it connects as a trusted server role (not via Supabase JWT path)
--   - app_ro role: connects via DATABASE_READONLY_URL — same bypass
--   - RLS is the SECOND line of defense; application-layer authz is the FIRST
--
-- Run this as: superuser (postgres) via scripts/apply-rls.mjs
-- =============================================================================

-- ─── Enable RLS on all app tables ────────────────────────────────────────────

ALTER TABLE app.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_assignments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.events                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.event_counters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.registration_forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.registration_field_defs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.participants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.participant_unique_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.teams                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.team_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entries                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rounds                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.round_scoring_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.round_pauses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entry_round_status       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.score_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_banks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.questions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.round_questions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quiz_attempts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attempt_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quiz_responses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.leaderboard_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_starts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.submissions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.submission_revisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evaluation_rubrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evaluation_criteria      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.judging_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.judge_evaluations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.judge_evaluation_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evaluation_resolutions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.result_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calculated_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jobs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.export_jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permissions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions         ENABLE ROW LEVEL SECURITY;

-- ─── Deny-by-default policies ────────────────────────────────────────────────
-- These policies ensure that even if a Supabase anon/authenticated JWT somehow
-- reaches the database directly, it sees nothing.
--
-- The app connects as `postgres` (superuser) or app_rw/app_ro roles which are
-- NOT the anon/authenticated Supabase JWT roles, so they bypass RLS by default.
-- We explicitly mark app_rw/app_ro as BYPASSRLS for performance:

ALTER ROLE app_rw BYPASSRLS;
ALTER ROLE app_ro BYPASSRLS;

-- ─── Deny anon/authenticated any access to app schema ────────────────────────
-- Belt-and-suspenders: revoke any accidental grants

REVOKE ALL ON SCHEMA app FROM anon;
REVOKE ALL ON SCHEMA app FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated;

-- Future tables too:
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM authenticated;

-- ─── Deny-by-default catch-all policies for anon + authenticated ─────────────
-- Even with BYPASSRLS on app_rw/app_ro, we add explicit DENY policies so the
-- intent is documented and any future misconfiguration is blocked.

-- Helper: create a deny-all policy if it doesn't already exist
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'users','role_assignments','events','event_counters',
    'registration_forms','registration_field_defs','participants',
    'participant_unique_values','teams','team_members','entries',
    'rounds','round_scoring_configs','round_pauses','entry_round_status',
    'score_records','question_banks','questions','question_versions',
    'question_options','round_questions','quiz_attempts','attempt_questions',
    'quiz_responses','leaderboard_snapshots','challenge_tasks','challenge_starts',
    'submissions','submission_revisions','evaluation_rubrics','evaluation_criteria',
    'judging_assignments','judge_evaluations','judge_evaluation_scores',
    'evaluation_resolutions','result_runs','calculated_results',
    'audit_logs','idempotency_keys','jobs','notifications','export_jobs',
    'roles','permissions','role_permissions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Deny SELECT for anon
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'app' AND tablename = t AND policyname = 'deny_anon_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY deny_anon_select ON app.%I AS RESTRICTIVE FOR SELECT TO anon USING (false)',
        t
      );
    END IF;
    -- Deny ALL for authenticated (Supabase JWT users — not our app_rw role)
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'app' AND tablename = t AND policyname = 'deny_authenticated_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY deny_authenticated_all ON app.%I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ─── Verification query ───────────────────────────────────────────────────────
-- After running this script, verify with:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'app';
-- All tables should show rowsecurity = true

SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'app'
ORDER BY tablename;

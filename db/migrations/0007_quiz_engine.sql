-- =============================================================================
-- Migration 0007: Quiz Engine
-- FR-QUIZ-01 through FR-QUIZ-12, ARCHITECTURE.md §11, AD-16
-- =============================================================================

SET search_path TO app;

-- ── Question banks ────────────────────────────────────────────────────────────
CREATE TABLE question_banks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);
CREATE INDEX question_banks_event_idx ON question_banks (event_id);

-- ── Questions ─────────────────────────────────────────────────────────────────
CREATE TABLE questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  bank_id         UUID NOT NULL REFERENCES question_banks (id) ON DELETE RESTRICT,
  question_type   TEXT NOT NULL
                    CHECK (question_type IN ('single_choice','multi_choice','true_false','short_text')),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  difficulty      TEXT NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy','medium','hard')),
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID NOT NULL REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questions_bank_idx  ON questions (bank_id);
CREATE INDEX questions_event_idx ON questions (event_id);
CREATE INDEX questions_tags_idx  ON questions USING gin (tags);

-- ── Question versions (FR-QUIZ-03) ────────────────────────────────────────────
CREATE TABLE question_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  version_no       INTEGER NOT NULL,
  stem             TEXT NOT NULL,
  stem_image_url   TEXT,
  marks            NUMERIC(10,4) NOT NULL DEFAULT 1,
  neg_marks        NUMERIC(10,4) NOT NULL DEFAULT 0,
  accepted_answers TEXT[],
  normalize_case   BOOLEAN NOT NULL DEFAULT true,
  normalize_spaces BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, version_no)
);
CREATE INDEX question_versions_question_idx ON question_versions (question_id);

-- ── Question options (FR-QUIZ-01, FR-QUIZ-09) ─────────────────────────────────
CREATE TABLE question_options (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       UUID NOT NULL REFERENCES question_versions (id) ON DELETE RESTRICT,
  option_text      TEXT NOT NULL,
  option_image_url TEXT,
  is_correct       BOOLEAN NOT NULL,
  display_order    INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX question_options_version_idx ON question_options (version_id);

-- ── Round questions (FR-QUIZ-04) ──────────────────────────────────────────────
CREATE TABLE round_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID NOT NULL REFERENCES rounds (id) ON DELETE RESTRICT,
  event_id          UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  question_id       UUID NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  pinned_version_id UUID REFERENCES question_versions (id),
  pool_tag          TEXT,
  pool_draw_n       INTEGER,
  display_order     INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, question_id)
);
CREATE INDEX round_questions_round_idx ON round_questions (round_id);

-- ── Quiz attempts (FR-QUIZ-05, AD-16) ────────────────────────────────────────
CREATE TABLE quiz_attempts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                  UUID NOT NULL REFERENCES rounds (id) ON DELETE RESTRICT,
  event_id                  UUID NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  entry_id                  UUID NOT NULL REFERENCES entries (id) ON DELETE RESTRICT,
  started_by_participant_id UUID REFERENCES participants (id),
  status                    TEXT NOT NULL DEFAULT 'in_progress'
                              CHECK (status IN ('in_progress','submitted','auto_submitted','timed_out')),
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at               TIMESTAMPTZ NOT NULL,
  submitted_at              TIMESTAMPTZ,
  shuffle_seed              BIGINT NOT NULL DEFAULT (floor(random() * 9223372036854775807))::BIGINT,
  scored_at                 TIMESTAMPTZ,
  score_record_id           UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, entry_id)
);
CREATE INDEX quiz_attempts_round_idx  ON quiz_attempts (round_id);
CREATE INDEX quiz_attempts_entry_idx  ON quiz_attempts (entry_id);
CREATE INDEX quiz_attempts_status_idx ON quiz_attempts (status) WHERE status = 'in_progress';

-- ── Attempt questions (FR-QUIZ-05) ────────────────────────────────────────────
CREATE TABLE attempt_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    UUID NOT NULL REFERENCES quiz_attempts (id) ON DELETE RESTRICT,
  question_id   UUID NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  version_id    UUID NOT NULL REFERENCES question_versions (id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL,
  option_seed   BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX attempt_questions_attempt_idx ON attempt_questions (attempt_id);

-- ── Quiz responses (FR-QUIZ-07, AD-16) ────────────────────────────────────────
CREATE TABLE quiz_responses (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id                 UUID NOT NULL REFERENCES quiz_attempts (id) ON DELETE RESTRICT,
  attempt_question_id        UUID NOT NULL REFERENCES attempt_questions (id) ON DELETE RESTRICT,
  selected_option_ids        UUID[] NOT NULL DEFAULT '{}',
  text_answer                TEXT,
  client_seq                 BIGINT NOT NULL DEFAULT 0,
  answered_by_participant_id UUID REFERENCES participants (id),
  saved_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_correct                 BOOLEAN,
  review_status              TEXT DEFAULT 'auto_graded'
                               CHECK (review_status IN ('auto_graded','pending_review','reviewed')),
  UNIQUE (attempt_question_id)
);
CREATE INDEX quiz_responses_attempt_idx ON quiz_responses (attempt_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE question_banks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_responses    ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON question_banks    AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON questions         AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON question_versions AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON question_options  AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON round_questions   AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON quiz_attempts     AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON attempt_questions AS RESTRICTIVE TO PUBLIC USING (false);
CREATE POLICY deny_all ON quiz_responses    AS RESTRICTIVE TO PUBLIC USING (false);

-- ── Grants ────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON question_banks, questions, round_questions, quiz_attempts TO app_rw;
GRANT SELECT, INSERT         ON question_versions, question_options, attempt_questions    TO app_rw;
GRANT SELECT, INSERT, UPDATE ON quiz_responses                                            TO app_rw;
GRANT SELECT ON question_banks, questions, question_versions, question_options,
               round_questions, quiz_attempts, attempt_questions, quiz_responses          TO app_ro;

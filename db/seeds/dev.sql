-- =============================================================================
-- Dev seed data (R-TEST-03, M0-B10)
-- Run ONLY in local / staging environments — never in production.
-- =============================================================================

SET search_path TO app;

DO $$
BEGIN
  IF current_setting('app.env', true) = 'production' THEN
    RAISE EXCEPTION 'Seed aborted: app.env is set to production';
  END IF;
  -- Extra guard: SEED_ALLOWED must be explicitly set
  IF coalesce(current_setting('app.seed_allowed', true), '') != 'true' THEN
    RAISE EXCEPTION 'Seed aborted: set app.seed_allowed=true to allow seeding';
  END IF;
END $$;

-- ── Seed users (auth_uid = random UUID; in real local dev, match Supabase auth.users) ──
INSERT INTO users (id, auth_uid, display_name, email_hash) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Super Admin',      'hash_superadmin'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Event Organiser',  'hash_organiser'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Arjun Sharma',     'hash_arjun'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'Priya Nair',       'hash_priya'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'Rahul Gupta',      'hash_rahul'),
  ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'Judge One',        'hash_judge1'),
  ('00000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'Judge Two',        'hash_judge2')
ON CONFLICT DO NOTHING;

-- ── Assign super_admin role globally to user 001 ─────────────────────────────
INSERT INTO role_assignments (user_id, role_key, scope_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'global')
ON CONFLICT DO NOTHING;

-- ── Seed a dev event ──────────────────────────────────────────────────────────
INSERT INTO events (id, slug, name, tagline, status, starts_at, ends_at,
                    registration_mode, max_participants, created_by) VALUES
  ('10000000-0000-0000-0000-000000000001',
   'dev-hackathon-2026',
   'Dev Hackathon 2026',
   'A sample event for local development',
   'published',
   now() + INTERVAL '1 day',
   now() + INTERVAL '3 days',
   'open',
   50,
   '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ── event_counters init ───────────────────────────────────────────────────────
INSERT INTO event_counters (event_id, counter_key, value) VALUES
  ('10000000-0000-0000-0000-000000000001', 'participant_no', 0),
  ('10000000-0000-0000-0000-000000000001', 'team_no', 0)
ON CONFLICT DO NOTHING;

-- ── Assign event_admin for the dev event ──────────────────────────────────────
INSERT INTO role_assignments (user_id, role_key, scope_type, event_id) VALUES
  ('00000000-0000-0000-0000-000000000002', 'event_admin', 'event',
   '10000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ── Registration form ─────────────────────────────────────────────────────────
INSERT INTO registration_forms (id, event_id, version, is_current) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, true)
ON CONFLICT DO NOTHING;

INSERT INTO registration_field_defs
  (id, form_id, event_id, field_key, label, field_type, is_required, display_order)
VALUES
  ('30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'college', 'College / Institution', 'text', true, 1),
  ('30000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'year',    'Year of Study',         'select', true, 2)
ON CONFLICT DO NOTHING;

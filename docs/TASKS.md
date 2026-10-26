# EventForge  -  Task Tracker (TASKS.md)

**Document status:** Draft v0.1
**Last updated:** 2026-09-25
**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) * [PRD.md](./PRD.md) * [RULES.md](./RULES.md) * [DESIGN.md](./DESIGN.md) * [MEMORY.md](./MEMORY.md)

Status legend: `[œ todo` * `ðŸ"µ in-progress` * `âœ… done` * `ðŸ"´ blocked` * `â© deferred`

---

## Milestones

| # | Milestone | Target | Status |
|---|---|---|---|
| M0 | Foundation (repo, tooling, DB, auth, core modules, CI) | TBD | 🔵 |
| M1 | Event + Registration + Quiz round (functional, tested) | TBD | 🔵 |
| M2 | Challenge + Judging + Scoring + Results | TBD | [œ |
| M3 | Leaderboard + Admin dashboard + Exports | TBD | [œ |
| M4 | Performance, security hardening, load tests, restore drill | TBD | [œ |
| M5 | First live event (event tier infrastructure) | TBD | [œ |

---

## T-0  -  Pre-Implementation

| ID | Task | Status | Owner | Notes |
|---|---|---|---|---|
| T-0.1 | Repository inspection: structure, deps, lint/test setup, existing docs | [œ | Dev | Required by R-REPO-01 before any code changes |
| T-0.2 | Resolve open decisions: D-P04, D-P10, R-01, R-09 (see PRD sec.7) | [œ | Owner | Required before M1 |
| T-0.3 | Approve Milestone 0 scope and tech stack (AD-01 to AD-15) | [œ | Owner | |
| T-0.4 | Set up Supabase projects (dev, staging) and record project URLs | [œ | Dev | |
| T-0.5 | Verify all [U]-tagged infrastructure facts from ARCHITECTURE.md sec.4.2 | [œ | Dev | GitHub Actions limits, Sentry tiers, pg_cron interval, Mumbai region, Turnstile |
| T-0.6 | Set up Vercel project and connect GitHub repo | [œ | Dev | |
| T-0.7 | Set up Upstash Redis (free tier) | [œ | Dev | |
| T-0.8 | Set up SMTP provider (Brevo or Resend, free tier) | [œ | Dev | |
| T-0.9 | Set up Sentry project (free tier) | [œ | Dev | |

---

## M0  -  Foundation

### M0-A: Repository and Tooling

| ID | Task | Status | Notes |
|---|---|---|---|
| M0-A1 | Init Next.js 15 + TypeScript project | ✅ | App Router, `src/` dir, strict TS |
| M0-A2 | Configure ESLint (no-console, no-any, import boundaries, no-restricted-syntax for template SQL) | ✅ | |
| M0-A3 | Configure dependency-cruiser rules for module boundaries (ARCHITECTURE.md sec.6.2) | [œ | |
| M0-A4 | Configure Prettier | ✅ | |
| M0-A5 | Set up Vitest | ✅ | 122 tests passing |
| M0-A6 | Set up Playwright | [œ | |
| M0-A7 | Set up GitHub Actions: CI workflow (lint, typecheck, unit, integration, build) | [œ | |
| M0-A8 | Set up secret scanning in CI | [œ | |
| M0-A9 | Set up Lighthouse CI | [œ | |
| M0-A10 | Set up bundle-size tracking | [œ | |
| M0-A11 | Configure `.env.example` from ARCHITECTURE.md sec.21.4 | ✅ | Done |
| M0-A12 | Create docs/ and populate the six companion documents | ✅ | Done 2026-09-25 |

### M0-B: Database

| ID | Task | Status | Notes |
|---|---|---|---|
| M0-B1 | Design migration tooling (Drizzle migrate or raw SQL runner) | ✅ | Drizzle ORM + raw SQL migrations |
| M0-B2 | Create DB schemas and roles: `app_schema`, `app_rw`, `app_ro`, migration owner | ✅ | app schema via Drizzle |
| M0-B3 | Migration 0001: `users`, `roles`, `permissions`, `role_permissions`, `role_assignments` | ✅ | |
| M0-B4 | Migration 0002: `events`, `event_counters`, `registration_forms`, `registration_field_defs` | ✅ | |
| M0-B5 | Migration 0003: `participants`, `participant_unique_values`, `teams`, `team_members`, `entries` | ✅ | |
| M0-B6 | Migration 0004: `rounds`, `round_scoring_configs`, `round_pauses`, `entry_round_status` | ✅ | |
| M0-B7 | Migration 0005: `audit_logs` with UPDATE/DELETE trigger | ✅ | |
| M0-B8 | Migration 0006: `idempotency_keys`, `jobs`, `notifications` | ✅ | |
| M0-B9 | Write RLS policies (deny-by-default) and grants for all tables | [œ | Supabase RLS not yet applied |
| M0-B10 | Write DB seeds (dev: 10 events, 50 users, 25 teams) | [œ | |
| M0-B11 | Validate Supabase role/schema config (T-1.3 scope) | [œ | |
| M0-B12 | Set up GitHub Actions backup workflow (pg_dump + age encrypt + upload) | [œ | |

### M0-C: Core Modules

| ID | Task | Status | Notes |
|---|---|---|---|
| M0-C1 | `core/db`: connection pool, transaction helper, query logger | ✅ | |
| M0-C2 | `core/config`: env-var Zod schema with all vars from sec.21.3 | ✅ | |
| M0-C3 | `core/logger`: structured JSON logger | ✅ | |
| M0-C4 | `core/errors`: error class hierarchy, error-to-HTTP-status map | ✅ | |
| M0-C5 | `core/clock`: `dbNow()`  -  fetches `now()` from Postgres; used by all deadline math | ✅ | |
| M0-C6 | `core/auth`: AuthProvider interface + Supabase adapter | ✅ | |
| M0-C7 | `core/authz`: `authorize(actor, permission, scope)` + role-assignment lookup | ✅ | |
| M0-C8 | `core/rate-limit`: Upstash adapter + rate-limit classes from sec.17.1 | [œ | Dead code / not wired |
| M0-C9 | `core/idempotency`: store/retrieve by key, TTL cleanup | [œ | Broken implementation |
| M0-C10 | `core/jobs`: claim job (SKIP LOCKED), update status, heartbeat, dead-letter | ✅ | |
| M0-C11 | `core/audit`: `writeAudit()`  -  must run in caller's transaction | ✅ | |
| M0-C12 | `core/csv`: RFC 4180 serializer + formula-injection sanitizer + corpus tests | ✅ | 42 tests passing |
| M0-C13 | Route registry: declare all routes with permission + scope + rate-limit class; CI test that every route is registered | [œ | |
| M0-C14 | `POST /api/v1/internal/jobs/tick` with CRON_SECRET auth | ✅ | |
| M0-C15 | `GET /api/health`  -  shallow (DB ping) and deep (auth + storage + redis check) | [œ | |

### M0-D: Auth Routes and UI

| ID | Task | Status | Notes |
|---|---|---|---|
| M0-D1 | Sign-up page and route handler | ✅ | |
| M0-D2 | Sign-in page and route handler + brute-force rate limit | ✅ | |
| M0-D3 | Email verification flow | [œ | Supabase handles; no custom page |
| M0-D4 | Password reset flow | [œ | |
| M0-D5 | Session middleware (cookie refresh, user hydration) | ✅ | resolveAppUser bridge |
| M0-D6 | `GET /me` API route | [œ | |

---

## M1  -  Events, Registration, Quiz

### M1-A: Events Module

| ID | Task | Status | Notes |
|---|---|---|---|
| M1-A1 | `events` service: create, update, lifecycle transitions | ✅ | |
| M1-A2 | `events` repo: CRUD with event_id isolation | ✅ | |
| M1-A3 | Event lifecycle API routes (publish, pause, resume, complete, archive) | ✅ | PATCH /api/v1/events/[id] |
| M1-A4 | Role assignment API routes | ✅ | POST/DELETE /api/v1/events/[id]/roles |
| M1-A5 | Public event listing page + event detail page | ✅ | /events + /events/[slug] |
| M1-A6 | Admin event creation / edit form | ✅ | /admin/events + /admin/events/new |

### M1-B: Registration Module

| ID | Task | Status | Notes |
|---|---|---|---|
| M1-B1 | Registration service: capacity check, unique-field check, approval flow | ✅ | |
| M1-B2 | `POST /events/{id}/registrations` (idempotent, capacity-safe) | ✅ | |
| M1-B3 | `GET /events/{id}/registrations` (paginated, scoped) | ✅ | Done 2026-10-03 |
| M1-B4 | `POST /events/{id}/registrations/{pid}/review` (approve/reject/waitlist) | ✅ | Done 2026-10-03 |
| M1-B5 | Registration form builder (admin) | [œ | |
| M1-B6 | Participant registration page (dynamic form render) | ✅ | /events/[slug] — register button |
| M1-B7 | Registration confirmation email | [œ | |

### M1-C: Teams Module

| ID | Task | Status | Notes |
|---|---|---|---|
| M1-C1 | Team create/join/leave/update service | [œ | |
| M1-C2 | Teams API routes | [œ | |
| M1-C3 | Team management UI (participant) | [œ | |

### M1-D: Round Engine

| ID | Task | Status | Notes |
|---|---|---|---|
| M1-D1 | `RoundType` interface contract (src/round-types/contract.ts) | ✅ | |
| M1-D2 | Round engine: create, edit, lifecycle (open/close/pause/resume), eligibility, advancement | ✅ | |
| M1-D3 | Round API routes | ✅ | GET/POST /rounds + PATCH/control |
| M1-D4 | Sweeper job: auto-submit in-progress attempts past deadline | ✅ | quiz/jobs/sweeper.ts |

### M1-E: Quiz Round Type

| ID | Task | Status | Notes |
|---|---|---|---|
| M1-E1 | Migrations: question_banks, questions, etc. | ✅ | | |
| M1-E2 | Question authoring service + versioning | ✅ | |
| M1-E3 | Quiz composition: fixed list + pool sampler with PRNG seed | ✅ | |
| M1-E4 | `POST /rounds/{id}/attempts` - attempt start (advisory lock, idempotent resume) | ✅ | |
| M1-E5 | `GET /attempts/{id}` - resume state | ✅ | |
| M1-E6 | `PUT /attempts/{id}/answers` - batched save with clientSeq upsert | ✅ | |
| M1-E7 | `POST /attempts/{id}/submit` - score + write score_record + idempotent | ✅ | |
| M1-E8 | `scoreAttempt()` pure function + all scoring modes (sec.11.4) | ✅ | 17 unit tests passing |
| M1-E9 | Auto-submit flow (sweeper + lazy + round close) | ✅ | |
| M1-E10 | Quiz question authoring UI | [œ | |
| M1-E11 | Participant quiz UI: timer, question palette, answer states, save indicator | ✅ | quiz-client.tsx |
| M1-E12 | Client answer queue (IndexedDB persistence, retry, flush-on-reconnect) | [œ | |
| M1-F1 | `scoreAttempt()` unit tests (all types, edge cases, negative marking) | ✅ | 17 tests |
| M1-F2 | Attempt start: race/advisory-lock integration test | [œ | |
| M1-F3 | Answer save: clientSeq idempotency integration test | [œ | |
| M1-F4 | Submit: FOR UPDATE + double-submit integration test | [œ | |
| M1-F5 | Auto-submit: sweeper + lazy finalization integration test | [œ | |
| M1-F6 | SEC-ISO-* tests for quiz and registration endpoints | [œ | |
| M1-F7 | Playwright e2e: register <-’ take quiz <-’ submit | [œ | |

---

## M2  -  Challenge, Judging, Scoring

### M2-A: Challenge Round Type

| ID | Task | Status | Notes |
|---|---|---|---|
| M2-A1 | Migrations: challenge_tasks, challenge_starts, submissions, submission_revisions | [œ | |
| M2-A2 | Challenge service: start, draft, submit, revision management | [œ | |
| M2-A3 | URL validator (sec.12.2) with full SSRF block list | [œ | |
| M2-A4 | Challenge API routes | [œ | |
| M2-A5 | Participant challenge UI | [œ | |
| M2-A6 | URL validator unit tests (corpus: SSRF, malicious schemes, legitimate URLs) | [œ | |

### M2-B: Judging

| ID | Task | Status | Notes |
|---|---|---|---|
| M2-B1 | Migrations: evaluation_rubrics, evaluation_criteria, judging_assignments, judge_evaluations, judge_evaluation_scores, evaluation_resolutions | [œ | |
| M2-B2 | Rubric management service | [œ | |
| M2-B3 | Assignment service (manual, bulk, balanced) with COI checks | [œ | |
| M2-B4 | Evaluation service: draft/submit/lock/unlock/reconcile | [œ | |
| M2-B5 | Judging API routes | [œ | |
| M2-B6 | Judge evaluation form UI (blind mode, rubric scoring, comment) | [œ | |
| M2-B7 | Reconciliation UI (disagreement view, resolution form) | [œ | |
| M2-B8 | Judging audit log integration tests | [œ | |

### M2-C: Scoring and Results

| ID | Task | Status | Notes |
|---|---|---|---|
| M2-C1 | Migrations: score_records (append-only trigger), result_runs, calculated_results | [œ | |
| M2-C2 | `computeResults()` pure function (weighted, sum, tie-break, special statuses) | [œ | |
| M2-C3 | Result run service: dry-run, provisional publish, final publish, supersede | [œ | |
| M2-C4 | Score correction flow: unlock, admin adjust, penalty, rescore | [œ | |
| M2-C5 | Results API routes | [œ | |
| M2-C6 | Results view (participant and public) | [œ | |
| M2-C7 | `computeResults()` golden-file tests (R-TEST-04) | [œ | |
| M2-C8 | `score_records` append-only trigger integration test (R-TEST-05) | [œ | |
| M2-C9 | inputs_hash verification test (R-AUD-04) | [œ | |

---

## M3  -  Leaderboard, Admin, Exports

### M3-A: Leaderboard

| ID | Task | Status | Notes |
|---|---|---|---|
| M3-A1 | Migrations: leaderboard_aggregates, leaderboard_snapshots | [œ | |
| M3-A2 | Snapshot builder service (single-flight advisory lock, watermark check) | [œ | |
| M3-A3 | `GET /events/{id}/leaderboard` with ETag/304 | [œ | |
| M3-A4 | `GET /events/{id}/leaderboard/me` (own rank) | [œ | |
| M3-A5 | Visibility policy enforcement (all 5 modes + freeze + top-N) | [œ | |
| M3-A6 | Participant leaderboard UI with polling, ETag, own-rank sticky row | [œ | |
| M3-A7 | Optional Supabase Realtime Broadcast version-ping (staff only, feature flag) | [œ | |
| M3-A8 | Leaderboard staleness + freshness integration test | [œ | |

### M3-B: Admin Dashboard and Console

| ID | Task | Status | Notes |
|---|---|---|---|
| M3-B1 | Admin dashboard (overview, live counts, DB metrics) | [œ | |
| M3-B2 | Live round monitor (attempt counts, save rate, pending auto-submits) | [œ | |
| M3-B3 | Registration management table (search, filter, bulk approve) | [œ | |
| M3-B4 | Admin audit log viewer | [œ | |
| M3-B5 | Staff role management UI | [œ | |

### M3-C: CSV Exports

| ID | Task | Status | Notes |
|---|---|---|---|
| M3-C1 | Migrations: export_jobs | [œ | |
| M3-C2 | Export job runner: claim, chunk, serialize, part upload, checksum, manifest | [œ | |
| M3-C3 | All 6 export types (sec.16.1) | [œ | |
| M3-C4 | Export API routes (create, status, download) | [œ | |
| M3-C5 | Admin export UI | [œ | |
| M3-C6 | Fast-path (< 5,000 rows direct streaming) | [œ | |
| M3-C7 | CSV sanitizer corpus test (R-TEST-04 equivalent for CSV) | [œ | |
| M3-C8 | Export resume (kill mid-job, restart, confirm correct output) | [œ | |

---

## M4  -  Performance, Security, Hardening

| ID | Task | Status | Notes |
|---|---|---|---|
| M4-1 | Load test LT-0 to LT-4 on staging (event tier infrastructure) | [œ | |
| M4-2 | Load test LT-5 to LT-9 (leaderboard, soak, headroom) | [œ | |
| M4-3 | Load test LT-10 and LT-11 (DB pressure, registration surge) | [œ | |
| M4-4 | Reconciliation after each load test | [œ | R-TEST-02 |
| M4-5 | Security: IDOR attempt suite on all endpoints | [œ | |
| M4-6 | Security: CSRF checks, CSP nonces, header audit | [œ | |
| M4-7 | Accessibility: axe on all key flows, keyboard-only test | [œ | |
| M4-8 | Recovery test: REC-01 (DB disconnect), REC-02 (network drop), REC-03 (duplicate), REC-04 (refresh) | [œ | R-TEST-06 |
| M4-9 | Recovery test: REC-08 (export kill/resume) | [œ | |
| M4-10 | Restore drill (R-TEST-07) | [œ | |
| M4-11 | Set up log shipping to durable sink (R-OPS-07) | [œ | |
| M4-12 | Set up uptime monitoring on /api/health | [œ | |
| M4-13 | Performance budget enforcement: Lighthouse CI gate | [œ | |
| M4-14 | Bundle size gate per route | [œ | |
| M4-15 | Dependency audit pass | [œ | |

---

## M5  -  First Live Event

| ID | Task | Status | Notes |
|---|---|---|---|
| M5-1 | Provision event-tier infrastructure (Vercel Hobby confirmed as non-commercial âœ…, Supabase Pro Small) | [œ | D-P02 resolved |
| M5-2 | Configure custom SMTP + raise Auth email rate limit | [œ | |
| M5-3 | Configure Upstash spend cap and Redis pay-as-you-go | [œ | |
| M5-4 | Load-test report attached and all criteria passed | [œ | R-TEST-01 |
| M5-5 | Restore drill completed and documented | [œ | R-TEST-07 |
| M5-6 | Event freeze procedure communicated to team (R-OPS-01) | [œ | |
| M5-7 | Event archive export generated at completion | [œ | NFR-OPS-02 |
| M5-8 | Post-event retrospective: what broke, what worked, what to tune | [œ | |

---

## Open Items (from ARCHITECTURE.md sec.27)

| ID | Item | Status | Tracked in |
|---|---|---|---|
| OI-1 | Verify all [U] infrastructure facts | [œ | T-0.5 |
| OI-2 | Resolve D-P02 Vercel non-commercial | âœ… **Resolved 2026-09-25  -  non-commercial** | ARCHITECTURE.md sec.25 |
| OI-3 | Confirm D-P10: MFA mandatory or optional for admins | [œ | T-0.2 |
| OI-4 | Team-quiz semantics (R-09): one shared attempt or one per member | [œ | T-0.2 |
| OI-5 | Missing-round policy default (R-01) | [œ | T-0.2 |
| OI-6 | Submit grace period (D-P04) | [œ | T-0.2 |
| OI-7 | Privacy retention policy (D-P09) | [œ | Post-MVP |
| OI-8 | Supabase Auth email rate limit confirmation [S] | [œ | T-0.5 |
| OI-9 | Supabase Mumbai region availability [U] | [œ | T-0.5 |
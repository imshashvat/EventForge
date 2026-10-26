# EventForge — Comprehensive Project Brief
> Last compiled: 2026-10-02 from docs/, migrations, and full chat history

---

## 1. What We Are Building

**EventForge** is a self-hosted, non-commercial competition management platform for colleges, communities, and clubs. It runs structured competitive events: **quizzes**, **coding challenges**, and **judged presentations** with live leaderboards and CSV exports.

### Key Traits
| Attribute | Value |
|---|---|
| **Users** | 500+ simultaneous participants |
| **Stack** | Next.js 15 (App Router) + TypeScript strict + Supabase Postgres + Drizzle ORM + Tailwind CSS + Radix UI |
| **Deployment** | Vercel Hobby (non-commercial) + Supabase (Free to Pro for live events) |
| **Auth** | Supabase Auth (email+password), HTTP-only cookies |
| **Commercial** | None. No fees, no revenue. Preserves Vercel Hobby eligibility. |

### Core Capabilities (MVP)
- Multi-event lifecycle management (draft → published → active → paused → completed → archived)
- Registration with configurable form fields, approval workflows, team formation
- Quiz round — timed, server-authoritative, auto-scored, resumable
- Challenge round — URL submission (repo, deploy, video, docs)
- Judged round — rubric scoring, blind mode, disagreement reconciliation
- Live leaderboard (snapshot-based polling, ≤15 s freshness)
- CSV exports (registrations, responses, evaluations, results)
- RBAC with per-event and per-round scoping
- Full audit log with DB-level append-only enforcement

---

## 2. Milestone Plan

| Milestone | Scope | Status |
|---|---|---|
| **M0** Foundation | Repo, DB schema (0001-0006), core modules, auth routes/UI | IN PROGRESS — schema done, core modules scaffolded, UI polished |
| **M1** Events + Registration + Quiz | Events module, registration flow, quiz engine | IN PROGRESS — scaffolded, types aligned to real DB |
| **M2** Challenge + Judging + Scoring + Results | Challenge submissions, judge evaluation, score computation | TODO |
| **M3** Leaderboard + Admin + Exports | Snapshot leaderboard, admin dashboard, CSV exports | TODO |
| **M4** Perf + Security + Hardening | Load tests, security audit, recovery tests | TODO |
| **M5** First Live Event | Event-tier infra, restore drill, go-live | TODO |

---

## 3. Database Schema (Source of Truth: db/migrations/)

CRITICAL: The hand-written SQL migrations are the source of truth. Drizzle is used for querying only. NEVER use drizzle-kit generate to modify the schema.

### Migration files
| File | Tables |
|---|---|
| 0000_roles_and_schema.sql | Postgres app schema, roles: app_rw, app_ro |
| 0001_users_roles.sql | users (auth_uid, email_hash, display_name, status), roles, role_assignments |
| 0002_events.sql | events (name not title), event_counters, registration_forms, registration_field_defs |
| 0003_participants_teams.sql | participants, participant_unique_values, teams, team_members, entries |
| 0004_rounds.sql | rounds (name not title, round_type, round_no), round_scoring_configs, round_pauses, entry_round_status |
| 0005_audit_scores.sql | audit_logs (append-only, DB trigger), score_records, leaderboard_snapshots |
| 0006_infra.sql | idempotency_keys, jobs, notifications, export_jobs — all in app schema |

### Key column name corrections (vs. what AI might assume)
| Wrong (intuition) | Correct (real DB) |
|---|---|
| events.title | events.name |
| rounds.title | rounds.name |
| rounds.position | rounds.round_no |
| rounds.type | rounds.round_type |
| users.auth_user_id | users.auth_uid |
| users.email | users.email_hash (SHA-256) |
| events.capacity | events.max_participants |
| events.deletedAt | Does NOT exist — use status: archived |
| Round status: scheduled/judging/finalized | WRONG — use: draft/published/open/paused/closed/finalised/cancelled |

### Critical DB Rules
- All tables are in the app Postgres schema, not public
- SELECT FOR UPDATE on events before capacity checks (registration concurrency)
- score_records and audit_logs have DB triggers blocking UPDATE/DELETE
- Composite FKs: every child must have (event_id, parent_id) referencing parent's (event_id, id)
- DB clock (now()) is the ONLY authoritative clock — never Date.now()

---

## 4. Architecture — Module Structure

```
src/
├── core/           # Shared infrastructure — never imports from domain modules
│   ├── db/         # Connection pool, schema.ts (Drizzle), withTx()
│   ├── auth/       # getSessionUser(), buildActor(), Supabase adapter
│   ├── authz/      # authorize(actor, permission, scope) — ONLY auth decision point
│   ├── audit/      # writeAudit() — must run in same tx as the state change
│   ├── clock/      # dbNow(tx) — DB-clock only (BR-02)
│   ├── config/     # Zod env-var schema
│   ├── errors/     # Error class hierarchy, toHttpError()
│   ├── jobs/       # DB-backed job queue (SKIP LOCKED)
│   ├── logger/     # Structured JSON logger
│   └── csv/        # RFC 4180 serializer + formula-injection sanitizer
├── modules/
│   ├── events/     # types.ts, repo.ts, service.ts, index.ts
│   └── registration/ # index.ts (service only)
├── components/ui/  # Badge, Button, Card, Nav, Input — pure presentation
├── app/
│   ├── (public)/   # Landing page, events listing, leaderboard
│   ├── (auth)/     # sign-in, sign-up
│   ├── (participant)/ # dashboard, quiz round, event detail
│   ├── (admin)/    # admin event management
│   └── api/v1/     # REST API routes
└── round-types/    # Plugin system for quiz/challenge/judged
```

### Module Import Rules
- core never imports from domain modules
- UI components never import from repo functions
- Data flows via Server Components or API routes only

---

## 5. Key Business Rules

| ID | Rule |
|---|---|
| BR-02 | PostgreSQL now() is the ONLY clock for deadlines |
| BR-03 | Client timer is purely presentational; server deadline_at is authoritative |
| BR-04 | deadline_at = LEAST(started_at + duration, round.ends_at) — computed once at attempt start |
| BR-05 | Scores are server-computed. Client-submitted scores are NEVER used |
| BR-07 | Correct answers NEVER sent to client until results officially released |
| BR-09 | score_records never updated/deleted — corrections create new rows with superseded_by |
| BR-14 | Round pause + deadline extension happens in ONE transaction |
| BR-24 | On close round — all in-progress attempts auto-submitted first |
| BR-25 | Tied entries: same rank; next rank skips (1, 2, 2, 4) |
| BR-27 | PII fields NEVER appear in leaderboards, audit log, or non-export API responses |
| BR-29 | audit_logs rows never updated or deleted — DB trigger enforces |
| BR-30 | Round structure is DATA — never hardcoded in application logic |

---

## 6. Security Rules (Critical)

| Rule | Description |
|---|---|
| R-SEC-01 | ALL authorization through authorize(actor, permission, scope) only |
| R-SEC-02 | Every /api/v1 route must be registered in the route registry |
| R-CODE-01 | TypeScript: strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true |
| R-CODE-02 | Zod at EVERY trust boundary (request body, query params, env vars, jsonb) |
| R-CODE-03 | No any — use unknown |
| R-CODE-04 | No floating-point for scores — use Decimal or integer-scaled arithmetic |
| R-DB-04 | No direct DB from browser — all access through Next.js API layer |
| R-DB-09 | Composite FKs: (event_id, parent_id) everywhere |

---

## 7. Design System

Philosophy: Modern SaaS (Linear/Vercel style) — dark-first, restrained, premium.

| Token | Value |
|---|---|
| Primary | Teal (--teal-500 = #14b8a6) |
| Logo/Brand | Violet (--violet-500) |
| Live/Alert | Amber (--amber-500) |
| Background | Near-black (--bg = #0a0a0f) |
| Surface tiers | --surface-1, --surface-2, --surface-3 |
| Text | --text-primary, --text-secondary, --text-disabled |
| Fonts | --font-display (Outfit), --font-body (Inter), --font-mono (JetBrains Mono) |

Key design principles:
- Glassmorphism headers (backdrop-blur)
- .badge-live = amber pulse animation
- tabular-nums on all numbers
- Smooth hover transitions (150ms)
- WCAG 2.2 Level AA required on all participant flows

---

## 8. What Has Been Done (Session History)

### Stage 1 and 2 — Design System (Complete)
- CSS design tokens (globals.css) — full token set
- Core UI components: Badge, Button, Card, Nav, Input
- Landing page (/) with hero, features, stats sections
- Sign-in / Sign-up pages with Supabase auth integration
- Events listing page (/events) with card grid
- Leaderboard page (/events/[slug]/leaderboard) with live badge
- Admin event management page (/admin/events/[eventId])
- Participant dashboard (/dashboard)
- Quiz round page (/e/[slug]/rounds/[roundId])

### M1 Schema Alignment (Done in this session)
- src/core/db/schema.ts — fixed to real DB column names (auth_uid, email_hash, name not title, round_no, round_type)
- src/core/audit/index.ts — fixed to use pgSchema("app") not pgTable
- src/core/jobs/index.ts — fixed to use pgSchema("app"), fixed .rows → Array.from()
- src/core/clock/index.ts — fixed result.rows[0] → result[0]
- src/core/config/index.ts — fixed Zod boolean .default() → .catch()
- src/modules/events/types.ts — RoundStatus now uses real DB values (finalised not finalized)
- src/modules/events/service.ts — ownerId → createdBy, capacity → maxParticipants
- src/modules/events/repo.ts — removed users.email from join (column does not exist)
- src/modules/registration/index.ts — fieldValues → formAnswers
- All UI pages — event.title → event.name, round.title → round.name, round.type → round.roundType
- API routes — authorize() now takes Actor object (built via buildActor())
- playwright.config.ts and vitest.integration.config.ts — config type fixes

### TypeScript Status: CLEAN (0 errors as of 2026-10-02)

---

## 9. What's Next — Immediate Priorities

### 9.1 M0 Remaining (complete the foundation)
- buildActor() in core/auth — currently a stub, needs real DB role-assignment lookup
- toHttpError() in core/errors — verify implementation
- Route registry completeness (R-SEC-02)
- GET /api/health endpoint

### 9.2 M1 — Quiz Engine (main remaining work)
- DB migrations for question_banks, questions, quiz_attempts, quiz_responses
- Attempt start API (POST /rounds/{id}/attempts)
- Answer save API (PUT /attempts/{id}/answers) — clientSeq upsert
- Submit API (POST /attempts/{id}/submit) — score + score_record
- scoreAttempt() pure function (must be unit tested with golden-file tests)
- Wire quiz UI to real data (scaffolding exists, needs real APIs)
- Sweeper job (auto-submit attempts past deadline)

### 9.3 M1 — Registration and Teams
- Registration form builder (M1-B5)
- Teams module — create/join/leave via invite code

### 9.4 M2 — After M1
- Challenge round (URL submission with SSRF protection)
- Judging (rubric scoring, blind mode)
- computeResults() — deterministic result calculation
- Score records append-only enforcement test

### 9.5 M3 — After M2
- Leaderboard snapshot builder with advisory lock
- Admin dashboard (live counts, round monitor)
- CSV exports (all 6 types with chunked jobs)

---

## 10. Confirmed Architecture Decisions

| ID | Decision |
|---|---|
| AD-01 | Modular monolith — Next.js App Router + TypeScript |
| AD-02 | Supabase Postgres as system of record |
| AD-05 | Snapshot polling baseline for leaderboard (no WebSocket for participants) |
| D-P02 | Vercel Hobby — non-commercial events confirmed |

---

## 11. Open Decisions (Still Unresolved)

| ID | Decision | Impact |
|---|---|---|
| D-P10 | MFA for admins: mandatory or optional TOTP? | Auth UX |
| D-P04 | Quiz submit grace period: 0ms or 500ms? | Scoring fairness |
| R-09 | Team quiz: one shared attempt or one per member? | MAJOR — must decide before M1-E1 |
| R-01 | Missing-round policy: zero, exclude, or rank_last? | Scoring |
| D-P09 | Privacy/data-retention policy | Legal |

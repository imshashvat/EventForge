# EventForge  -  Development Rules (RULES.md)

**Document status:** Draft v0.1
**Last updated:** 2026-09-25
**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) * [PRD.md](./PRD.md) * [DESIGN.md](./DESIGN.md) * [TASKS.md](./TASKS.md) * [MEMORY.md](./MEMORY.md)

These rules are **mandatory**. They exist because the consequences of violations (data corruption, security breaches, live-event failures) are severe and often irreversible. Every contributor must read this document before writing code.

---

## Table of Contents

1. [Repository Rules](#1-repository-rules)
2. [Module and Architecture Rules](#2-module-and-architecture-rules)
3. [Coding Standards](#3-coding-standards)
4. [Database and Migration Rules](#4-database-and-migration-rules)
5. [Security Rules](#5-security-rules)
6. [API Rules](#6-api-rules)
7. [Testing Rules](#7-testing-rules)
8. [Timing and Scoring Rules](#8-timing-and-scoring-rules)
9. [Audit and Data Integrity Rules](#9-audit-and-data-integrity-rules)
10. [Deployment and Operations Rules](#10-deployment-and-operations-rules)
11. [Documentation Rules](#11-documentation-rules)

---

## 1. Repository Rules

### R-REPO-01  -  Inspect before modifying
Before modifying any existing repository, inspect its structure, dependencies, lint/test setup, and any existing documentation. Record findings in the Decision Register (ARCHITECTURE.md sec.25) before writing code.

### R-REPO-02  -  No force pushes to main
`git push --force` to `main` or `production` branches is prohibited. Use `git revert` for corrections.

### R-REPO-03  -  Lockfile must be committed
`package-lock.json` (or `pnpm-lock.yaml`) must be committed and must never be `.gitignore`d. CI must fail if the lockfile is out of sync.

### R-REPO-04  -  No secrets in the repository
No real values for secrets, API keys, tokens, or passwords may appear anywhere in the repository, including commit history. `.env.example` contains key names only. CI must run a secret-scanner on every push.

### R-REPO-05  -  Dependency audit on every merge
`npm audit` (or equivalent) must run in CI on every merge to `main`. High-severity vulnerabilities must be resolved before the merge lands. New dependencies require a brief review justification in the PR description.

---

## 2. Module and Architecture Rules

### R-MOD-01  -  Module boundaries are enforced by lint
`dependency-cruiser` (or `eslint-plugin-import`) rules must codify the module dependency graph in ARCHITECTURE.md sec.6.2. CI must fail on any boundary violation. The allowed import directions are:

```
core <- events <- registration <- teams
core <- events <- rounds <- quiz
core <- events <- rounds <- challenges
core <- events <- rounds <- judging
core <- scoring <- {quiz, challenges, judging, rounds}
core <- leaderboard <- scoring
core <- exports <- {scoring, registration, quiz, challenges, judging}
core <- notifications
core <- admin-console <- {events, registration, rounds, scoring}
```

`core` must never import from a domain module.

### R-MOD-02  -  Public API only
A module may only import from another module's `index.ts` (its declared public API). Direct imports into `domain/`, `service/`, `repo/`, or `schemas/` subfolders of a sibling module are forbidden.

### R-MOD-03  -  UI components must not import repositories
UI components (in `src/components/` or `src/modules/*/ui/`) must not import repository functions directly. Data must flow via server components, server actions, or route handlers.

### R-MOD-04  -  Round engine extensibility
Adding a new round type must require only:
1. A new folder in `src/round-types/` implementing the `RoundType` interface
2. One line in the registry
3. Any required DB migrations

It must never require modifying the event, registration, scoring, leaderboard, or export modules.

### R-MOD-05  -  No in-memory authority
No authoritative state (deadlines, attempt status, scores) may live in process memory. All such state must be stored in PostgreSQL and re-read on each request or function invocation.

---

## 3. Coding Standards

### R-CODE-01  -  TypeScript strict mode
`tsconfig.json` must enable `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`. The build must fail on type errors.

### R-CODE-02  -  Zod at every trust boundary
All external inputs (route handler bodies, query params, URL params, environment variables, `jsonb` fields read from DB) must be parsed through a Zod schema before use. Unknown fields must be rejected (`.strict()`).

### R-CODE-03  -  No `any`
Explicit `any` types are forbidden. Use `unknown` and narrow where necessary. ESLint rule: `@typescript-eslint/no-explicit-any: error`.

### R-CODE-04  -  No floating-point arithmetic for scores
All score calculations must use PostgreSQL `numeric` type (stored) and TypeScript `Decimal` or integer-scaled arithmetic (computed). Never use `number` (IEEE 754 float) for marks, scores, or percentages that will be stored or compared.

### R-CODE-05  -  Pure scoring functions
`scoreAttempt()` and `computeResults()` must be pure functions: no I/O, no clock reads, no randomness, no external calls. They must be fully unit-testable without a database.

### R-CODE-06  -  Error messages must not leak internals
API error responses must never include stack traces, SQL text, internal table names, or file paths. The `error.code` must be a documented string constant; `error.message` must be human-readable and safe for display.

### R-CODE-07  -  Structured logging
All logs must use the structured JSON logger from `core/logger`. Fields: `ts`, `level`, `request_id`, `route`, `method`, `status`, `latency_ms`, `event_id`, `round_id`, `actor_hash`, `error_code`. Free-text `message` is permitted but must not include PII.

### R-CODE-08  -  No `console.log` in production code
`console.log`, `console.error`, etc. are forbidden in `src/`. Use the logger. ESLint rule: `no-console: error`.

---

## 4. Database and Migration Rules

### R-DB-01  -  Expand/migrate/contract
Schema changes follow three phases:
1. **Expand:** add new columns/tables with defaults or nullable; old code still works.
2. **Migrate:** backfill data; deploy new code.
3. **Contract:** remove old columns/tables in a later release after confirming no code references them.

Never drop a column or table in the same migration that adds a replacement.

### R-DB-02  -  Migrations are SQL files, reviewed by a human
All migrations live in `db/migrations/` as numbered SQL files (e.g., `0001_add_events.sql`). They must be reviewed in PRs. No ORM-generated migration may be applied without review.

### R-DB-03  -  Migrations must be backward compatible
A deployed migration must not break the currently-running application version. The application is deployed after the migration.

### R-DB-04  -  No direct DB access from the browser
The Supabase auto-generated REST/GraphQL API for app tables must not be used. All DB access goes through the Next.js API layer. App tables live in a non-public schema; the `anon` and `authenticated` roles have no grants on them.

### R-DB-05  -  RLS as defense in depth
Row-Level Security must be enabled with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all app tables. Default policies must be deny-all. Even though the application enforces authorization, RLS provides a second line of defense against accidental exposure.

### R-DB-06  -  Append-only tables are trigger-protected
`score_records` and `audit_logs` must have database triggers that block `UPDATE` and `DELETE`. These triggers must have integration tests (RLS-deny tests cannot substitute for trigger tests).

### R-DB-07  -  Short transactions on hot paths
No transaction on a hot path (registration, attempt start, answer save, submit) may hold a row lock for more than ~50 ms [T]. Advisory locks are acceptable when keyed per-entry; table-level locks are forbidden on hot paths.

### R-DB-08  -  Statement and lock timeouts on exports
Export queries must run under the `app_ro` role with `statement_timeout = 5s` and `lock_timeout = 1s`. These must be set at the session level before the query runs.

### R-DB-09  -  Composite foreign keys for cross-table event isolation
Every child table that references a parent table scoped to an event must use a composite FK `(event_id, parent_id)` referencing `(event_id, id)` on the parent. Single-column FKs on `parent_id` alone are insufficient and will be rejected in PR review.

---

## 5. Security Rules

### R-SEC-01  -  Single authorize() function
All authorization decisions must go through `core/auth/authorize(actor, permission, scope)`. No route, service, or repository may implement inline authorization checks that bypass this function.

### R-SEC-02  -  Route registry with deny-by-default
Every `api/v1` route must be registered with a policy (permission + scope + rate-limit class). A CI test must enumerate all routes and fail if any route is unregistered. An unregistered route is treated as `403 Forbidden`.

### R-SEC-03  -  Parameterized queries only
All database queries must use parameterized statements. String interpolation into SQL is prohibited. ESLint rule to detect template-literal SQL is mandatory.

### R-SEC-04  -  No server-side URL fetching in MVP
The application must not make outbound HTTP requests to URLs submitted by participants in the MVP. All URL validation is syntactic (WHATWG URL parser + allow/block rules). A link-check post-MVP feature must use SSRF protections.

### R-SEC-05  -  SSRF protections in URL validator
The URL validator must block:
- IP address literals (IPv4 and IPv6)
- `localhost`, `*.local`, `*.internal`, `*.localdomain`
- Private/link-local IPv4 ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`
- `javascript:`, `data:`, `file:`, `ftp:` schemes
- Userinfo in the URL (`user:pass@`)

### R-SEC-06  -  CSP with nonces
The Content Security Policy header must use nonces for inline scripts. `unsafe-inline` and `unsafe-eval` in `script-src` are forbidden. The nonce must be generated per-request.

### R-SEC-07  -  Service role key is server-only
`SUPABASE_SERVICE_ROLE_KEY` must never be referenced in any file that could be included in the client bundle. Any file that imports it must be server-only (verified by `server-only` package import or Next.js `'use server'` directive).

### R-SEC-08  -  Secure cookie settings
All session cookies must be `HttpOnly`, `Secure`, and `SameSite=Lax`. `SameSite=None` is forbidden. Cookies must have an `__Host-` prefix in production.

### R-SEC-09  -  HTML sanitization for Markdown
User-supplied Markdown (event descriptions, round instructions, question stems) must be rendered through an allow-list HTML sanitizer. The allowed element and attribute set must be defined in one shared sanitizer config and reviewed.

### R-SEC-10  -  CSV formula injection sanitization
The CSV sanitizer must be a single shared function in `core/csv`. It must have a dedicated unit test corpus that includes: `=CMD|' /C...'`, `+1-2`, `-2+3`, `@SUM`, TAB-prefixed, CR-prefixed, and legitimate negative numbers (`-2.5`). Legitimate numeric cells must not be sanitized.

---

## 6. API Rules

### R-API-01  -  Idempotency keys are required on mutable operations
The following operations must require an `Idempotency-Key` header: registration submit, attempt start, attempt submit, challenge submission, export create. The server must store the key and return the original response on replay.

### R-API-02  -  Server time in timing-sensitive responses
Every response to attempt start, answer save, attempt submit, and challenge start/submit must include `serverTime` (ISO-8601 UTC) and `deadlineAt` where applicable. The client must derive timer display from these values only.

### R-API-03  -  No state change on GET
GET requests must never modify state. Timer advancement, auto-submit, and lazy finalization are permitted side effects on GET requests only if they are safe to repeat (idempotent), but score writes triggered by GET must not be the primary path.

### R-API-04  -  Rate limits are required
Every route must declare its rate-limit class in the route registry. Rate limiting must be enforced by Upstash for all routes. The `RATE_LIMIT_ENABLED` flag may be used to disable enforcement in local development only; it must never be `false` in production.

### R-API-05  -  Pagination is required for list endpoints
Any list endpoint that could return more than 20 rows must use cursor-based pagination (`?cursor="¦&limit="¦`, max 100). Offset-based pagination is forbidden on production endpoints.

### R-API-06  -  Unknown fields rejected
API request bodies must be parsed with Zod `.strict()` or equivalent. Unknown fields must return `422 Unprocessable Entity` with a field-level error message.

---

## 7. Testing Rules

### R-TEST-01  -  No claimed readiness without a load-test report
A statement that the platform is ready to handle N concurrent users must be backed by a load-test report (stored in `tests/load/reports/`) that covers the relevant scenarios from ARCHITECTURE.md sec.24.3 and confirms all pass criteria. ARCHITECTURE.md sec.18 targets are goals, not proof.

### R-TEST-02  -  Reconciliation after every load test
After every load test, a reconciliation script must confirm that all client-acknowledged writes appear in the database, with no duplicates. The reconciliation result must appear in the test report.

### R-TEST-03  -  Cross-event isolation tests must pass on every CI run
`SEC-ISO-*` tests that attempt to read or write event B data with event A credentials must run in CI (not just load-test environments). These tests must be present for every endpoint that handles event-scoped data.

### R-TEST-04  -  Scoring functions must have golden-file tests
`scoreAttempt()` and `computeResults()` must have golden-file (snapshot) tests. A given set of inputs must always produce the same byte-identical output. These tests must be checked into the repository.

### R-TEST-05  -  DB triggers must have integration tests
The append-only trigger on `score_records` and `audit_logs` must be tested in the integration suite: an attempt to `UPDATE` or `DELETE` must raise an error.

### R-TEST-06  -  Recovery scenarios must be tested
At least REC-01 (DB outage), REC-02 (network interruption), REC-03 (duplicate request), and REC-04 (browser refresh) must be covered by automated or scripted tests before the first live event.

### R-TEST-07  -  Restore drill before every live event
A full backup restore drill must be completed and documented before every live event. The drill procedure is in `scripts/restore-drill.md`.

---

## 8. Timing and Scoring Rules

### R-TIME-01  -  DB clock only
`now()` in PostgreSQL is the only authoritative clock. The application server clock (`Date.now()`, `new Date()`) may be used only for logging, telemetry, and client-side display.

### R-TIME-02  -  Deadlines are absolute timestamps
`deadline_at` and `ends_at` are stored as absolute `timestamptz` values. They must never be computed from a duration at query time. Duration math happens once at attempt/challenge start and is stored.

### R-TIME-03  -  Pause extension is atomic
Round pause and the resulting deadline extension for all in-progress attempts must happen in a single database transaction. Partial updates (some attempts extended, some not) must not be possible.

### R-TIME-04  -  Auto-submit is correct regardless of sweeper
The sweeper job is an optimization for timely score publication. Correctness (no attempt remaining in `in_progress` past its deadline) must also be guaranteed by:
- Lazy finalization on any subsequent read/write to the attempt
- The "close round" action (which blocks until all in-progress attempts are finalized)

### R-SCORE-01  -  scoreAttempt() is the single source of truth
`scoreAttempt()` is the only function that computes quiz marks. It is called on submit, auto-submit, admin rescore, and preview. Any other code path that computes marks is a bug.

### R-SCORE-02  -  Correct answers are server-only
The `is_correct` flag on `question_options` must never appear in any API response sent to participants until results are released. This applies to preview mode as well (preview responses must omit correct flags).

---

## 9. Audit and Data Integrity Rules

### R-AUD-01  -  Audit in the same transaction
The `audit_logs` write for a sensitive operation must be in the same database transaction as the state change it records. If the transaction rolls back, the audit record rolls back with it. There must be no audit record for an operation that did not commit.

### R-AUD-02  -  Reason is required for corrections
The following operations require a mandatory non-empty `reason` string: score unlock, manual score adjustment, penalty application, disqualification, deadline extension, evaluation reconciliation, round reorder (after participant activity), result correction.

### R-AUD-03  -  Before/after state in audit records
The `audit_logs.before` and `audit_logs.after` columns must contain the full relevant state at the time of the operation. PII fields must be redacted (replaced with `"[REDACTED]"`) before storage.

### R-AUD-04  -  inputs_hash must be verified
A CI test (or admin tool) must be able to recompute `result_runs.inputs_hash` from the stored `config_snapshot` and the score records valid at `result_runs.created_at`, and confirm it matches the stored hash. This verifies that the stored result run is reproducible.

---

## 10. Deployment and Operations Rules

### R-OPS-01  -  Event freeze window
No production deployment may occur from Tâˆ’2 h before any scheduled round start through to the end of that round, except for approved emergency hotfixes. A hotfix requires a second approval and must be logged in the event's audit trail.

### R-OPS-02  -  Migration before code
Database migrations (expand phase) must be applied before deploying the new application code. The deployment pipeline must enforce this order.

### R-OPS-03  -  Backup before migration and release
A `pg_dump` backup must be triggered and confirmed successful before each migration run and before each production release. The backup timestamp must be recorded in the release notes.

### R-OPS-04  -  Rollback is forward-fix
Database rollback is not performed by reversing migrations. If a migration has a bug, a corrective forward migration is written. Application code rollback (promoting a previous Vercel deployment) is the rollback mechanism.

### R-OPS-05  -  Spend cap must always be enabled
The Upstash monthly budget cap and the Supabase Pro spend cap must be set at all times. Disabling a spend cap requires a written justification reviewed by the project owner.

### R-OPS-06  -  Verify T-0.5 items before event commitments
Before purchasing any paid plan or committing to running a live event, all `[U]` items listed in ARCHITECTURE.md sec.4.2 must be verified on official provider pages and recorded as `[V]` in the document with the verification date.

### R-OPS-07  -  Log retention
During live events, application logs must be shipped to a durable sink (not relying on Vercel Hobby's ~1 h log retention `[S]`). A logging sink must be configured and tested before the first live event.

---

## 11. Documentation Rules

### R-DOC-01  -  Evidence tags are mandatory
Every factual claim about provider limits, costs, or capabilities in any of the six planning documents must carry an evidence tag (`[V]`, `[S]`, `[E]`, `[T]`, `[P]`, or `[U]`). Untagged claims must be treated as `[U]`.

### R-DOC-02  -  [V] items must include a source URL and date
Every `[V]`-tagged item must include the source URL and the date it was verified. Verification older than 90 days must be re-confirmed before acting on the figure.

### R-DOC-03  -  Performance targets are targets, not facts
ARCHITECTURE.md sec.18.5 performance targets are tagged `[T]`. They must not be stated as facts in communications, commit messages, or READMEs without a load-test report reference.

### R-DOC-04  -  Decision register must be updated
When a proposed decision (AD-xx) is approved, rejected, or superseded, the Decision Register in ARCHITECTURE.md sec.25 must be updated with the outcome, decision date, and decision maker.

### R-DOC-05  -  Open items must be tracked
All `[U]` items and open decisions must appear in either ARCHITECTURE.md sec.27 or TASKS.md. Resolving an open item requires updating both the document and TASKS.md.
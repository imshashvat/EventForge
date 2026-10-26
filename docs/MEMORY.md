# EventForge  -  Agent Memory (MEMORY.md)

**Document status:** Living document  -  updated by AI agents and developers
**Last updated:** 2026-09-25
**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) * [PRD.md](./PRD.md) * [RULES.md](./RULES.md) * [DESIGN.md](./DESIGN.md) * [TASKS.md](./TASKS.md)

> This file is the persistent memory store for AI coding agents working on EventForge. It records key decisions, gotchas, coding patterns, and contextual facts that should not have to be re-derived on every session. Humans may also update this file. Never delete entries; supersede them with a new entry and mark the old one `[SUPERSEDED by "¦]`.

---

## 1. Project Identity

| Key | Value |
|---|---|
| **Product name** | EventForge |
| **Working title** | "EventArena" (used in source PDF; replaced by EventForge in all generated docs) |
| **Non-commercial** | âœ… Confirmed 2026-09-25  -  events do not charge fees or generate revenue |
| **Owner** | Project owner (name TBD) |
| **Primary stack** | Next.js 15 (App Router) * TypeScript (strict) * Supabase Postgres * Drizzle ORM * Tailwind CSS * Radix UI * Vitest * Playwright * k6 |
| **Deployment** | Vercel (Hobby  -  non-commercial confirmed) * Supabase (Free <-’ Pro for events) |
| **Repository status** | Greenfield as of 2026-09-25; no existing code |
| **Docs location** | `docs/` in the repo root |

---

## 2. Resolved Decisions

| Decision ID | Resolution | Date | Notes |
|---|---|---|---|
| D-P02 | **Vercel Hobby permitted**  -  events are non-commercial | 2026-09-25 | Hobby cannot be used for commercial events [V]; our events are non-commercial; Hobby plan approved for all environments |
| AD-01 | **Modular monolith** selected (Next.js App Router + TypeScript) | 2026-09-25 | Proposed in ARCHITECTURE.md; awaiting owner formal sign-off at M0 |
| AD-02 | **Supabase Postgres** as system of record | 2026-09-25 | Proposed |
| AD-05 | **Snapshot polling baseline**; optional Supabase Realtime Broadcast version-ping for staff | 2026-09-25 | Proposed; polling eliminates WebSocket connection limit problem [V 200 conns on Free] |
| AD-16 | **Team quiz = ONE SHARED ATTEMPT per team entry** (entry_id scoped, not participant_id) | 2026-10-02 | quiz_attempts.entry_id replaces participant_id; quiz_responses adds answered_by_participant_id for audit only; independent navigation within shared timer; no real-time sync layer needed |

---

## 3. Open Decisions (Unresolved)

| ID | Decision | Impact |
|---|---|---|
| D-P10 | MFA for admins: mandatory or optional TOTP? | Auth setup, UX |
| D-P04 | Quiz submit grace period (default 0 ms): add 500 ms for network jitter? | Scoring fairness |
| R-09 | Team quiz: one shared attempt (team entity takes it) or one per member? | Major data model impact; must decide before M1-E1 |
| R-01 | Missing-round policy default: `zero`, `exclude`, or `rank_last`? | Scoring |
| D-P09 | Privacy / data-retention policy | Legal; post-MVP but affects field design |
| AD-12 | Mumbai region: is it available on Supabase and Vercel? [U] | Latency for Indian users |

---

## 4. Architectural Facts to Remember

### 4.1 The DB Clock is the Only Clock
`now()` in PostgreSQL is the authoritative clock. The app server's `Date.now()` is only for logging. `deadline_at` is computed once (at attempt start) as `LEAST(started_at + duration, round.ends_at)` and stored as an absolute `timestamptz`. It never changes except via audited extension or pause/resume.

### 4.2 Score Records Are Append-Only
`score_records` has a DB trigger blocking UPDATE and DELETE. Corrections create a new row with `superseded_by` pointing to the old row. `computeResults()` reads only the current non-superseded record per `(round_id, entry_id, source)`.

### 4.3 Leaderboard is Snapshot-Based
The live leaderboard is a single precomputed row in `leaderboard_snapshots`. On poll, the server checks if `max(score_records.id) > snapshot.watermark` and if `now() - snapshot.generated_at >= min_rebuild_interval`. If stale, the first request acquires `pg_try_advisory_xact_lock` and rebuilds; others serve the old snapshot.

### 4.4 RLS is Defense in Depth, Not the Primary Guard
App tables are in a non-public schema. The `anon` and `authenticated` Supabase roles have no grants. The app connects as `app_rw` (runtime) or `app_ro` (exports). RLS is still enabled with deny-by-default policies as a second line of defense. This means: do not rely on RLS alone in tests  -  test the application-layer authorization too.

### 4.5 Composite FKs for Event Isolation
Every child table uses `(event_id, parent_id)` composite FKs. This makes cross-event references impossible at the database level. The `event_id` on the child row must always match the `event_id` on the parent row. Never create a child row with just `parent_id`.

### 4.6 Idempotency Key Pattern
| Operation | Key source | Storage | TTL |
|---|---|---|---|
| Registration submit | Client UUID header | `idempotency_keys` table | 24 h |
| Attempt start | Client UUID header | `idempotency_keys` table | 24 h |
| Attempt submit | Client UUID header | `idempotency_keys` table | 24 h |
| Challenge submit | Client UUID header | `idempotency_keys` table | 24 h |
| Export create | Client UUID header | `idempotency_keys` table | 1 h |

On replay: return the stored response body and status code. Do not re-execute the operation.

### 4.7 Answer Save Protocol
```
PUT /api/v1/attempts/{id}/answers
Body: { answers: [{ attemptQuestionId, answer, clientSeq }], clientSentAt }

Server:
  1. Check attempt is in_progress AND now() <= deadline_at + save_grace
  2. Upsert each answer: ON CONFLICT (attempt_question_id) DO UPDATE
     WHERE excluded.client_seq > quiz_responses.client_seq
  3. Return: { savedSeq, serverTime, deadlineAt, status }
```

`clientSeq` prevents out-of-order saves from overwriting a newer answer with an older one.

### 4.8 Module Import Rules (Never Cross These)
- `core` imports nothing from domain modules
- UI components (`src/components/ui/` or `src/modules/*/ui/`) never import repo functions
- Domain modules import only through each other's `index.ts`
- Round-type plugins (`src/round-types/`) import from `core` and their own folder only; they do not import from other domain modules directly

---

## 5. Coding Patterns

### 5.1 Route Handler Template

```typescript
// src/app/api/v1/events/[id]/registrations/route.ts
import { withRoute } from '@/core/route-handler';
import { registrationSchema } from '@/modules/registration/schemas';
import { createRegistration } from '@/modules/registration';

export const POST = withRoute({
  permission: 'registration:create',
  scope: 'event',
  rateLimit: 'registration-submit',
  idempotent: true,
}, async ({ actor, scope, body, idempotencyKey }) => {
  const input = registrationSchema.parse(body); // throws if invalid
  return createRegistration({ eventId: scope.eventId, actor, input, idempotencyKey });
});
```

### 5.2 Transaction Helper Pattern

```typescript
// core/db/tx.ts
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx);
  });
}

// Usage in service:
return withTx(async (tx) => {
  await writeAudit({ actor, action: 'registration.create', ... }, tx);
  await insertParticipant({ ... }, tx);
  await incrementCounter({ eventId, key: 'participant_no' }, tx);
});
```

### 5.3 authorize() Pattern

```typescript
// In a service function:
await authorize(actor, 'registration:read', { type: 'event', eventId });
// Throws ForbiddenError if not permitted.
// Always call BEFORE any DB read that returns sensitive data.
```

### 5.4 Error Response Shape

```typescript
// All API errors return:
{
  error: {
    code: string;        // e.g. 'attempt_closed', 'capacity_full', 'not_found'
    message: string;     // human-readable, safe to display
    details?: unknown;   // field-level errors for 422
    requestId: string;   // from X-Request-Id header or generated
  }
}
```

HTTP status codes:
- `400`  -  bad request (malformed input that Zod didn't catch)
- `401`  -  unauthenticated
- `403`  -  unauthorized (authenticated but no permission)
- `404`  -  not found
- `409`  -  conflict (already registered, already submitted)
- `422`  -  validation error (Zod failure, business rule violation with field context)
- `429`  -  rate limited (include `Retry-After`)
- `503`  -  service temporarily unavailable (DB down, throttled)

### 5.5 Score Calculation (Numeric Safety)

```typescript
// Use Decimal.js or integer-scaled arithmetic:
import { Decimal } from 'decimal.js';

function scoreQuestion(marks: string, negMarks: string, isCorrect: boolean | null, isBlank: boolean): Decimal {
  if (isBlank) return new Decimal(0);
  if (isCorrect) return new Decimal(marks);
  return new Decimal(negMarks).negated();
}
```

All marks are stored as `NUMERIC(10,4)` in Postgres and converted to `Decimal` in TypeScript. Never use `Number()` for score arithmetic.

---

## 6. Infrastructure Notes

### 6.1 Connection Pooling
- Runtime app: `DATABASE_URL` <-’ Supabase transaction-mode pooler, `DB_POOL_MAX=2` per instance
- Exports: `DATABASE_READONLY_URL` <-’ same pooler but `app_ro` role, `statement_timeout=5s`, `lock_timeout=1s`
- Migrations: `DATABASE_MIGRATE_URL` <-’ direct connection (session mode), owner role

### 6.2 Supabase Free Tier Gotchas
- **Pauses after 1 week of inactivity** [V]  -  health probes must keep it active, or use Pro for events
- **No automatic backups** [V]  -  own pg_dump backups are mandatory even on Free
- **Auth email rate limit** is low (reportedly 2/hour built-in SMTP, ~30/hour initial custom SMTP) [S]  -  configure custom SMTP before testing email flows; plan staged or optional verification

### 6.3 Vercel Hobby Gotchas
- **Non-commercial only** [V]  -  confirmed our events are non-commercial âœ…
- **Cannot connect to org repos** [V]  -  use personal GitHub repos or upgrade to Pro
- **Log retention ~1 hour** [S]  -  ship logs to a durable sink before any live event
- **Function max duration 300 s** [V]  -  exports must be chunked; no single-request long-running exports

### 6.4 Upstash Rate Limiter Behavior
- Free: 500,000 commands/month; 10,000 cmd/s [V]
- Each rate-limit check = 2 Redis commands (ZADD + ZCOUNT for sliding window)
- Fail-open for participant hot paths (quiz save/submit): if Redis is unavailable, apply an in-memory fallback limiter (less precise but prevents 500s)
- Fail-closed for auth and export: if Redis is unavailable, return 503

---

## 7. Testing and Quality Gates

### 7.1 CI Must Pass Before Merge
- Lint (ESLint, no-console, no-any, no template-literal SQL)
- TypeScript (tsc --noEmit, strict mode)
- Unit tests (Vitest)
- Integration tests (Vitest + real Postgres service container)
- Build (next build)
- Secret scan
- Dependency audit (npm audit --audit-level=high)
- Bundle size check
- Lighthouse CI (performance budgets)
- Dependency-cruiser (module boundary enforcement)
- Route registry completeness (all routes registered with a policy)

### 7.2 Load Test Gate (M4)
Before the first live event, all load test scenarios LT-0 through LT-9 must pass with their criteria. Results must be stored in `tests/load/reports/`. The platform is not declared ready until this gate is passed (R-TEST-01).

---

## 8. Session Log

| Date | Agent/Person | Summary of changes |
|---|---|---|
| 2026-09-25 | AI (Antigravity) | Created all 6 docs: ARCHITECTURE.md (sec.1""27, 1120 lines), PRD.md, RULES.md, DESIGN.md, TASKS.md, MEMORY.md |
| 2026-09-25 | AI (Antigravity) | Resolved D-P02: confirmed non-commercial; patched ARCHITECTURE.md AD-11 to "Resolved" |

---

## 9. File Map

| File | Purpose | Size |
|---|---|---|
| `docs/ARCHITECTURE.md` | Technical architecture (27 sections) | ~93 KB |
| `docs/PRD.md` | Product requirements, business rules, NFRs, glossary | ~35 KB |
| `docs/RULES.md` | Mandatory development rules (11 sections) | ~28 KB |
| `docs/DESIGN.md` | Design system: tokens, components, budgets, a11y | ~22 KB |
| `docs/TASKS.md` | Task tracker: M0""M5 milestones, open items | ~18 KB |
| `docs/MEMORY.md` | This file  -  agent context, patterns, session log | ~12 KB |
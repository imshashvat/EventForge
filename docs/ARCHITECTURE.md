# EventForge  -  Technical Architecture

**Document status:** Draft v0.1  -  architecture proposal. Nothing described here is implemented or load-tested.
**Last updated / infrastructure facts verified:** 2026-09-25
**Companion documents:** [PRD.md](./PRD.md) * [RULES.md](./RULES.md) * [DESIGN.md](./DESIGN.md) * [TASKS.md](./TASKS.md) * [MEMORY.md](./MEMORY.md)

Evidence tags (`[V]` `[S]` `[E]` `[T]` `[P]` `[U]`) are defined in PRD.md.
Business-rule IDs (`BR-xx`) and requirement IDs (`FR-"¦`, `NFR-"¦`) refer to PRD.md.

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Repository Inspection Result](#2-repository-inspection-result)
3. [Architectural Drivers](#3-architectural-drivers)
4. [Infrastructure Research](#4-infrastructure-research)
5. [Technology Selection and Alternatives](#5-technology-selection-and-alternatives)
6. [System Architecture](#6-system-architecture)
7. [Data Model](#7-data-model)
8. [Authentication and Authorization](#8-authentication-and-authorization)
9. [Event, Registration and Round Lifecycles](#9-event-registration-and-round-lifecycles)
10. [Round Engine](#10-round-engine)
11. [Quiz Engine](#11-quiz-engine)
12. [Development Challenge Submissions](#12-development-challenge-submissions)
13. [Manual Judging](#13-manual-judging)
14. [Scoring and Results](#14-scoring-and-results)
15. [Leaderboard](#15-leaderboard)
16. [CSV Export](#16-csv-export)
17. [API Design](#17-api-design)
18. [Scalability Analysis](#18-scalability-analysis)
19. [Security](#19-security)
20. [Reliability and Failure Handling](#20-reliability-and-failure-handling)
21. [Deployment, Environments and Configuration](#21-deployment-environments-and-configuration)
22. [Monitoring](#22-monitoring)
23. [Backup and Recovery](#23-backup-and-recovery)
24. [Testing and Load-Test Strategy](#24-testing-and-load-test-strategy)
25. [Decision Register](#25-decision-register)
26. [Extensibility and Migration](#26-extensibility-and-migration)
27. [Known Limitations and Open Items](#27-known-limitations-and-open-items)

---

## 1. Purpose and Scope

This document defines the proposed technical architecture for **EventForge**: a modular monolith that hosts many independent events, runs configurable rounds under server-authoritative timers and scoring, publishes access-controlled leaderboards, and exports safe CSV files  -  designed for 500+ simultaneous participants.

It separates verified facts (provider limits), estimates (workload model), and targets (to be tested). It deliberately does **not** assert that the free tiers or the design "will scale"; it identifies where they demonstrably cannot and what must be measured.

---

## 2. Repository Inspection Result

| Item | Finding (2026-09-25) |
|---|---|
| Repository mounted in the working environment | None found. The workspace contained no `.git` directory, no source files, no `package.json`, no uploads, and no pre-existing `docs/` folder. |
| Existing versions of the six documents | None existed; nothing was overwritten or deleted. |
| Consequence | The project is treated as **greenfield**. Technology choices are proposals (`[P]`), not adaptations of existing code. |
| Required follow-up | **T-0.1:** when the real repository is available, inspect its structure, dependencies, lint/test setup and any documentation; reconcile this architecture with it; record conflicts in the Decision Register (sec.25) before writing code. |

> If a repository exists elsewhere, RULES.md rule `R-REPO-01` requires the inspection to happen and these documents to be reconciled before any modification.

---

## 3. Architectural Drivers

| # | Driver | Architectural consequence |
|---|---|---|
| A1 | 500+ simultaneous users with synchronized surges | Short, single-transaction write paths; pooled connections; snapshot-based reads; measured headroom |
| A2 | Server-authoritative timers/scores | Absolute deadlines in DB; DB clock; scoring in server code from immutable inputs |
| A3 | Free-tier-first, verified limits | Free tiers for dev/staging; explicit paid "event tier"; no dependence on capabilities free tiers cap below 500 |
| A4 | Multi-event isolation | `event_id` on every event-scoped table, composite FKs, authorization scoping helpers, RLS defense in depth |
| A5 | Reproducible, auditable results | Append-only score records, versioned configs, result runs, audit log |
| A6 | Extensible round types | Plugin registry + typed contracts |
| A7 | Single small team | Modular monolith, one deployable, boring technology |
| A8 | Restart/deploy safety | No in-memory authority; stateless functions; DB-backed jobs |

---

## 4. Infrastructure Research

### 4.1 Method and Date

All entries were checked on **2026-09-25** using web search and page fetches.
- `[V]`  -  number appears on the provider's own pricing/documentation page retrieved that day
- `[S]`  -  only a third-party page was seen (or a provider page could not be fetched in full)

Provider pages change; every `[V]` item **must be re-verified** in task **T-0.5** before any purchase or event commitment. Nothing here is a quote.

### 4.2 Verified Provider Limits

#### Hosting / Compute

| Provider | Limit or behavior | Tag |
|---|---|---|
| Vercel Hobby | Restricted to non-commercial personal use; commercial use requires Pro/Enterprise | `[V]` |
| Vercel (all plans) | Functions auto-scale to 30,000 concurrent; burst limit **1,000 concurrent executions per 10 s per region**; beyond <-’ `503 FUNCTION_THROTTLED` | `[V]` |
| Vercel Functions (Node) | Max duration Hobby **300 s** (default and max); Pro default 300 s, up to 800 s; 2 GB memory on Hobby | `[V]` |
| Vercel Hobby | Cannot connect to repositories owned by Git **organizations** (personal repos are fine) | `[V]` |
| Vercel Hobby | â‰ˆ100 GB transfer, 1M edge requests, 1M function invocations, 4 CPU-hours, 100 deployments/day; overage cannot be purchased  -  features pause | `[S]` |
| Vercel Pro | $20 per seat/month plus usage | `[S]` |
| Cloudflare Workers Free | 100,000 requests/day; 10 ms CPU/request; 50 external subrequests; 128 MB; 5 Cron Triggers | `[V]` |
| Cloudflare Workers Paid | $5/month minimum; 10M requests/month included then $0.30/M; up to 5 min CPU/request | `[V]` |
| Render Free web service | Spins down after 15 min idle; ~1 min spin-up; 750 free instance hours/workspace/month; ephemeral filesystem; free Postgres expires after 30 days | `[V]` |
| Fly.io, Railway, Koyeb | Not researched from official sources | `[U]` |

#### Relational Databases

| Provider | Limit or behavior | Tag |
|---|---|---|
| Supabase Free | 500 MB DB (shared CPU, 500 MB RAM); 5 GB egress; 1 GB file storage (50 MB max upload); 50,000 MAU; unlimited API requests; **no automatic backups**; **paused after 1 week of inactivity**; 2 active projects; 1-day log retention; community support; no uptime SLA | `[V]` |
| Supabase Free | Custom SMTP included; basic MFA (TOTP) included | `[V]` |
| Supabase Free | Direct/pooler connection limits not itemized (Micro listed as 60 direct / 200 pooler) | `[U]` |
| Supabase Pro | From $25/month/org; 8 GB disk; 250 GB egress; daily backups kept 7 days; **never pauses**; 100,000 MAU; spend cap on by default | `[V]` |
| Supabase compute add-ons | Micro $10 (shared, 1 GB, 60 direct / 200 pooler); Small $15 (shared, 2 GB, 90/400); Medium $60 (shared, 4 GB, 120/600); Large $110 (dedicated 2 vCPU, 8 GB, 160/800). Pro includes $10/month compute credit | `[V]` |
| Supabase PITR | $100/month per 7 days of retention | `[V]` |
| Supabase Auth email | Default built-in SMTP is heavily rate-limited (reported 2 emails/hour); after custom SMTP is set, a low initial limit (reported 30/hour) applies and is adjustable | `[S]` |
| Neon Free | 100 CU-hours/month, 0.5 GB storage, autoscale to 2 CU, 5 GB transfer, 6-hour restore history; **scale-to-zero always on** (5 min idle) and cannot be disabled | `[V]` |
| Neon Launch | Usage-based: $0.106/CU-hour, $0.35/GB-month; scale-to-zero can be disabled; history up to 7 days | `[V]` |
| Cloudflare D1 Free | 5M rows read/day; 100,000 rows written/day (indexes add written rows); 5 GB; limits reset 00:00 UTC | `[V]` |
| Cloudflare D1 Free | From Sept 1, 2026 exceeding daily limits makes **queries fail** until reset | `[S]` |
| Cloudflare D1 Paid | 25B rows read + 50M rows written/month included; $0.75/GB-month above 5 GB | `[V]` |
| Firestore (Spark/free quota) | 1 GiB; 50,000 reads/day; **20,000 writes/day**; 20,000 deletes/day; 10 GiB/month egress; resets midnight Pacific | `[V]` |
| Firebase Realtime Database (Spark) | **100 simultaneous connections** | `[V]` |

#### Realtime / Messaging

| Provider | Limit or behavior | Tag |
|---|---|---|
| Supabase Realtime | Free: **200 concurrent connections**, 100 msg/s, 2M msgs/month, 256 KB payload. Pro: **500 concurrent** (then $10 per 1,000), 500 msg/s, 5M msgs/month, 3 MB payload. Pro without spend cap: 10,000 connections. Exceeding <-’ `too_many_connections`/`too_many_joins` | `[V]` |
| Ably Free | **200 concurrent connections**, 200 channels, 6M messages/month, 500 msg/s | `[V]` |
| Pusher Sandbox | **100 concurrent connections**; daily message cap | `[S]` |
| Cloudflare Durable Objects (Free) | SQLite-backed only; 100,000 requests/day; WebSocket messages billed 20:1 | `[V]` |
| Vercel WebSockets | Connections close at function max duration; no sticky routing by room | `[S]` |

#### Cache, Rate Limiting, Email, Load Testing

| Provider | Limit or behavior | Tag |
|---|---|---|
| Upstash Redis Free | 256 MB; **500,000 commands/month**; 10 GB bandwidth; 10,000 cmd/s; 1 free DB. Pay-as-you-go $0.20 per 100K commands with budget cap | `[V]` |
| Resend Free | **3,000 emails/month, 100/day**; Pro $35/month for 100,000/month | `[V]/[S]` |
| Brevo Free | **300 email sends/day**; provider footer branding on free | `[V]` |
| Grafana Cloud k6 Free | **500 virtual-user-hours/month**; per-test max VUs on Free not confirmed | `[V]/[U]` |

> **Not yet researched** (`[U]`): GitHub Actions free minutes; Sentry free-tier limits; Vercel Cron limits on Hobby; Vercel Firewall/rate-limit availability per plan; Supabase `pg_cron`/`pg_net` minimum interval; Supabase region list (Mumbai availability); Cloudflare Turnstile limits; uptime-monitor free plans; Supabase Storage CDN egress accounting.

### 4.3 Modeled Demand vs. Verified Limits

`[E]` figures are estimates for one 500-participant event day (one quiz with 30 questions plus a challenge round, 3 hours of leaderboard viewing).

| Limit (verified) | Modeled demand `[E]` | Assessment |
|---|---|---|
| Supabase Free Realtime: 200 concurrent | 500 viewers if each holds a WebSocket | Exceeds 2.5Ã -  <-’ use snapshot polling (sec.15) |
| Firebase RTDB Spark: 100 connections | 500 | Exceeds 5Ã -  |
| Ably Free: 200 connections | 500 | Exceeds 2.5Ã -  |
| Firestore free: 20,000 writes/day | â‰ˆ 45,000 writes | Exceeds â‰ˆ 2Ã -  |
| D1 free: 100,000 rows written/day | â‰ˆ 90,000""135,000 rows | At or over the cap |
| Render free: 15-min spin-down, ~1-min cold start | A round starts after idle time | Unacceptable for a live start |
| Supabase Free: paused after 1 week idle; no backups | Event days follow long idle periods | Unacceptable as sole production DB |
| Vercel Hobby: non-commercial only `[V]` | Depends on event nature | Approval item D-P02 |
| Vercel Hobby â‰ˆ1M function invocations/month `[S]` | â‰ˆ 350""450k per event day | â‰ˆ 35""45% of month's allowance |
| Upstash Free: 500K commands/month | â‰ˆ 30k per quiz | Fits  -  only if leaderboard polling is not rate-limited through Redis |
| Resend Free: 100 emails/day; Brevo Free: 300/day | 500 verification emails | Resend: 5 days; Brevo: 2 days <-’ verification must be optional, staged, or on a paid tier |
| Supabase Pro/Micro pooler: 200 client connections | Up to 500 concurrent invocations at a surge | Possible exhaustion <-’ Small (400) or Medium (600) compute for events |

### 4.4 Can an All-Free Architecture Support the Workload?

**It cannot be verified as adequate**, and several documented properties make it unsuitable as the sole platform for a live 500-participant event:

- No automated backups and inactivity pausing on Supabase Free `[V]`
- Free realtime tiers (Supabase 200, Ably 200, Firebase 100) are below 500 concurrent `[V]`
- Vercel Hobby is non-commercial `[V]` and its request/invocation allowances leave little multi-event headroom `[S]`
- Free email caps (100""300/day) cannot deliver 500 verification emails in a day `[V]`
- No provider on a free plan offers an uptime SLA `[V]`

**Conclusion:** use free tiers for development, CI, staging and functional testing. Treat the live-event configuration as a small, time-boxed **paid event tier** (sec.4.5).

### 4.5 Recommended Low-Cost Event Tier

| Component | Dev/staging (free) | Event tier | List price basis |
|---|---|---|---|
| App hosting/functions | Vercel Hobby (if non-commercial) | Vercel Pro (1 seat) | $20/seat/month `[S]` |
| Postgres + Auth + Storage + Realtime | Supabase Free (2 projects) | Supabase Pro org, Small compute | $25 + $15 âˆ’ $10 credit = **$30/month** `[V]` |
| Rate limiting | Upstash Free | Upstash pay-as-you-go with budget cap | $0.20 per 100K commands `[V]` |
| Email | Brevo Free (300/day) | Brevo Free with staged verification, or Resend Pro | $0 or $35/month `[V]` |
| Monitoring / CI / load test | Free tiers | same | $0 |
| Backups | Own nightly dump | Supabase daily backups + own dumps; PITR optional | PITR $100/month `[V]` (optional) |

**Arithmetic (list prices, excluding tax/overages; not a quote):** â‰ˆ $50/month (Vercel Pro + Supabase Pro Small, Brevo free) to â‰ˆ $85/month (adding Resend Pro).

**Main cost drivers:** (1) database compute size; (2) commercial-eligible app hosting; (3) email volume; (4) realtime connections if participants use WebSockets; (5) optional PITR; (6) load-test virtual-user hours beyond the free 500.

### 4.6 Alternatives Considered

| Alternative | Verdict | Reason |
|---|---|---|
| All-Cloudflare (Workers + D1 + Durable Objects + Pages) | Strong low-cost contender; **not selected** | D1 is single-writer SQLite (no `SKIP LOCKED`/advisory locks/window functions); free D1 write cap is exceeded by one quiz `[E]`; owner's stack is Next.js/PostgreSQL |
| Firebase (Firestore + Auth + Hosting) | **Rejected** | Free write/connection quotas too low `[V]`; document model poor for relational scoring/exports |
| Neon Postgres + separate auth/realtime | **Viable substitute** | Free plan: scale-to-zero cannot be disabled `[V]`; Launch removes that. Kept as fallback DB |
| Render web service + Render Postgres | **Rejected for events** | Free spin-down and 30-day DB expiry `[V]` |
| Self-managed VPS | **Rejected for MVP** | Ops burden (patching, backups, TLS); not free |
| Ably/Pusher for participant realtime | **Not selected** | Free caps (200/100) below 500 `[V]`; polling design removes the need |

### 4.7 Selected Infrastructure (Proposed `[P]`)

```
Vercel (Next.js)  â"€â - ¶  Supabase Postgres via pooler
                       (+ Supabase Auth, Storage, Realtime Broadcast)
                  â""â"€â"€â - ¶  Upstash Redis (rate limiting)
                  â""â"€â - ¶  Brevo/Resend SMTP

GitHub Actions (CI, migrations, backups)
Sentry (errors)
k6 (load tests)
```

---

## 5. Technology Selection and Alternatives

### 5.1 Selected Primary Architecture

A **modular monolith**: one Next.js (App Router) + TypeScript application deployed to Vercel, using Supabase-hosted PostgreSQL as the single system of record. Server logic lives in route handlers and server actions organized into domain modules with enforced boundaries. Background work runs as DB-backed jobs advanced by authenticated "tick" endpoints. Leaderboards are versioned snapshots served over cached HTTP with an optional realtime "version ping".

**Why this fits:** relational integrity and transactions are central (registrations, attempts, scoring, audits); Postgres provides `SELECT "¦ FOR UPDATE`, advisory locks, `ON CONFLICT`, window functions, `jsonb`, RLS, and `FOR UPDATE SKIP LOCKED`; serverless request-scoped compute suits bursty events; and the stack (Next.js, TypeScript, PostgreSQL, Vercel, JWT/RBAC) is familiar to the project owner, which reduces delivery risk.

### 5.2 Comparison Table

| Concern | Selected `[P]` | Alternatives | Trade-off / why not |
|---|---|---|---|
| Frontend | Next.js App Router, React, TypeScript, Tailwind CSS, Radix UI primitives | Remix, SvelteKit, Vite SPA | Next.js gives SSR/RSC for fast first paint on mobile and one deployable |
| Backend | Next.js route handlers as a modular monolith | NestJS on always-on host; Hono on Workers | Always-on Node hosting has no verified free option without sleep `[V Render]`; Workers has 10 ms CPU on free `[V]` |
| Database | PostgreSQL (Supabase) | D1, Firestore, MySQL | See sec.4.6 |
| ORM/query | Drizzle ORM + raw SQL for scoring/leaderboard | Prisma, Kysely, raw SQL only | Drizzle keeps SQL visible; Prisma adds engine/connection overhead |
| Validation | Zod schemas shared client/server | Valibot, Yup | Ecosystem and Drizzle/Zod integration |
| Auth | Supabase Auth (email/password, verification, reset, TOTP) behind `AuthProvider` interface | Auth.js, custom auth, Firebase Auth, Clerk | MAU 50,000 free `[V]`; custom SMTP allowed on Free `[V]` |
| Realtime | Cached snapshot polling with ETag (baseline) + optional Supabase Broadcast version-ping | Raw WebSockets/SSE; Ably; Firebase RTDB | WebSockets/SSE on serverless bounded by function duration `[V 300 s]`; managed realtime free caps < 500 `[V]` |
| Rate limiting | Upstash `@upstash/ratelimit` | In-memory; Postgres counters | Serverless has no shared memory; Redis is the standard fit |
| Jobs | Postgres jobs table + tick endpoints | BullMQ; Supabase Edge Functions | No always-on worker available on free hosting |
| File storage | Supabase Storage behind a `Storage` interface | Cloudflare R2, S3 | 1 GB free `[V]` |
| Email | SMTP via Brevo/Resend | SES | Daily caps `[V]` drive queueing design |
| Testing | Vitest, Testing Library, Playwright, k6 | Jest, Cypress | Speed, TS support, k6 for protocol-level load |
| Observability | Structured JSON logs, Sentry `[U]`, Supabase reports `[V]`, uptime pings | Datadog etc. | Cost |

### 5.3 Vendor Lock-In and Exit Paths

| Component | Lock-in | Mitigation |
|---|---|---|
| Supabase Postgres | Low (standard Postgres; `pg_dump`) | Only standard extensions; migrations in repo |
| Supabase Auth | Medium (auth.users, JWT) | App `users` table keyed by `auth_user_id`; `AuthProvider` interface |
| Supabase Realtime | Low (optional enhancement) | Polling is the baseline |
| Supabase Storage | Low | `Storage` interface; object URLs abstracted |
| Vercel | Low""medium | Standard Node/Next.js; avoid Vercel-only APIs in domain code |
| Upstash | Low | `RateLimiter` interface |

### 5.4 Migration Considerations

Schema changes follow **expand <-’ migrate <-’ contract** (RULES.md sec.7). Moving to another Postgres (e.g., Neon) requires a connection-string change plus re-pointing Auth/Storage/Realtime adapters.

---

## 6. System Architecture

### 6.1 Runtime Architecture

```
[Participant browser]  â"€â"
[Admin / Judge browser] â"€â"¼â"€â - ¶  [CDN / edge cache]  â"€â - ¶  [Next.js API route handlers /api/v1]
[Public visitor]        â"€â"˜                               â"‚
                                                          â"œâ"€â - ¶  [Upstash Redis  -  rate limits]
                                                          â"œâ"€â - ¶  [Supabase Pooler (transaction mode)]
                                                          â"‚         â""â"€â - ¶  [PostgreSQL  -  system of record]
                                                          â"œâ"€â - ¶  [Supabase Auth]
                                                          â"œâ"€â - ¶  [Supabase Storage]
                                                          â""â"€â"€â - ¶  [Supabase Realtime Broadcast  -  version ping only]
                                                                     â""â"€â"€â - ¶  [Participant clients]

[GitHub Actions] â"€â - ¶  [Internal tick endpoints] â"€â - ¶  [Postgres jobs table]
[GitHub Actions] â"€â - ¶  [pg_dump] â"€â - ¶  [Off-platform encrypted backup]
```

**Key properties:**

- **Stateless compute.** No authoritative state in function memory (BR-02/03). Any instance can serve any request.
- **One system of record.** All business state in Postgres. Redis holds only rate-limit counters (loss is harmless). Realtime carries only a version number.
- **DB access only from the server.** Browsers never query tables directly. Tables live in a non-exposed schema; RLS is enabled as defense in depth (sec.7.5).

### 6.2 Module Boundaries

```
core  (no domain imports)
  â"œâ"€ db + tx helpers
  â"œâ"€ authn/authz
  â"œâ"€ rate-limit
  â"œâ"€ idempotency
  â"œâ"€ jobs runner
  â"œâ"€ csv writer
  â"œâ"€ db-clock helper
  â""â"€ audit writer

events â"€â - ¶ core
registration â"€â - ¶ events
teams â"€â - ¶ registration
rounds â"€â - ¶ events
quiz â"€â - ¶ rounds
challenges â"€â - ¶ rounds
judging â"€â - ¶ rounds
scoring â"€â - ¶ quiz, challenges, judging, rounds
leaderboard â"€â - ¶ scoring
exports â"€â - ¶ scoring, registration, quiz, challenges, judging
notifications â"€â - ¶ core
admin-console â"€â - ¶ events, registration, rounds, scoring
```

**Rules** (enforced by lint/dependency-cruiser, RULES.md sec.2): a module may import another module only through its `index.ts` public API; `core` imports nothing from domain modules; UI components never import repositories.

### 6.3 Proposed Repository Structure

```
/
â"œâ"€ docs/                  # the six planning documents
â"œâ"€ src/
â"‚  â"œâ"€ app/                # Next.js routes only (thin)
â"‚  â"‚  â"œâ"€ (public)/        # landing, events, event detail, public leaderboard
â"‚  â"‚  â"œâ"€ (auth)/          # sign-in, sign-up, verify, reset
â"‚  â"‚  â"œâ"€ (participant)/e/[slug]/  # dashboard, rounds, quiz, challenge, results
â"‚  â"‚  â"œâ"€ (admin)/admin/"¦  # admin console
â"‚  â"‚  â"œâ"€ (judge)/judge/"¦  # judging workspace
â"‚  â"‚  â""â"€ api/v1/"¦         # route handlers (call module services)
â"‚  â"œâ"€ modules/
â"‚  â"‚  â"œâ"€ events/ registration/ teams/ rounds/ quiz/ challenges/
â"‚  â"‚  â"œâ"€ judging/ scoring/ leaderboard/ exports/ notifications/ admin-console/
â"‚  â"‚  â"‚  â""â"€ each: index.ts * domain/ * service/ * repo/ * schemas/ * ui/ * __tests__/
â"‚  â"œâ"€ round-types/         # plugin registry: quiz/, challenge/, judged/  (sec.10)
â"‚  â"œâ"€ core/               # db, tx, auth, rbac, errors, logger, rate-limit,
â"‚  â"‚                      #   idempotency, jobs, csv, clock, audit, config
â"‚  â"œâ"€ components/ui/      # design-system primitives (DESIGN.md)
â"‚  â""â"€ lib/                # pure helpers (formatting, ids)
â"œâ"€ db/
â"‚  â"œâ"€ migrations/         # reviewed SQL migrations (expand/contract)
â"‚  â"œâ"€ policies/           # RLS policies and grants as SQL
â"‚  â""â"€ seeds/              # deterministic dev/test seeds
â"œâ"€ tests/
â"‚  â"œâ"€ integration/ e2e/ security/ recovery/
â"‚  â""â"€ load/               # k6 scripts + scenario configs
â"œâ"€ scripts/               # backup, restore drill, reconcile, seed-load
â"œâ"€ .github/workflows/     # ci.yml, migrate.yml, backup.yml, loadtest.yml
â"œâ"€ .env.example
â""â"€ package.json
```

---

## 7. Data Model

### 7.1 Conventions

- **Primary keys:** `uuid` (v7 where available for index locality; otherwise `gen_random_uuid()`), except counters/sequences noted.
- **All timestamps** `timestamptz`, UTC. Authoritative time = `now()` evaluated by Postgres (BR-02).
- Every event-scoped table has `event_id uuid NOT NULL`. Parent tables expose `UNIQUE (event_id, id)` so children use composite foreign keys `(event_id, parent_id)`, making cross-event references impossible at the database level (BR-01).
- **Soft-delete** only where history matters (`deleted_at`); scoring/audit tables are append-only.
- **Enums** as Postgres enums or `text CHECK` (chosen at M1; changes need expand/contract migrations).
- **`jsonb`** only for organizer-configurable shapes (field values, round config, scoring config) validated by Zod at write time and versioned.

### 7.2 Core Entity Groups

**Identity & Access:** `users`, `roles`, `permissions`, `role_permissions`, `role_assignments`

**Events & Registration:** `events`, `registration_forms`, `registration_field_defs`, `participants`, `participant_unique_values`, `event_counters`, `teams`, `team_members`, `entries`

**Rounds:** `rounds`, `round_scoring_configs`, `round_pauses`, `entry_round_status`

**Quiz:** `question_banks`, `questions`, `question_versions`, `question_options`, `round_questions`, `quiz_attempts`, `attempt_questions`, `quiz_responses`

**Challenge:** `challenge_tasks`, `challenge_starts`, `submissions`, `submission_revisions`

**Judging:** `evaluation_rubrics`, `evaluation_criteria`, `judging_assignments`, `judge_evaluations`, `judge_evaluation_scores`, `evaluation_resolutions`

**Scoring & Results:** `score_records`, `result_runs`, `calculated_results`, `leaderboard_aggregates`, `leaderboard_snapshots`

**Operations:** `audit_logs`, `idempotency_keys`, `jobs`, `export_jobs`, `notifications`, `media_assets`

### 7.3 Key Table Constraints

**Identity and access:**

| Table | Key constraints |
|---|---|
| `users` | `UQ(auth_user_id)`, `UQ(email_normalized)` |
| `role_permissions` | `PK(role_key, permission_key)` |
| `role_assignments` | `UQ(user_id, role_key, scope_type, event_id, round_id)` where not revoked |

**Events, registration, teams:**

| Table | Key constraints |
|---|---|
| `events` | `UQ(slug)`, `CHECK` windows ordered |
| `registration_forms` | `UQ(event_id, version)`, partial UQ active per event |
| `registration_field_defs` | `UQ(form_id, key)` |
| `participants` | `UQ(event_id, user_id)`, `UQ(event_id, participant_code)`, `UQ(event_id, id)` |
| `participant_unique_values` | `UQ(event_id, field_key, normalized_value)` |
| `event_counters` | `PK(event_id, counter_key)`; incremented via `UPDATE "¦ RETURNING` |
| `teams` | `UQ(event_id, name_normalized)`, `UQ(invite_code)`, `UQ(event_id, id)` |
| `team_members` | Partial `UQ(event_id, participant_id)` where `left_at` is null |
| `entries` | `CHECK` exactly one of participant/team; `UQ(event_id, participant_id)`, `UQ(event_id, team_id)` |

**Rounds:**

| Table | Key constraints |
|---|---|
| `rounds` | `UQ(event_id, id)`, `UQ(event_id, position)` deferrable |
| `round_scoring_configs` | `UQ(round_id, version)`; update trigger forbids change once referenced |
| `entry_round_status` | `PK(round_id, entry_id)` |

**Quiz:**

| Table | Key constraints |
|---|---|
| `question_versions` | `UQ(question_id, version_no)`; trigger forbids update |
| `question_options` | `UQ(version_id, position)` |
| `round_questions` | `PK(round_id, question_id)` |
| `quiz_attempts` | `UQ(round_id, entry_id, participant_id, attempt_no)`, `UQ(idempotency_key)` |
| `attempt_questions` | `UQ(attempt_id, position)` |
| `quiz_responses` | `PK(attempt_question_id)`; upsert guarded by `client_seq` |

**Scoring & results:**

| Table | Key constraints |
|---|---|
| `score_records` | Update/delete forbidden by trigger; partial `UQ(round_id, entry_id)` per source where `superseded_by` is null |
| `result_runs` | `UQ(event_id, run_no)` |
| `calculated_results` | `PK(result_run_id, entry_id)` |
| `leaderboard_snapshots` | `PK(event_id, scope, version)` |
| `audit_logs` | UPDATE/DELETE blocked by trigger (BR-29) |

### 7.4 Concurrency Mechanisms

| Need | Mechanism |
|---|---|
| Race-free capacity and numbering | Registration: `SELECT "¦ FROM events WHERE id=$1 FOR UPDATE` (short) + `event_counters` increment in one transaction |
| Duplicate submissions | Natural unique constraints + idempotency keys |
| Concurrent answer saves | `INSERT "¦ ON CONFLICT DO UPDATE "¦ WHERE excluded.client_seq > stored.client_seq` |
| Exactly-once submit | `SELECT "¦ FOR UPDATE` on the attempt row; status transition guarded (`in_progress <-’ submitted`) |
| Efficient result calculation | Round scores single-row-per-source in `score_records` with partial index; a result run is one set-based SQL pass over â‰ˆ 500 entries |
| Large CSV exports | Keyset pagination by primary key, covering indexes, a read-only role with `statement_timeout`, chunked resumable jobs (sec.16) |
| Hot-path isolation | Leaderboard reads hit a single precomputed `leaderboard_snapshots` row, never aggregate tables |

### 7.5 Data Isolation Strategy

- **Structural:** `event_id` on every event-scoped table plus composite FKs (`(event_id, parent_id)`), so a child can never reference another event's parent.
- **Application:** every repository function takes an explicit `EventScope` argument; a unit test scans repositories for unscoped queries.
- **Authorization:** role assignments are scoped (global/event/round); judges see only assigned items (BR-19).
- **Database policy (defense in depth):** app tables live in a non-exposed schema; `anon`/`authenticated` roles have no grants; RLS is enabled with deny-by-default policies. The server connects with a least-privilege role (`app_rw`); exports use `app_ro`; migrations use a separate owner role. `[U]` exact Supabase role/schema configuration is validated in T-1.3.
- **Testing:** automated cross-event leakage tests (`SEC-ISO-*`) attempt to read/write event B data with event A credentials on every endpoint.

---

## 8. Authentication and Authorization

### 8.1 Authentication

**Provider:** Supabase Auth (email + password), behind an `AuthProvider` interface. Users are mirrored into `users` (app identity) on first sign-in.

**Sessions:** HTTP-only, Secure, SameSite=Lax cookies managed via the Supabase SSR helper. Access-token verification on each request should use local JWT verification against the project's signing keys `[U]`, falling back to `auth.getUser()` on hot paths only if necessary.

**Email verification:** per-event flag `require_email_verification` (FR-AUTH-02). Verification emails go through custom SMTP; per-hour Auth rate limits are raised deliberately `[S]`.

**MFA:** TOTP for `super_admin` and `event_admin` (Supabase Free includes basic MFA `[V]`) `[P]` D-P10.

**Brute-force protection:** IP+account rate limits (Upstash) and Supabase Auth's built-in limits; optional CAPTCHA `[P]`.

### 8.2 Permission Catalogue and Role Matrix

`â - ` allowed * `â - ‹` read-only * blank = denied. Participants act only on their own records.

| Permission | Super admin | Event admin | Round manager | Judge | Reviewer | Participant |
|---|---|---|---|---|---|---|
| `event:create` | â -  | | | | | |
| `event:update` / `event:lifecycle` | â -  | â -  | | | | |
| `event:assign_roles` | â -  | â -  | | | | |
| `registration:read` | â -  | â -  | â - ‹ | â - ‹ | | own |
| `registration:review` | â -  | â -  | | | | |
| `team:manage` (override) | â -  | â -  | | | | captain of own |
| `round:manage` | â -  | â -  | â -  (assigned) | | | |
| `round:control` | â -  | â -  | â -  (assigned) | | | |
| `quiz:author` / `challenge:author` / `rubric:manage` | â -  | â -  | â -  (assigned) | | | |
| `quiz:preview` | â -  | â -  | â -  | â - ‹ | | |
| `attempt:take` / `submission:create` | | | | | | â -  own, when eligible |
| `submission:read` | â -  | â -  | â -  | assigned | â - ‹ | own |
| `judging:assign` | â -  | â -  | â -  | | | |
| `judging:score` | | | | â -  assigned | | |
| `judging:reconcile` | â -  | â -  | â -  | | | |
| `scores:finalize` / `results:publish` | â -  | â -  | | | | |
| `scores:unlock` | â -  | â -  (with reason) | | | | |
| `leaderboard:configure` | â -  | â -  | | | | |
| `leaderboard:view` | â -  | â -  | â -  | â -  (if policy) | â -  | per policy |
| `export:create` | â -  | â -  | â - ‹ non-PII | â - ‹ non-PII | | own data only |
| `export:pii` | â -  | â -  | | | | |
| `audit:read` | â -  | â -  (own events) | â - ‹ | | | |
| `system:settings` | â -  | | | | | |

### 8.3 Enforcement

A single `authorize(actor, permission, scope)` function is the only allow/deny decision point. Every route is declared with `route({ permission, scope, rateLimit, idempotent })`; a registry test fails the build if a route lacks a policy (deny by default).

Resource-level checks (ABAC) follow permission checks: ownership, assignment, event scope, event status, round status, and time window. Sensitive operations write to `audit_logs` in the same transaction as the change.

---

## 9. Event, Registration and Round Lifecycles

### 9.1 Event Lifecycle

```
[*] â"€â"€â - ¶ draft â"€â"€â - ¶ published â"€â"€â - ¶ paused â"€â"€â - ¶ published
                    â"‚               â"‚
                    â"‚               â""â"€â"€â - ¶ completed â"€â"€â - ¶ archived â"€â"€â - ¶ [*]
                    â"‚                       â - ²
                    â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"˜
         draft â"€â"€â - ¶ archived
```

`published` exposes the event publicly. `registration_open` is derived: `status in (published) âˆ# window âˆ# capacity`, with an optional manual override. `completed` freezes participant writes; `archived` makes the event read-only (exports still permitted, FR-EVT-07).

### 9.2 Registration Workflow

1. Visitor opens event <-’ checks sign-in state
2. If not signed in <-’ sign up / sign in <-’ optional email verification
3. Opens registration form (active form version)
4. Client validation <-’ `POST /registrations` with `Idempotency-Key`
5. Rate limit check (429 if exceeded)
6. Begin transaction:
   - Check window open and event published (409 if not)
   - Check already registered (409 if so)
   - Check unique field collisions (422 if so)
   - Check capacity <-’ waitlist or reject if full
   - Increment `event_counters` (participant code)
   - Insert participant + unique values + entry
   - Set status: `pending` (manual approval) or `approved` (auto)
   - COMMIT + audit
7. Queue confirmation email
8. If team event <-’ create or join team
9. Dashboard

### 9.3 Round Lifecycle

```
[*] â"€â"€â - ¶ draft â"€â"€â - ¶ scheduled â"€â"€â - ¶ open â"€â"€â - ¶ paused â"€â"€â - ¶ open
                                 â"‚                    â"‚
                                 â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â - ¶ closed â"€â"€â - ¶ judging â"€â"€â - ¶ finalized â"€â"€â - ¶ published
                                                       â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â - ¶ finalized
                                                     finalized â"€â"€â - ¶ judging  (authorized unlock)
         draft/scheduled/open â"€â"€â - ¶ cancelled
```

`scheduled <-’ open` and `open <-’ closed` are time-derived (evaluated against the DB clock on each request and by the sweeper job) so a missed cron tick cannot leave a round open past `ends_at`.

### 9.4 Attempt Lifecycle (Quiz)

```
[*] â"€â"€â - ¶ not_started â"€â"€â - ¶ in_progress â"€â"€â - ¶ submitted â"€â"€â - ¶ [*]
                              â"‚
                              â"œâ"€â - ¶ auto_submitted â"€â"€â - ¶ [*]
                              â""â"€â - ¶ invalidated â"€â"€â - ¶ [*]
```

---

## 10. Round Engine

### 10.1 Design

Round count, type and order are data (BR-30). Behavior specific to a round type lives in a round-type plugin registered in `src/round-types/`. The core engine handles what is common: lifecycle, timing, eligibility, advancement, score record intake, audit, export column registration.

```typescript
// src/round-types/contract.ts (illustrative  -  not yet implemented)
export interface RoundType<TConfig = unknown> {
  readonly id: string;                    // 'quiz' | 'challenge' | 'judged' | future ids
  readonly configVersion: number;
  readonly configSchema: ZodType<TConfig>;
  migrateConfig?(fromVersion: number, raw: unknown): TConfig;
  validateForOpen(ctx: RoundContext): ValidationIssue[];
  participantView(ctx: RoundContext, entry: EntryRef): Promise<ParticipantRoundView>;
  handleAction(ctx: RoundContext, entry: EntryRef, action: string, input: unknown, tx: Tx): Promise<ActionResult>;
  onClose(ctx: RoundContext, tx: Tx): Promise<void>;
  produceRawScores(ctx: RoundContext, tx: Tx): AsyncIterable<RawScoreInput>;
  exportColumns(ctx: RoundContext): ExportColumnDef[];
  adminPanels: AdminPanelDef[];
}
```

Adding a new round type = one new folder implementing this interface + one registry line + migrations for any new tables + export/test fixtures. **No change** to the event, registration, scoring-run or leaderboard code.

### 10.2 Common Engine Responsibilities

| Responsibility | Rule |
|---|---|
| Timing | Opens/closes derived from DB clock and stored `starts_at`/`ends_at`; sweeper enforces transitions but correctness does not depend on it |
| Eligibility | `rounds.eligibility` JSON: `all`, `qualified_from:[round_ids]`, `top_n`, `top_percent`, `min_score`, `manual_list`; evaluated server-side on every participant action |
| Advancement | Computed at finalize from round scores: `top_n`, `top_percent`, `min_score`, `manual`, `all`; ties at the cutoff follow the round's `tie_policy`; result stored in `entry_round_status` |
| Pause/resume | Sets `paused_at`; resume inserts a `round_pauses` row and extends every in-progress attempt/challenge clock by the pause length exactly once (BR-14) inside one transaction |
| Reordering | Allowed freely in `draft`; after participant activity only via a guarded flow that revalidates eligibility dependencies |
| Config immutability | Once a round has attempts/submissions/scores, structural config changes are blocked or require a new scoring config version and audited "rescore" (sec.14.7) |

### 10.3 Judged Round Type

`judged` rounds have no participant upload; judges score entries live or from provided evidence. Participants see instructions and status only. Scoring uses the rubric engine (sec.13) and produces `judge_aggregate` score records.

---

## 11. Quiz Engine

### 11.1 Authoring and Validation

**Question types:** `single`, `multi`, `truefalse` (a single with two fixed options), `text` (optional), with optional image in stem/options.

**Validation on save:** â‰¥ 2 options for choice types; â‰¥ 1 correct (exactly 1 for `single`/`truefalse`); `marks > 0`; `negative_marks â‰¥ 0`; for `text`, â‰¥ 1 accepted answer.

Editing a question that any attempt has used creates a new `question_versions` row (BR-06). Attempts already started keep their `attempt_questions.question_version_id`. **Correct-answer flags are never sent to the browser before results are released.**

### 11.2 Selection and Randomization

Round quiz composition: fixed list (`round_questions.position`) and/or pools (`pool_key` + count, sampled by tag/difficulty). At attempt start the server generates a seed (stored) and produces `attempt_questions` rows using a deterministic PRNG (seeded Fisher""Yates). Order is stable across refreshes and reproducible in audits.

### 11.3 Attempt Start (Server)

Inside one transaction:

1. **Authorize:** the actor's participant owns the entry; entry active; round open; eligibility satisfied; event not paused/archived.
2. **Serialize** per entry: `pg_advisory_xact_lock(hash(round_id, entry_id, participant_id))`.
3. Enforce `max_attempts`; if an `in_progress` attempt exists, return it (idempotent resume) with remaining time.
4. `started_at = now()`, `deadline_at = LEAST(started_at + duration, rounds.ends_at)` (BR-04); persist.
5. Generate frozen questions; commit; respond with questions (without answers), `deadline_at`, `server_time`.

If the round window has no time left (`deadline_at <= now()`), the start is refused.

### 11.4 Scoring Rules

All marks stored as `numeric`, never floating point `[P]`.

| Type | Rule |
|---|---|
| `single`, `truefalse` | correct <-’ `+m`; wrong <-’ `âˆ’n`; blank <-’ `0` |
| `multi  -  all_or_nothing` | exact set match <-’ `+m`; blank <-’ `0`; otherwise <-’ `âˆ’n` |
| `multi  -  proportional` | `raw = m Ã -  (sc âˆ’ Î»*sw) / C`, clamped to `[âˆ’n, m]` |
| `text` | NFKC normalize + case-fold; match against accepted list <-’ `+m`; no match <-’ `needs_manual_review` |

Quiz total = Î£ question scores; optionally floored at 0 (`floor_total_at_zero`, default `false [P]`, BR-12). Scoring is a pure function `scoreAttempt(frozenQuestions, responses, config)` used by submit, rescore and tests.

### 11.5 Save and Submit Protocol

**Save answers  -  `PUT /api/v1/attempts/{id}/answers`**
Body: `{ answers: [{ attemptQuestionId, answer, clientSeq }], clientSentAt }` (batched, debounced â‰ˆ 3""5 s).
Upsert guarded: `in_progress AND now() <= deadline_at + save_grace AND clientSeq > stored`. Returns `{ savedSeq, serverTime, deadlineAt, status }`.

**Submit  -  `POST /api/v1/attempts/{id}/submit` with `Idempotency-Key`**
`SELECT "¦ FOR UPDATE` the attempt; if already submitted, return the stored result (idempotent). Accept final answers in the request only if before the deadline; compute score server-side; write `quiz_attempts.score` and `score_records(source=quiz_auto)`; set `status`, `submitted_at`, `submit_source=manual`; commit; respond with confirmation.

**Auto-submit  - ** when `deadline_at` passes with attempt `in_progress`: finalized lazily by any read/write touching the attempt, and proactively by the sweeper (`FOR UPDATE SKIP LOCKED`, batch 200) and by "close round" (BR-24). Saved answers are scored; `submit_source=auto`. Correctness does not depend on the sweeper's schedule.

### 11.6 Timer Behavior

The server returns `deadline_at` and `server_time` on every quiz response. The client computes an offset once and renders `deadline_at âˆ’ (Date.now() + offset)`. The countdown is purely presentational (BR-03). On reaching zero the client calls submit; whatever the server decides is final.

### 11.7 Refresh and Network Interruptions

`GET /api/v1/attempts/{id}` returns questions, saved answers, `deadline_at`, `server_time`, `status`  -  so a refresh, a new tab, or a crashed browser resumes correctly. The client keeps an ordered outbound queue (memory + IndexedDB), retries with exponential backoff and jitter, shows `Saved / Saving / Offline "" retrying`, and flushes on `online`/`visibilitychange`.

---

## 12. Development Challenge Submissions

### 12.1 Flow

- **Fixed window** (`clock_mode=fixed_window`): all entries share `rounds.starts_at`/`ends_at`.
- **Per-entry clock** (`per_entry_clock`): entry presses Start challenge; `challenge_starts.deadline_at = LEAST(now() + time_limit, rounds.ends_at)` stored once (idempotent).
- **Draft** (`PUT "¦/draft`): stores `submission_revisions` with `is_draft=true`; never counted.
- **Submit** (`POST "¦/submit`, `Idempotency-Key`): validate <-’ check deadline via DB clock <-’ insert `submission_revisions(revision_no = max+1)` in a transaction that locks the `submissions` row; update `counted_revision_id`.

### 12.2 URL Validation (No Server-Side Fetching in MVP)

| Check | Rule |
|---|---|
| Parse | WHATWG URL; normalize host to lower case; drop fragment |
| Scheme | `https` (and `http` only if the event allows)  -  never `javascript:`, `data:`, `file:` |
| Length | â‰¤ 2,048 characters |
| Userinfo | Reject `user:pass@` |
| Host | Must be a registrable domain; reject IP literals, `localhost`, `*.local`, `*.internal`, and private/link-local ranges |
| GitHub field | `https://github.com/<owner>/<repo>` with valid owner/repo characters |
| Video field | Optional host allow-list (e.g., YouTube, Loom, Google Drive) per event |
| Duplicates | Same normalized `repo_url` across entries <-’ flag for organizer review (collusion signal), not a hard error |
| Display | Rendered with `rel="noopener noreferrer nofollow ugc"` and `target="_blank"` |

### 12.3 Status Derivation

`not_started <-’ draft <-’ submitted (on time) / submitted_late <-’ under_review (assigned) <-’ evaluated (final scores locked)`

Withdrawn/disqualified entries show their entry status instead.

---

## 13. Manual Judging

### 13.1 Rubric and Evaluation Model

- **Rubric per round:** criteria with `max_marks`, optional `weight`, `description`; `aggregation` method; `variance_threshold`; `min_judges`; `blind`.
- **Judge total:** without weights `total = (Î£ marks / Î£ max) Ã -  round_max`; with weights `total = (Î£ (marks_c / max_c) Ã -  w_c / Î£ w_c) Ã -  round_max`.
- **Aggregate across judges:** `mean`, `median`, `trimmed_mean`, `max`, `min`, or `weighted_judges`.
- **Disagreement:** `spread = (max_total âˆ’ min_total) / round_max Ã -  100`. If `spread > variance_threshold_pct` the item becomes `needs_reconciliation`.
- **Resolution:** (a) request re-score, or (b) record a resolution with `method` (`adopt_mean`, `adopt_median`, `manual_value`) and mandatory `reason` in `evaluation_resolutions`.
- **Blind mode:** judges see a pseudonymous item code and no team/participant names.

### 13.2 Workflow

```
Round closed
  <-’ Assign submissions to judges (manual, bulk, or balanced)
  <-’ Judge opens assigned item
  <-’ Score criteria + comment + optional evidence link (draft)
  <-’ Submit evaluation
  <-’ [All required judges submitted?]
       No <-’ Judge opens assigned item (continue)
       Yes <-’ Aggregate per rubric
            <-’ [Spread above threshold?]
                 Yes <-’ Flag needs_reconciliation
                      <-’ [Resolution]
                           <-’ Request re-score <-’ Judge opens assigned item
                           <-’ Admin resolution + reason <-’ Record resolution <-’ Aggregate score accepted
                 No <-’ Aggregate score accepted
  <-’ Finalize: write score_record judge_aggregate
  <-’ Lock evaluations + audit
  <-’ [Correction needed?]
       Yes <-’ Authorized unlock with reason <-’ new revision <-’ Judge opens assigned item
       No <-’ Ready for results run
```

### 13.3 Audit and Locking

Every evaluation save creates a revision row; every state change (submit, resolve, finalize, unlock) writes an `audit_logs` entry with actor, timestamp, before/after, and reason (FR-JDG-07). Locked evaluations are immutable (BR-08); unlocking creates a new revision and a superseding score record  -  history is never rewritten.

---

## 14. Scoring and Results

### 14.1 Principles

- Raw scores (`score_records`) are append-only facts with their scoring-config version.
- Results (`result_runs` + `calculated_results`) are derived, versioned and reproducible.
- No update ever silently changes a published result: corrections create new score records and a new run; the old run remains addressable (BR-09, BR-11).

### 14.2 Configuration

**Round scoring config** (`round_scoring_configs`, immutable versions): quiz options (marks scale, negative marking, partial-credit mode, floor), late penalties, rubric reference, normalization.

**Event result config** (`events.result_config`, versioned, always copied into `result_runs.config_snapshot`):

```json
{
  "mode": "weighted",
  "scale": 100,
  "rounds": [
    { "round_id": "...", "weight": 0.3, "include": true },
    { "round_id": "...", "weight": 0.7, "include": true }
  ],
  "missing_round_policy": "zero",
  "penalties": { "cap": 20 },
  "tie_break": ["round_score:<round_id>", "total_time_asc", "last_submit_asc"],
  "rank_scope": "active_only"
}
```

### 14.3 Calculation (Pure Function)

`computeResults(inputs, config) <-’ rows` is a deterministic function (no clock, no randomness, no I/O). For each entry and included round:

```
base       = single non-superseded primary record
adjustments = Î£ admin_adjust (non-superseded)
penalties   = Î£ penalty (non-superseded, positive numbers)
round_final = base + adjustments âˆ’ penalties
contribution (weighted) = weight Ã -  (round_final / round_max) Ã -  scale
contribution (sum)      = round_final
final_score = Î£ contributions âˆ’ event_level_penalties
```

Fixed-point arithmetic; results rounded once at the end (round half up to 4 decimals `[P]`).

### 14.4 Special Statuses

| Situation | Ranking | Display / export |
|---|---|---|
| Incomplete <-’ auto-submitted from saved answers, `submit_source=auto` (BR-24) | Ranked normally | Flag `auto_submitted` |
| Unscored round: no primary record | Per `missing_round_policy`: `zero`, `exclude`, `rank_last` | `unscored` distinct from `0` |
| Withdrawn (BR-20) | `rank = null` | `withdrawn` |
| Disqualified (BR-21) | `rank = null` | `disqualified` + reason |
| Provisional run | Ranked | Labelled Provisional |
| Final run | Ranked | Labelled Final; run number shown |

### 14.5 Ranking and Ties

Sort by `final_score` descending, then each element of the `tie_break` chain in order. Entries with identical complete keys share a rank; the next rank skips (1, 2, 2, 4  -  BR-25). `tie_status`: `none`; `tied_resolved`; `tied_unresolved`. Unresolved ties at an advancement cutoff follow the round's `tie_policy`.

### 14.6 Reproducibility

`result_runs` stores `config_snapshot` and `inputs_hash = SHA-256(canonical JSON of config + score-record ids/values valid as of the run + entry statuses + tie-break inputs)`. Recomputing a past run from stored data must reproduce byte-identical `calculated_results` (tested with golden fixtures, T-9.6).

### 14.7 Corrections and Rule Changes

| Change | Handling |
|---|---|
| Correct a judge evaluation | Unlock <-’ new evaluation revision <-’ new `judge_aggregate` record supersedes old <-’ new provisional run |
| Manual adjustment/penalty | New `admin_adjust`/`penalty` record with reason and audit |
| Question found wrong after the quiz | Admin creates corrected question version + rescore action: dry-run diff first; on confirm, new `quiz_auto` records supersede old ones; never edits responses |
| Scoring rule change | New immutable config version; existing records keep their version; explicit rescore required |
| Publishing a correction | New final run supersedes earlier final run; participants see "corrected on "¦"; exports include `result_run_no` and `result_status` |

---

## 15. Leaderboard

### 15.1 Visibility Policy

`events.leaderboard_policy`  -  evaluated on the server on every read:

| Mode | Who can read |
|---|---|
| `hidden_until_end` | Staff only until event `completed`, then per `post_event_audience` |
| `during_rounds` | Audience allowed only while rounds listed in `visible_round_ids` are open/closed/published |
| `staff_only` | Super admin, event admin, round manager, judges (if allowed), reviewers |
| `participants_only` | Authenticated participants of the event + staff |
| `public` | Anyone |

Optional flags: `show_own_rank_when_hidden`, `freeze_from` (timestamp), `display_fields` (name, team, public code  -  **never** email/phone), `top_n`.

### 15.2 Update Strategy

Live board = derived snapshot, not per-submission broadcast. A snapshot is stale when `now() âˆ’ generated_at â‰¥ min_rebuild_interval` (default 5 s `[T]`) and `max(score_records.id)` for the event exceeds the snapshot's watermark.

**Single-flight rebuild:** the first request/tick that finds the snapshot stale acquires `pg_try_advisory_xact_lock(hash('lb', event_id, scope))`, recomputes with `computeResults` over â‰ˆ 500 entries, inserts `version = prev + 1`, commits. Everyone else keeps serving the previous snapshot (stale-while-revalidate).

**Payload:** top-N (default 100) rows â‰ˆ 8 KB raw / â‰ˆ 3 KB gzip `[E]`, plus `version`, `generated_at`, `provisional`, `etag`. Own rank is a separate small authenticated call (`/leaderboard/me`, single indexed lookup).

### 15.3 Delivery

| Path | Details |
|---|---|
| Baseline (MVP): polling | `GET /api/v1/events/{id}/leaderboard?scope="¦` with `If-None-Match: "<scope>-<version>"` <-’ `304` when unchanged. Client interval 15 s (min 5 s) with Â±20% jitter, paused when tab is hidden, backs off to 30 s after repeated `304`s `[T]` |
| Caching | Public boards: `Cache-Control: public, s-maxage=5, stale-while-revalidate=10 [T]`. Restricted boards: `private, no-cache` |
| Optional: realtime ping | Supabase Realtime Broadcast on a private channel `event:{id}:leaderboard` carrying only `{ v: <version> }`; clients then fetch the snapshot. Ping rate â‰¤ 1 per 10 s per event <-’ â‰ˆ 50 msg/s for 500 subscribers, inside Free 100 msg/s cap. MVP uses it for staff dashboards only |
| Failure fallback | On `too_many_connections`, errors or disconnect, the client silently reverts to polling |

### 15.4 Reconnection and Consistency

State is version-based, not event-based: after any interruption (offline, sleep, tab restore) the client refetches the latest authorized snapshot; there is nothing to replay. The UI shows `last updated` and a stale banner if data is older than 2Ã -  the poll interval.

### 15.5 Protection

Authorization precedes data access on every read (403 reveals nothing beyond "not available"); snapshot rows never contain PII columns; private realtime channels authorized by the same policy function; frozen/hidden states enforced server-side.

---

## 16. CSV Export

### 16.1 Export Types

| Type | Source | Notes |
|---|---|---|
| `registrations` | `participants`, form field defs, teams | PII fields require `export:pii` (BR-27) |
| `quiz_responses` | `quiz_responses â¨ attempt_questions â¨ question_versions` | One row per answered question; attempt_id, entry IDs, question version, given answer, correct flag, awarded marks |
| `challenge_submissions` | `submission_revisions` | All revisions with counted flag, URLs, timestamps, late flag |
| `evaluations` | `judge_evaluations + scores` | One row per judge Ã -  criterion; aggregate & resolution columns |
| `round_results` | `score_records`/`calculated_results` for one round | Round score, max, penalties, status, advancement |
| `event_results` | `calculated_results` of a specific run | Wide (default) or long format |

**Final results columns** (FR-EXP-02): `event_id`, `event_slug`, `event_title`, `result_run_no`, `result_status`, `entry_code`, `entry_kind`, `participant_codes`, `team_name`, `display_name`; per round: `round_<n>_title`, `round_<n>_score`, `round_<n>_max`, `round_<n>_status`; then `raw_total`, `weighted_total`, `penalties`, `final_score`, `final_rank`, `tie_status`, `advancement_status`, `submission_links`, `entry_status`, `status_reason`.

### 16.2 CSV Format Rules

| Aspect | Rule |
|---|---|
| Standard | RFC 4180: comma separator, CRLF line endings, fields with comma/quote/CR/LF quoted, quotes doubled |
| Encoding | UTF-8; optional BOM (default on, for spreadsheet compatibility `[P]`) |
| Types | Numbers typed as numbers (`.` decimal, no thousands separators); booleans `true`/`false`; timestamps ISO-8601 UTC |
| Identifiers | Same `entry_code`, `participant_code`, team IDs in every export |
| Formula-injection protection (BR-28) | For every string-typed cell whose first character is `=`, `+`, `-`, `@`, TAB or CR, prepend a single quote `'` before quoting. Numeric columns are never string-sanitized. The sanitizer is one shared function with a fixed payload corpus test |
| Schema stability | `schema_version` in the manifest; header order fixed per type/version |
| Manifest | Sidecar JSON: filters, fields, requester, `exported_at`, row count, SHA-256, `result_run_no` |

### 16.3 Execution Model

```
Admin UI
  â"€â"€â - ¶ POST /events/{id}/exports {type, filters, fields}
      Authorize (export:create, export:pii if PII), rate limit, per-event concurrency
      INSERT export_job (queued), audit
      â - €â"€â"€ 202 {jobId}

Tick / job runner (each invocation bounded):
  â"€â"€â - ¶ Claim job (SKIP LOCKED), read cursor
  â"€â"€â - ¶ Keyset chunk WHERE id > cursor ORDER BY id LIMIT N (statement_timeout)
  â"€â"€â - ¶ Serialize CSV rows (sanitizer)
  â"€â"€â - ¶ Write part-000n.csv to Storage
  â"€â"€â - ¶ Advance cursor, rows_written, heartbeat
  â"€â"€â - ¶ Pace between chunks while a round is live

  â"€â"€â - ¶ status=succeeded, checksum, expires_at

Admin UI
  â"€â"€â - ¶ GET /exports/{id} (poll status)
  â"€â"€â - ¶ GET /exports/{id}/download <-’ authorize + audit <-’ stream parts in order
```

**Controls:**
- **Fast path:** exports under â‰ˆ 5,000 rows `[T]` stream directly in one request
- **Concurrency:** â‰¤ 2 running per event, 1 per user, global cap 3 `[T]`
- **Chunking:** 1,000 rows/chunk (250 for wide formats)
- **Pacing:** configurable delay between chunks while any round is open (default 150 ms `[T]`)
- **Isolation:** read-only DB role with `statement_timeout` (5 s) and `lock_timeout` (1 s)
- **Resumability:** cursor and part list persist; a restart continues from the last completed chunk
- **Retention:** parts and files expire (default 24 h `[P]`) and are cleaned by a job

---

## 17. API Design

### 17.1 Conventions

- REST-style JSON under `/api/v1`; all inputs validated with Zod; unknown fields rejected.
- **Errors:** `{ "error": { "code": "attempt_closed", "message": "...", "details": {...}, "requestId": "..." } }` with correct HTTP status. No stack traces or SQL in responses.
- **Idempotency:** header `Idempotency-Key` (client UUID) required on start/submit/registration/export-create.
- **Pagination:** cursor (`?cursor=...&limit=...`, max 100); stable sort keys.
- **Time:** every timing-sensitive response includes `serverTime`.

**Rate limits** (Upstash), all `[T]`:

| Class | Limit |
|---|---|
| Auth sign-in | 10/min/IP and 5/min/account |
| Registration submit | 5/min/user, 30/min/IP |
| Attempt start | 5/min/user |
| Answer save | burst 10, sustained 30/min/attempt |
| Quiz/challenge submit | 10/min/entry |
| Export create / download | 3/hour/user and 10/hour/user |
| Admin mutations | 60/min/user |

### 17.2 Endpoint Catalogue (Proposed)

**Auth/Session**

| Method & path | Auth | Notes |
|---|---|---|
| `POST /auth/sign-up`, `/auth/sign-in`, `/auth/sign-out`, `/auth/reset` | public/session | Supabase Auth adapter |
| `GET /me` | user | profile + role assignments |

**Events and Public**

| Method & path | Permission | Notes |
|---|---|---|
| `GET /events`, `GET /events/{slug}` | public | published only |
| `POST /events` | `event:create` | |
| `PATCH /events/{id}` | `event:update` | |
| `POST /events/{id}/publish` `/pause` `/resume` `/complete` `/archive` | `event:lifecycle` | audited transitions |
| `PUT /events/{id}/registration-form` | `event:update` | new form version |
| `PUT /events/{id}/roles` | `event:assign_roles` | |

**Registration and Teams**

| Method & path | Permission | Notes |
|---|---|---|
| `POST /events/{id}/registrations` | participant | idempotent; capacity-safe |
| `GET/PATCH /events/{id}/registrations/me` | owner | until lock |
| `GET /events/{id}/registrations` | `registration:read` | search/filter/paginate |
| `POST /events/{id}/registrations/{pid}/review` | `registration:review` | approve/reject/waitlist |
| `POST /events/{id}/teams`, `POST /teams/{id}/join`, `POST /teams/{id}/leave`, `PATCH /teams/{id}` | participant/captain | invite-code join |

**Rounds**

| Method & path | Permission | Notes |
|---|---|---|
| `POST/PATCH/DELETE /events/{id}/rounds/...`, `POST /events/{id}/rounds/reorder` | `round:manage` | |
| `POST /rounds/{id}/open` `/close` `/pause` `/resume` `/extend` | `round:control` | audited; extend needs reason |
| `PUT /rounds/{id}/scoring-config` | `round:manage` | creates new immutable version |
| `GET /events/{id}/me/rounds` | participant | eligibility-aware list |

**Quiz**

| Method & path | Permission | Notes |
|---|---|---|
| `POST/PATCH /events/{id}/question-banks/...`, `/questions/...` | `quiz:author` | versioning |
| `POST /rounds/{id}/quiz/preview` | `quiz:preview` | no persistence |
| `POST /rounds/{id}/attempts` | participant | start/resume; idempotent |
| `GET /attempts/{id}` | owner | resume state |
| `PUT /attempts/{id}/answers` | owner | batched save |
| `POST /attempts/{id}/submit` | owner | idempotent |
| `POST /attempts/{id}/invalidate` | `round:control` | admin |

**Challenge**

| Method & path | Permission | Notes |
|---|---|---|
| `PUT /rounds/{id}/challenge` | `challenge:author` | task definition |
| `POST /rounds/{id}/challenge/start` | participant | per-entry clock |
| `PUT /rounds/{id}/submission/draft` | owner | not counted |
| `POST /rounds/{id}/submission` | owner | idempotent revision |
| `GET /rounds/{id}/submission` | owner | status + revisions |
| `GET /rounds/{id}/submissions` | `submission:read` | staff list |

**Judging**

| Method & path | Permission | Notes |
|---|---|---|
| `PUT /rounds/{id}/rubric` | `rubric:manage` | |
| `POST /rounds/{id}/assignments` | `judging:assign` | COI checks |
| `GET /judge/assignments` | `judging:score` | own only |
| `PUT /assignments/{id}/evaluation` | `judging:score` | draft/submit |
| `POST /rounds/{id}/reconcile` | `judging:reconcile` | reason required |
| `POST /rounds/{id}/finalize`, `POST /rounds/{id}/unlock` | `scores:finalize`, `scores:unlock` | audited |

**Results and Leaderboard**

| Method & path | Permission | Notes |
|---|---|---|
| `POST /events/{id}/results/runs` | `results:publish` | dry-run or provisional |
| `POST /events/{id}/results/runs/{n}/publish` | `results:publish` | final |
| `GET /events/{id}/results` | per policy | latest published |
| `GET /events/{id}/leaderboard`, `GET /events/{id}/leaderboard/me` | per policy | ETag |
| `PUT /events/{id}/leaderboard-policy` | `leaderboard:configure` | |

**Exports, Admin, Audit**

| Method & path | Permission | Notes |
|---|---|---|
| `POST /events/{id}/exports`, `GET /exports/{id}`, `GET /exports/{id}/download` | `export:create` | audited |
| `GET /events/{id}/dashboard` | staff | counts, active rounds, pending evaluations |
| `GET /events/{id}/audit` | `audit:read` | filter/search |
| `GET /rounds/{id}/monitor` | `round:control` | live attempt counts |

**Internal (Not User-Callable)**

| Method & path | Auth | Notes |
|---|---|---|
| `POST /internal/jobs/tick` | `CRON_SECRET` bearer + allow-list | sweeper, email queue, export chunks, cleanup |

---

## 18. Scalability Analysis

> Everything in this section is an estimate `[E]` or target `[T]`. No load test has been run.

### 18.1 Workload Model (Assumptions)

| Parameter | Assumption |
|---|---|
| Active participants N | 500 individuals; headroom test to 750""1,000 |
| Quiz | 30 questions, 30-minute attempt window, â‰ˆ 90% of participants start within 60 s of opening |
| Answer behavior | â‰ˆ 1 answer/minute; debounced autosave every â‰ˆ 3""5 s <-’ â‰ˆ 35 saves per participant per quiz |
| Deadline behavior | Up to 500 submits within 3 s (worst case) |
| Leaderboard | All 500 viewing for 3 hours, polling every 15 s <-’ 4 requests/min/viewer |
| Challenge | 500 entries submit within the last 60 s of a shared deadline; â‰ˆ 10% retry |
| Admin | 10 staff; monitor pages polling every 5""10 s |

**Derived volumes for one event day** `[E]`: quiz â‰ˆ 20,000 API calls; challenge â‰ˆ 5,000; leaderboard â‰ˆ 360,000; pages/assets/admin â‰ˆ 25,000 <-’ **â‰ˆ 410,000 function invocations** and â‰ˆ 15,000""45,000 answer row-writes.

### 18.2 Peak Scenarios

| # | Scenario | Rate | Where it hurts | Design response |
|---|---|---|---|---|
| S1 | 500 simultaneous active users | â‰ˆ 30""60 rps steady | Auth/session verification cost; cold starts | Local JWT verification; pre-warm before rounds; thin route handlers |
| S2 | 500 quiz starts in 30 s | â‰ˆ 100 rps burst | Per-entry advisory locks; question generation; payload size â‰ˆ 60 KB | Short transaction; gzip; images from CDN |
| S3 | 500 submits in 3 s | â‰ˆ 167 rps peak | DB CPU on shared compute; pooler client cap | Autosave makes submit a small delta; scoring is O(30 rows); 0""3 s jitter + idempotency |
| S4 | 500 leaderboard viewers | â‰ˆ 33 rps Ã -  2 tiny queries | Auth per request; egress â‰ˆ 100 KB/s â‰ˆ 1.1 GB per 3 h | ETag/304; snapshot row; public boards CDN-cached |
| S5 | Challenge deadline surge (500 in 60 s) | â‰ˆ 50 rps burst | Duplicate/retry storms | Idempotency keys; no outbound fetches |
| S6 | Registration opening (500 in 60 s, capacity 400) | â‰ˆ 8 rps | Serialization on event row | Lock held â‰ˆ 10 ms; â‰ˆ 100/s theoretical |
| S7 | Export during a live round | 1""2 background streams | Read load and lock contention | Read-only role; keyset chunks; pacing; concurrency caps |

### 18.3 Bottleneck Analysis

| Layer | Likely bottleneck | Evidence/limit | Mitigation |
|---|---|---|---|
| Frontend | Large JS bundle on mobile; image weight |  -  | Route-level splitting; budget â‰¤ 170 KB gz JS on quiz route `[T]` |
| Backend (functions) | Burst concurrency 1,000/10 s/region `[V]`; cold starts | 500 concurrent < 1,000 burst | Keep handlers small; pre-warm; paid plan for events |
| Database CPU | Shared vCPU compute on Micro/Small `[V]` | â‰ˆ 167 rps Ã -  â‰ˆ 7 ms CPU â‰ˆ 1.2 cores `[E]` | Small/Medium compute for events; efficient SQL |
| DB connections | Pooler clients: Micro 200, Small 400, Medium 600 `[V]` | 167 rps Ã -  0.3 s â‰ˆ 50 | Small/Medium; `DB_POOL_MAX=1""2` per instance |
| Locks | Registration (event row); attempt start advisory lock; leaderboard rebuild | Per-entry, not global | Keys are per entry/event/scope |
| Auth | Supabase Auth rate limits; email caps | 100""300 emails/day `[V]` | Optional/staged verification |
| Real-time | Free: 200 conns `[V]`; Pro: 500 | 500 viewers > 200 | Polling baseline |

### 18.4 Connection Math `[E]`

At the S3 peak of 167 rps with 0.3 s latency â‰ˆ 50 concurrent requests <-’ â‰ˆ 50""100 pooler client connections. Micro (200 pooler clients `[V]`) is adequate only if latency stays low; if latency degrades to 1 s, concurrency reaches â‰ˆ 167 and Micro is at 83% of its cap.

**Recommendation:** run events on **Small (400)** at minimum and test **Medium (600)**.

### 18.5 Measurable Performance Targets `[T]`

| Metric | Target | Scenario |
|---|---|---|
| Public page load (LCP, p75, mid-range mobile, 4G) | â‰¤ 2.5 s | Lighthouse/WebPageTest |
| Participant dashboard first meaningful content | â‰¤ 2.0 s p75 | LT-1 |
| Answer-save acknowledgement | p95 â‰¤ 500 ms; p99 â‰¤ 1.5 s | LT-3 (500 VUs) |
| Attempt start | p95 â‰¤ 1.2 s | LT-2 |
| Quiz submit acknowledgement | p95 â‰¤ 1 s; p99 â‰¤ 2.5 s | LT-4 |
| Challenge submit acknowledgement | p95 â‰¤ 1 s; p99 â‰¤ 2.5 s | LT-6 |
| Leaderboard read | p95 â‰¤ 300 ms (304 or 200) | LT-5 |
| Leaderboard freshness after score commit | â‰¤ 15 s p95 | LT-5 + probe |
| Admin dashboard/list pages | p95 â‰¤ 1.5 s | LT-7 |
| CSV export (10,000 rows) | complete â‰¤ 60 s under LT-7 traffic | LT-7 |
| 5xx rate (excl. intentional 429) | < 0.5% | all |
| Lost acknowledged writes | 0 | reconciliation after each test |
| DB CPU p95 during peak | < 80% | all |
| Pooler clients at peak | < 70% of plan cap | all |

### 18.6 Can the Design Carry 500? Honest Status

On paper, the write path (small transactions, single-row locks, snapshot reads) is well within what a small Postgres instance handles; the largest open risks are shared-CPU headroom, pooler client caps under latency spikes, and serverless cold starts.

- **Free-tier-only:** not verifiable as adequate (sec.4.4).
- **Headroom:** tests at 750 and 1,000 concurrent identify the "knee"; the platform is not declared ready for 500 unless it passes 500 with â‰¥ 50% headroom or the owner accepts a lower verified ceiling.

---

## 19. Security

### 19.1 Threat Model (Summary)

| Threat | Example | Primary controls |
|---|---|---|
| Unauthorized access | Participant reads another event's data | Server-side authz; scoped roles; composite FKs; RLS; isolation tests |
| Timer/score tampering | Editing client timer or posting a score | BR-02/03/05; server computes; client values ignored |
| Answer replay/duplication | Double submit, retry storms | Idempotency keys, unique constraints, `clientSeq` |
| Injection | SQL, XSS, CSV formula injection | Parameterized queries; React escaping + HTML sanitization; CSV sanitizer (BR-28) |
| SSRF / malicious links | Submitting internal URLs | No server-side fetch in MVP; URL validation; safe link rendering |
| Abuse/DoS | Registration spam, answer flooding | Rate limits, CAPTCHA option, concurrency caps, spend caps |
| Credential attacks | Brute force, credential stuffing | Rate limits, lockout, MFA for admins |
| Data leakage | PII in exports/logs/leaderboards | Field-level PII flags; `export:pii`; log redaction; snapshot column allow-list |
| Insider misuse | Admin edits scores silently | Append-only records, audit log, reasons, two-step unlock |
| Supply chain | Malicious dependency | Lockfile; dependency review; minimal deps; CI audit |

### 19.2 Controls

| Area | Requirement |
|---|---|
| Authentication | Supabase Auth; HTTP-only Secure SameSite=Lax cookies; MFA for admin roles `[P]`; password policy aligned with NIST SP 800-63B; reset links single-use and short-lived |
| Authorization | Central `authorize()`; route registry test enforces deny-by-default; resource checks (owner/assignment/scope/status/time) after permission check |
| Input validation | Zod at every boundary; size limits; reject unknown fields; server-side even when client validates |
| Output encoding | React default escaping; user Markdown rendered with an allow-list sanitizer; no `dangerouslySetInnerHTML` without sanitized input; CSV via sanitizer |
| Rate limiting & abuse | Classes in sec.17.1; fail-open for participant hot paths with in-memory fallback limiter; fail-closed for auth and export |
| Sessions | Rotation on privilege change; revoke on password change/role removal; idle and absolute timeouts configured `[U]` |
| Secrets | Only in Vercel/GitHub/Supabase secret stores; never `NEXT_PUBLIC_*` for secrets; service-role key server-only; `.env.example` has names only; secret scanning in CI; rotation runbook |
| CORS | No cross-origin API access: same-origin only; never `Access-Control-Allow-Origin: *` on credentialed routes |
| CSRF | SameSite=Lax cookies + verify `Origin`/`Sec-Fetch-Site` on state-changing requests + JSON content-type requirement; no state change on GET |
| Headers | CSP with nonces; HSTS; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; minimal `Permissions-Policy` |
| External links | `rel="noopener noreferrer nofollow ugc"`; only `http(s)`; show hostname; never auto-fetch |
| Uploads | Images only; mime sniffing + extension allow-list; size cap; re-encode where feasible; separate bucket; no execution |
| Audit logging | Append-only, same-transaction writes for sensitive actions; includes actor/role/target/before-after/reason/IP hash/request ID; readable only via `audit:read` |
| Privacy | Collect only needed fields; PII flags on fields; PII excluded from leaderboards/logs; retention/deletion policy `[P]` D-P09 |
| Logging hygiene | No passwords, tokens, or full emails in logs; hashed user IDs; request IDs |
| Dependency hygiene | Lockfile committed; scheduled dependency audit; pinned major versions |

---

## 20. Reliability and Failure Handling

> No availability figure is claimed. Behavior below is design intent to be proven by the recovery tests (`REC-*`) in sec.24.

| Failure | Detection | System behavior | Participant experience | Recovery | Test |
|---|---|---|---|---|---|
| Temporary DB outage | Query errors/timeouts | Writes return 503 Retry-After; nothing acknowledged unless committed | Answers queued locally; banner "Reconnecting  -  your answers are kept on this device" | Client retries with backoff; admin applies audited extension (BR-15) for affected entries | REC-01 |
| Participant network interruption | Failed fetch / offline event | Server unaffected | Save-state indicator; queue in memory + IndexedDB | Flush in order on reconnect; `clientSeq` prevents regression | REC-02 |
| Duplicate/repeated requests | Same `Idempotency-Key` or unique violation | Return original result; no double scoring | Same confirmation | Natural keys + idempotency table | REC-03 |
| Browser refresh / new device |  -  | `GET /attempts/{id}` restores questions, answers, remaining time | Resumes | Time derived from `deadline_at` | REC-04 |
| Expired session mid-round | 401 | Refresh token flow; prompt re-login without losing local queue | Sign-in modal preserving route | Queue flushes after re-auth; deadline unaffected | REC-05 |
| Application restart/deploy |  -  | Stateless; deadlines in DB; DB migrations backward compatible | Possibly one retried request | No deployments in event freeze window (RULES sec.11) | REC-06 |
| Serverless cold start/throttle (`503 FUNCTION_THROTTLED` `[V]`) | 503 | Client retry with jitter; pre-warm | Slight delay | Watch burst limit; paid plan | REC-07 |
| Interrupted export | Job heartbeat missing | Resume from cursor; parts persisted | "Export resuming..." | Retries â‰¤ 3, then `failed` with reason | REC-08 |
| Failed background job | `jobs.attempts`, `last_error` | Exponential backoff; dead-letter status; alert | Delayed results/emails | Admin "run now"; idempotent handlers | REC-09 |
| Sweeper missed | Attempts past deadline still `in_progress` | Lazy finalization on next read/write and at round close | None | Round finalize blocks until sweep completes | REC-10 |
| Redis/limiter outage | Client errors | Participant paths fail-open with local limiter; auth/export fail-closed | None or slower auth | Alert; budget cap | REC-11 |
| Email provider cap reached | Provider 4xx/429 | Queue holds emails | Delayed verification | Optional verification; paid tier | REC-12 |
| Provider pause (Supabase Free inactivity) | Cannot connect | Health probe fails | Site errors | Never rely on Free for events; runbook | REC-13 |
| Clock skew (client) | Offset estimate | Display only | Countdown may differ slightly | Server is authoritative | REC-14 |

**Timed rounds and restarts** (NFR-REL-03): deadlines are absolute `timestamptz` values computed once at attempt/challenge start using the database clock; pausing adds recorded extensions (BR-14); nothing depends on process memory, cron accuracy, or the app server's clock.

---

## 21. Deployment, Environments and Configuration

### 21.1 Environments

| Environment | Hosting | Database | Purpose |
|---|---|---|---|
| Local | `next dev`; local Postgres or Supabase local stack `[U]` | Local | Development, seeds |
| Preview | Vercel preview per PR | Shared staging or ephemeral DB `[P]` | Review, e2e smoke |
| Staging | Vercel (Hobby if permitted) | Supabase project #1 (Free) | Integration, rehearsals, load tests |
| Production (regular) | Vercel | Supabase project #2 | Ordinary operation |
| Event tier | Vercel Pro `[P]` | Supabase Pro, Small+ compute | Live events (sec.4.5) |

### 21.2 CI/CD Pipeline and Release Procedure

- **PR:** lint <-’ typecheck <-’ unit <-’ integration (real Postgres service container) <-’ build <-’ dependency/secret scan <-’ Playwright smoke on preview <-’ required review.
- **Merge to main:** deploy staging; run expand-only migrations first; smoke test; k6 smoke.
- **Release:** tag <-’ manual approval <-’ backup <-’ migrations (expand) <-’ deploy <-’ post-deploy smoke <-’ monitor. Contract migrations ship in a later release.
- **Rollback:** promote previous Vercel deployment; DB rollback only by forward-fix or restore.
- **Event freeze:** no production deployments from Tâˆ’2 h to event close except approved hotfixes (RULES sec.11).

### 21.3 Environment Variables (Names Only)

| Variable | Scope | Purpose |
|---|---|---|
| `APP_ENV` | server | `local`/`preview`/`staging`/`production` |
| `NEXT_PUBLIC_APP_URL` | client | Canonical origin (CSRF/origin checks, links) |
| `LOG_LEVEL` | server | Logging verbosity |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Auth admin, Storage, Realtime broadcast  -  **never in the browser** |
| `DATABASE_URL` | server | Pooled (transaction mode) runtime connection, role `app_rw` |
| `DATABASE_READONLY_URL` | server | Pooled connection, role `app_ro` (exports/reports) |
| `DATABASE_MIGRATE_URL` | CI only | Direct/session connection for migrations (owner role) |
| `DB_POOL_MAX` | server | Per-instance pool size (default 2) |
| `DB_STATEMENT_TIMEOUT_MS` | server | Default statement timeout |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | server | Rate limiter |
| `RATE_LIMIT_ENABLED` | server | Kill switch (never disabled in production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | server | App-sent email |
| `EMAIL_DAILY_CAP` | server | Sender queue honors provider cap |
| `CRON_SECRET` | server | Bearer secret for `/api/v1/internal/jobs/tick` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | client/server | Optional CAPTCHA `[P]` |
| `CSP_REPORT_URI` | server | CSP violation reports |
| `SENTRY_DSN` | server/client | Error tracking `[U]` |
| `SENTRY_AUTH_TOKEN` | CI | Source-map upload |
| `ALERT_WEBHOOK_URL` | server/CI | Alert channel `[P]` |
| `ATTEMPT_SAVE_GRACE_MS`, `ATTEMPT_SUBMIT_GRACE_MS` | server | Default grace (3000 / 0) `[T]` |
| `LB_MIN_REBUILD_MS` | server | Leaderboard rebuild debounce (5000) `[T]` |
| `EXPORT_PACING_MS`, `EXPORT_CHUNK_ROWS`, `EXPORT_FAST_PATH_ROWS` | server | Export tuning `[T]` |
| `FEATURE_REALTIME_PARTICIPANTS`, `FEATURE_EXPORT_BOM` | server/client | Feature flags |
| `BACKUP_DATABASE_URL`, `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_S3_*` | CI only | Off-platform encrypted backups |
| `K6_BASE_URL`, `K6_ADMIN_TOKEN`, `K6_PARTICIPANT_TOKENS_FILE` | load-test only | k6 configuration |

### 21.4 `.env.example` (Safe Template  -  No Real Values)

```ini
# ===== App =====
APP_ENV=local
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOG_LEVEL=info

# ===== Supabase (Auth, Storage, Realtime) =====
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SERVER ONLY - never expose to the browser or commit a real value
SUPABASE_SERVICE_ROLE_KEY=

# ===== Database (pooled = transaction mode) =====
DATABASE_URL=
DATABASE_READONLY_URL=
# CI / migrations only (direct or session-mode connection)
DATABASE_MIGRATE_URL=
DB_POOL_MAX=2
DB_STATEMENT_TIMEOUT_MS=5000

# ===== Rate limiting (Upstash Redis) =====
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_ENABLED=true

# ===== Email (SMTP provider) =====
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
EMAIL_DAILY_CAP=300

# ===== Jobs =====
CRON_SECRET=

# ===== Security (optional) =====
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
CSP_REPORT_URI=

# ===== Observability =====
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
ALERT_WEBHOOK_URL=

# ===== Tunables (defaults are targets, not measured values) =====
ATTEMPT_SAVE_GRACE_MS=3000
ATTEMPT_SUBMIT_GRACE_MS=0
LB_MIN_REBUILD_MS=5000
EXPORT_PACING_MS=150
EXPORT_CHUNK_ROWS=1000
EXPORT_FAST_PATH_ROWS=5000

# ===== Feature flags =====
FEATURE_REALTIME_PARTICIPANTS=false
FEATURE_EXPORT_BOM=true

# ===== CI-only secrets (define in GitHub Actions secrets, not in the app) =====
# BACKUP_DATABASE_URL=
# BACKUP_AGE_PUBLIC_KEY=
# BACKUP_S3_ENDPOINT=
# BACKUP_S3_BUCKET=
# BACKUP_S3_ACCESS_KEY_ID=
# BACKUP_S3_SECRET_ACCESS_KEY=

# ===== Load tests (local/CI only) =====
# K6_BASE_URL=
# K6_ADMIN_TOKEN=
# K6_PARTICIPANT_TOKENS_FILE=
```

---

## 22. Monitoring

| Signal | Source | Alert target `[T]` |
|---|---|---|
| Availability | Uptime pings on `/api/health` (shallow) and rate-limited deep check | 2 consecutive failures |
| Error rate | Sentry `[U]` + structured logs | 5xx > 1% over 5 min |
| Latency | Request timing logs by route class | Save/submit p95 above target for 5 min |
| DB saturation | Supabase reports: CPU, memory, disk IOPS, connections, pooler clients `[V]` | CPU > 80%; pooler clients > 70% of cap |
| Job health | `jobs` table: oldest queued age, failures | Queue age > 60 s live / > 10 min otherwise |
| Overdue attempts | Count of `in_progress` past deadline + grace | > 0 for > 60 s |
| Rate-limit hits | Redis counters/logs | Sudden spike on auth/registration |
| Email queue | Pending count vs daily cap | > 80% of cap |
| Export health | Running/failed jobs | Any failed |
| Quotas | Provider usage pages (Vercel, Supabase, Upstash) | Any quota > 70% |
| Business | Attempts started/submitted, submissions, evaluations pending, leaderboard freshness | Freshness > 30 s live |

**Structured log fields:** `ts`, `level`, `request_id`, `route`, `method`, `status`, `latency_ms`, `event_id`, `round_id`, `actor_hash`, `error_code`.

> Log retention is limited on free plans `[V]`: Supabase 1 day on Free; Vercel Hobby log retention reported â‰ˆ 1 h `[S]`  -  production/event tier must ship logs to a durable sink `[P]`.

---

## 23. Backup and Recovery

| Item | Design `[T]`/`[P]` |
|---|---|
| Provider backups | Supabase Free: **none** `[V]`; Pro: daily backups retained 7 days `[V]`; PITR optional at $100/month per 7 days `[V]` |
| Own logical backups | GitHub Actions scheduled `pg_dump` of the app schema, compressed and encrypted with `age`, uploaded off-platform; daily, plus on-demand before and after every round and before every release/migration |
| Retention | Daily Ã -  14; per-round Ã -  event lifetime + 90 days `[P]` |
| Storage objects | Question images/banners mirrored to the backup bucket after change `[U]` |
| RPO target | Event day: â‰¤ 1 round of data if the database is destroyed; otherwise committed writes are durable at ack |
| RTO target | â‰¤ 60 min to restore into a fresh project and repoint config `[T]` |
| Restore drill | Monthly and before the first live event: restore latest dump into an empty project, run integrity checks, compare row counts and checksums, run smoke tests. **A backup is not considered valid until a restore has been rehearsed** |
| Point-of-no-return safeguards | Event archive export (results, responses, evaluations CSV + JSON manifest) generated at completion |
| Degraded mode | Public leaderboard/results snapshot cacheable at the CDN with `stale-if-error`; static "results as of" export can be posted if the DB is unavailable |

---

## 24. Testing and Load-Test Strategy

### 24.1 Test Layers

| Layer | Tooling | Must-cover |
|---|---|---|
| Unit | Vitest | `scoreAttempt`, `computeResults`, tie-break/ranking, aggregation, PRNG shuffle determinism, URL validator, CSV sanitizer (injection corpus), time/deadline math, permission function |
| Integration | Vitest + real Postgres (service container) | Capacity race, participant counter, idempotent submit, `clientSeq` upsert, `FOR UPDATE` submit, advisory-lock single-flight, append-only triggers, audit same-transaction, keyset export, RLS deny-by-default |
| Contract/API | Vitest + supertest-style | Every route: authz matrix, Zod rejection, error shape, idempotency replay |
| End-to-end | Playwright | Register <-’ team <-’ take quiz <-’ submit challenge <-’ judge <-’ publish <-’ leaderboard <-’ export; mobile viewport; keyboard navigation |
| Security | Custom + tools | Authz matrix per role, cross-event isolation (`SEC-ISO-*`), IDOR attempts, CSRF/origin checks, XSS payloads, CSV injection, rate-limit behavior, SSRF-style URLs, secret scan, dependency audit |
| Recovery | Scripts + fault injection | REC-01"¦REC-14 (sec.20): DB disconnect, restart mid-attempt, duplicate delivery, sweeper disabled, export kill/resume |
| Accessibility | axe + manual | WCAG 2.2 AA checks on key flows |
| Performance | Lighthouse CI; k6 | Budgets in DESIGN.md; load scenarios below |

### 24.2 Load-Test Environment

- Dedicated staging stack identical to the event tier (same Supabase plan/compute, region, Vercel plan)  -  results on Free tiers are not evidence for the event tier.
- Realistic seed: 1,000 users, 500+ approved participants, a 30-question quiz, a challenge round, a judged round, 10 staff accounts.
- **Auth:** pre-mint sessions for virtual users to avoid measuring Auth rate limits and email caps; test the login path separately at lower volume.
- **Load generators:** k6 open-source runners and/or Grafana Cloud k6 (Free 500 VUh/month `[V]`) from â‰¥ 2 locations.
- **After each test:** reconciliation  -  client-side acknowledged writes vs. database rows (must match exactly), plus check for duplicate attempts/scores.

### 24.3 Scenarios

| ID | Scenario | Profile | Pass criteria `[T]` |
|---|---|---|---|
| LT-0 | Smoke | 5 VUs, 2 min | 0 errors |
| LT-1 | Browse + dashboard + login mix | Ramp 100 <-’ 250 <-’ 500 VUs, 10 min each | Page/API p95 within sec.18.5; 5xx < 0.5% |
| LT-2 | Simultaneous quiz start | 500 starts within 30 s | Start p95 â‰¤ 1.2 s; no duplicate attempts; pooler < 70% |
| LT-3 | Sustained answer saving | 500 VUs, saves every 5""40 s for 30 min | Save p95 â‰¤ 500 ms / p99 â‰¤ 1.5 s; 0 lost |
| LT-4 | Concentrated submit surge | 500 submits in 3 s; variant with 0""3 s jitter | Submit p95 â‰¤ 1 s / p99 â‰¤ 2.5 s; exactly one score per attempt |
| LT-5 | Leaderboard viewers | 500 pollers (15 s, ETag) while LT-4 runs | Read p95 â‰¤ 300 ms; freshness â‰¤ 15 s p95; exactly one rebuild per interval |
| LT-6 | Synchronized challenge deadline | 250""500 submissions in 60 s incl. 10% duplicates | Submit p95 â‰¤ 1 s; revisions consistent; late policy correct |
| LT-7 | Mixed live event | 500 quiz + 500 leaderboard + 10 admin + export of 10k rows | All above hold; export â‰¤ 60 s |
| LT-8 | Headroom | Step 500 <-’ 750 <-’ 1,000 VUs | Identify knee; â‰¥ 50% headroom desirable |
| LT-9 | Soak | 250 VUs, 60 min | No latency drift, memory/connection leaks |
| LT-10 | DB pressure & recovery | Slow query injection, connection kill, pooler saturation | Graceful 503s; recovery without data loss |
| LT-11 | Registration surge | 500 registrations/60 s, capacity 400 | Exactly 400 accepted; rest waitlisted/rejected; unique codes |

### 24.4 Reporting

Each run records: build SHA, config (plan/compute/region), scenario, VUs, duration, throughput (rps), latency p50/p95/p99 per route, error rates by class, DB CPU/memory/IOPS/connections, pooler clients, function throttles, reconciliation result, pass/fail per criterion, and links to raw output.

> **Status today:** no load test has been run; all figures are targets. Claims of readiness require an attached report (RULES sec.10).

---

## 25. Decision Register

> Status **Proposed** = recommended in this document, not approved. Nothing below is final.

| ID | Decision | Status | Alternatives | Decide by |
|---|---|---|---|---|
| AD-01 | Modular monolith (Next.js + TS) | Proposed | Separate API service; Workers | M0 |
| AD-02 | Supabase Postgres as system of record | Proposed | Neon; D1 | M0 |
| AD-03 | Supabase Auth behind `AuthProvider` | Proposed | Auth.js; custom | M0 |
| AD-04 | Drizzle ORM + SQL migrations | Proposed | Prisma; Kysely | M1 |
| AD-05 | Polling snapshots baseline; realtime ping optional | Proposed | WebSocket server; Ably | M0 |
| AD-06 | Upstash Redis for rate limiting | Proposed | Postgres counters; edge firewall only | M0 |
| AD-07 | DB-backed jobs + tick endpoints | Proposed | BullMQ; pg_cron only | M1 |
| AD-08 | Scores as `numeric` | Proposed | Floats | M1 |
| AD-09 | Live leaderboard from snapshots; official results from result runs | Proposed | Only official runs | M0 |
| AD-10 | Export as chunked resumable parts | Proposed | Single streaming response only | M1 |
| AD-11 | Event tier on paid plans; free tiers for dev/staging | Proposed  -  **needs owner approval** (D-P02) | Free-only with accepted risk | M0 |
| AD-12 | Region co-location (Mumbai if available) | Pending verification `[U]` | Nearest available | M0 |
| AD-13 | Own encrypted off-platform backups | Proposed | Provider backups only | M1 |
| AD-14 | Tailwind + Radix primitives design system | Proposed | Other component libs | M2 |
| AD-15 | Quiz question payload cache per round | Proposed, optional | None | M1 |

---

## 26. Extensibility and Migration

| Change | Approach |
|---|---|
| New round type (e.g., coding auto-judge, file upload, buzzer) | Implement `RoundType` (sec.10.1); add tables if needed; register; scoring integrates through `RawScoreInput <-’ score_records`; export columns via `exportColumns` |
| New export type | Register a serializer + column definition; reuse job runner and sanitizer |
| New registration field type | Add to field type registry with validator and CSV formatter |
| Multi-organization | Add `organization_id` above events and to role scopes; composite FKs already isolate by event |
| Auth provider swap | Implement `AuthProvider`; migrate identities via `users.auth_user_id`; password migration requires reset unless hashes are exportable |
| DB provider swap | Standard Postgres `pg_dump`/restore; re-point `DATABASE_*`; verify extensions |
| Scale beyond MVP | Read replicas (offered on higher Supabase tiers `[S]`); partition `quiz_responses`/`audit_logs` by month; dedicated realtime for participants |
| Config evolution | `type_config_version` + `migrateConfig`; scoring configs immutable and versioned |

---

## 27. Known Limitations and Open Items

1. No repository was available; no code exists (sec.2).
2. All performance figures are targets; the free-tier-only path is unverified and documented as unsuitable for a live 500-participant event (sec.4.4).
3. Unverified items `[U]` listed in sec.4.2 must be resolved in **T-0.5** before commitments (GitHub Actions minutes, Sentry, Vercel Cron/Firewall, `pg_cron`, regions, Turnstile).
4. Vercel Hobby commercial-use eligibility: **RESOLVED**  -  events are non-commercial; Vercel Hobby is permitted (D-P02 closed 2026-09-25).
5. Cheating (shared answers, multiple accounts, external help) cannot be fully prevented by a web app; the platform provides rate limits, audit trails and duplicate-link flags, not guarantees.
6. GitHub ownership is not verified (BR-18).
7. Team-quiz semantics, grace periods, missing-round policy and privacy retention are pending approval (PRD sec.11).
8. Supabase Auth email limits and custom-SMTP ramp-up behavior need confirmation on the official page `[S]`.
9. Realtime for participants is deferred; only staff realtime is planned for the MVP.
10. Point-in-time recovery is not included in the base plan; RPO depends on the backup cadence unless PITR is purchased.


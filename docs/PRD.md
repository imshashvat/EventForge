# EventForge  -  Product Requirements Document (PRD)

**Document status:** Draft v0.1
**Last updated:** 2026-09-25
**Owner:** Project owner (TBD)
**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) * [RULES.md](./RULES.md) * [DESIGN.md](./DESIGN.md) * [TASKS.md](./TASKS.md) * [MEMORY.md](./MEMORY.md)

---

## Evidence Tag Definitions

All claims in EventForge documentation are tagged with an evidence level:

| Tag | Meaning |
|---|---|
| `[V]` | **Verified**  -  number or fact appears on the provider's own official page, retrieved and confirmed on the date shown |
| `[S]` | **Secondary**  -  sourced from a third-party page, blog, or cached snapshot; must be confirmed on the official page before acting on it |
| `[E]` | **Estimate**  -  a calculated or modelled figure, not measured; must be validated by load testing |
| `[T]` | **Target**  -  a desired outcome that has not yet been measured or proven; becomes a pass/fail criterion in testing |
| `[P]` | **Proposed**  -  a design decision that has been recommended but not yet formally approved |
| `[U]` | **Unverified**  -  a claim that has not been looked up yet; must be verified before the relevant task begins |

---

## Table of Contents

1. [Vision and Goals](#1-vision-and-goals)
2. [Users and Personas](#2-users-and-personas)
3. [Scope and Non-Goals](#3-scope-and-non-goals)
4. [Feature Requirements](#4-feature-requirements)
5. [Business Rules](#5-business-rules)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Open Decisions](#7-open-decisions)
8. [Glossary](#8-glossary)

---

## 1. Vision and Goals

**EventForge** is a self-hosted, non-commercial platform for running structured competitive events  -  quizzes, coding challenges, and judged presentations  -  for communities, colleges, and clubs. It provides:

- A single place to create and manage many independent events
- Configurable multi-round competition formats (quiz <-’ challenge <-’ judging in any order)
- Server-authoritative timers and scoring that participants cannot tamper with
- Leaderboards with flexible visibility policies
- Auditable, reproducible results with CSV export
- Support for 500+ simultaneous participants on a non-commercial hobbyist infrastructure budget

**Non-commercial declaration:** EventForge events do not charge entry fees, sell sponsorships, or generate revenue. This preserves Vercel Hobby plan eligibility `[V]`.

### 1.1 Success Metrics

| Metric | Target |
|---|---|
| Quiz answer save round-trip | p95 â‰¤ 500 ms under 500 VUs `[T]` |
| Quiz submit round-trip | p95 â‰¤ 1 s under 500 simultaneous submits `[T]` |
| Leaderboard freshness after score commit | â‰¤ 15 s p95 `[T]` |
| Simultaneous participants supported | â‰¥ 500 (proven by load test LT-8) `[T]` |
| Data loss on acknowledged write | 0 (reconciliation must confirm) `[T]` |
| Time to restore from backup | â‰¤ 60 min `[T]` |

---

## 2. Users and Personas

### 2.1 Roles

| Role | Description |
|---|---|
| **Super Admin** | Platform-level administrator; can create events and assign all roles |
| **Event Admin** | Manages one or more events end-to-end; cannot manage other admins |
| **Round Manager** | Manages rounds assigned to them; cannot modify event-level settings |
| **Judge** | Scores submissions assigned to them; sees only their assigned items |
| **Reviewer** | Read-only observer for staff; can view registrations and results |
| **Participant** | Registered competitor; acts only on their own records and eligible rounds |
| **Public visitor** | Unauthenticated; can view published events and public leaderboards only |

### 2.2 Key Personas

**Priya  -  Event Organizer**
- Runs an annual inter-college tech fest with 400""600 participants
- Needs a reliable quiz platform that works on the day without surprises
- Wants CSV exports she can drop into a spreadsheet for prize distribution

**Arjun  -  Participant**
- Uses a mid-range Android phone on 4G
- Gets anxious if the timer looks wrong or answers seem unsaved
- Expects to be able to refresh without losing progress

**Meena  -  Judge**
- Non-technical; evaluates project presentations using a rubric
- Needs a simple scoring form, not a spreadsheet
- Wants to know if her scores disagree significantly with another judge

---

## 3. Scope and Non-Goals

### 3.1 In Scope (MVP)

- Event lifecycle management (create, publish, pause, complete, archive)
- Registration with configurable form fields, approval workflows, and team formation
- Quiz round: multi-type questions, timed attempts, auto-scoring, server-authoritative deadlines
- Challenge round: per-entry or shared-window submission of URLs (repo, deploy, video, docs)
- Judged round: rubric-based evaluation, blind mode, disagreement reconciliation
- Configurable multi-round result calculation (weighted, sum, tie-break)
- Live leaderboard via snapshot polling (Realtime ping for staff)
- CSV exports: registrations, responses, evaluations, results
- Role-based access control with per-event and per-round scoping
- Audit log for all sensitive operations
- Admin dashboard with live event monitoring

### 3.2 Out of Scope (Post-MVP)

- Automated code judging (e.g., compile and run participant submissions)
- GitHub repository ownership verification via OAuth
- Real-time WebSocket leaderboard for participants (deferred; polling is the baseline)
- Multi-organization / multi-tenant admin hierarchy
- Native mobile applications
- Payment / registration fee collection
- Plagiarism or code similarity detection
- Live video streaming or proctoring
- AI-generated question banks

---

## 4. Feature Requirements

### FR-AUTH  -  Authentication

| ID | Requirement |
|---|---|
| FR-AUTH-01 | Users must sign up with email and password |
| FR-AUTH-02 | Events may require email verification before registration (configurable per event) |
| FR-AUTH-03 | Users must be able to reset their password via email |
| FR-AUTH-04 | Super admins and event admins must be able to enable TOTP MFA on their accounts |
| FR-AUTH-05 | Sessions must use HTTP-only Secure SameSite=Lax cookies |
| FR-AUTH-06 | The system must revoke sessions on password change and role removal |

### FR-EVT  -  Events

| ID | Requirement |
|---|---|
| FR-EVT-01 | Admins must be able to create events with a unique slug, title, description, banner image, timezone, and date range |
| FR-EVT-02 | Events must transition through a defined lifecycle: draft <-’ published <-’ (paused <-" published) <-’ completed <-’ archived |
| FR-EVT-03 | Events must support individual-only, team-only, or both competition modes |
| FR-EVT-04 | Events must enforce a configurable participant capacity with optional waitlist |
| FR-EVT-05 | Events must support automatic and manual participant approval modes |
| FR-EVT-06 | A paused event must prevent all participant writes (attempts, submissions) |
| FR-EVT-07 | An archived event must remain readable; exports must still be possible |

### FR-REG  -  Registration

| ID | Requirement |
|---|---|
| FR-REG-01 | The registration form must support text, number, email, phone, select, multiselect, and file-upload (image) field types |
| FR-REG-02 | Form fields must support required/optional, organizer-defined validation rules, and display order |
| FR-REG-03 | Organizers must be able to mark fields as unique (e.g., institution, roll number) to prevent duplicates |
| FR-REG-04 | Organizers must be able to mark fields as PII; PII fields must be excluded from leaderboards and require `export:pii` permission to export |
| FR-REG-05 | Participants must be able to update their registration until a configurable lock date |
| FR-REG-06 | Registration must be idempotent: retrying the same request must not create duplicate records |
| FR-REG-07 | Participants must receive a confirmation email after approval |

### FR-TEAM  -  Teams

| ID | Requirement |
|---|---|
| FR-TEAM-01 | Teams must be created with a name and a shareable invite code |
| FR-TEAM-02 | Participants must be able to join a team using the invite code until the team lock time |
| FR-TEAM-03 | Each participant may belong to at most one team per event |
| FR-TEAM-04 | Teams must enforce a configurable minimum and maximum member count |
| FR-TEAM-05 | The team captain must be able to remove members before the lock time |

### FR-ROUND  -  Rounds

| ID | Requirement |
|---|---|
| FR-ROUND-01 | Events must support 1""N rounds in a configurable sequence |
| FR-ROUND-02 | Each round must have a type: `quiz`, `challenge`, or `judged` |
| FR-ROUND-03 | Rounds must support a scheduled start and automatic open/close via server clock |
| FR-ROUND-04 | Rounds must support manual open, close, pause, resume, and extend (with reason) |
| FR-ROUND-05 | Rounds must enforce eligibility rules: all, top-N from a prior round, min-score, or manual list |
| FR-ROUND-06 | Round results must define advancement criteria for multi-round events |

### FR-QUIZ  -  Quiz Engine

| ID | Requirement |
|---|---|
| FR-QUIZ-01 | Questions must support types: single-choice, multi-choice, true/false, and short-text |
| FR-QUIZ-02 | Questions must support an optional image in stem and options |
| FR-QUIZ-03 | Editing a question after any attempt has started must create a new immutable version |
| FR-QUIZ-04 | Round composition must support fixed question lists and/or randomized pools by tag/difficulty |
| FR-QUIZ-05 | Question order and option order must be randomized per-attempt using a stored, reproducible seed |
| FR-QUIZ-06 | Each participant must see a server-authoritative countdown derived from `deadline_at` |
| FR-QUIZ-07 | Answers must be saved automatically (debounced) and resumable after page refresh or crash |
| FR-QUIZ-08 | The system must auto-submit an attempt when `deadline_at` is reached using saved answers |
| FR-QUIZ-09 | Correct answers must not be sent to the browser until results are released |
| FR-QUIZ-10 | Scoring must support per-question positive marks, negative marks, and optional partial credit for multi-choice |
| FR-QUIZ-11 | Text answers must be auto-graded against an accepted-answers list with configurable normalization |
| FR-QUIZ-12 | Text answers that do not match must be flagged for manual review; the round cannot finalize until all reviews are complete |

### FR-CHAL  -  Challenge Submissions

| ID | Requirement |
|---|---|
| FR-CHAL-01 | A challenge round must support a fixed shared deadline or a per-entry countdown (started by the participant) |
| FR-CHAL-02 | Participants must be able to submit a GitHub repo URL, a live deploy URL, a video URL, and a description |
| FR-CHAL-03 | All submitted URLs must pass server-side validation (scheme, host, length, no SSRF vectors) before acceptance |
| FR-CHAL-04 | Participants must be able to save a draft at any time without it counting as a final submission |
| FR-CHAL-05 | Participants must be able to resubmit before the deadline; each revision is recorded and immutable |
| FR-CHAL-06 | The latest on-time revision must be the one counted for judging |
| FR-CHAL-07 | Submissions after the deadline must be accepted only if the event's late policy permits, and must be flagged `is_late` |

### FR-JDG  -  Judging

| ID | Requirement |
|---|---|
| FR-JDG-01 | Each judged round must have a rubric with named criteria, max marks, optional weights, and a description |
| FR-JDG-02 | Each submission must be assigned to at least `min_judges` judges |
| FR-JDG-03 | Judges must be able to save evaluations as drafts before submitting |
| FR-JDG-04 | In blind mode, judges must see a pseudonymous item code; no team or participant names must be shown |
| FR-JDG-05 | When judge scores diverge beyond a configurable threshold, the item must be flagged for reconciliation |
| FR-JDG-06 | Authorized roles must be able to resolve disagreements by requesting a re-score or recording a manual resolution with a mandatory reason |
| FR-JDG-07 | Every evaluation state change (submit, resolve, finalize, unlock) must be recorded in the audit log with actor, timestamp, before/after state, and reason |

### FR-SCORE  -  Scoring and Results

| ID | Requirement |
|---|---|
| FR-SCORE-01 | All score records must be append-only; corrections create new records that supersede old ones, never delete or update |
| FR-SCORE-02 | Result calculation must be deterministic and reproducible from stored inputs |
| FR-SCORE-03 | Result runs must store a snapshot of the scoring config and an inputs hash for audit |
| FR-SCORE-04 | Admins must be able to apply manual adjustments and penalties with a mandatory reason |
| FR-SCORE-05 | Results must support weighted and sum aggregation modes across rounds |
| FR-SCORE-06 | Tie-breaking must follow a configurable chain (round score, total time, last submit time) |
| FR-SCORE-07 | Equal-score ties that cannot be broken must be flagged `tied_unresolved` and ranked equally |
| FR-SCORE-08 | Withdrawn and disqualified entries must retain their score records but receive `rank = null` |

### FR-LB  -  Leaderboard

| ID | Requirement |
|---|---|
| FR-LB-01 | The leaderboard must support visibility modes: `hidden_until_end`, `during_rounds`, `staff_only`, `participants_only`, `public` |
| FR-LB-02 | The live leaderboard must update within 15 s of a score commit (p95) `[T]` |
| FR-LB-03 | The leaderboard must never expose PII fields |
| FR-LB-04 | Participants must be able to see their own rank even when the full leaderboard is hidden (if `show_own_rank_when_hidden` is enabled) |
| FR-LB-05 | A freeze timestamp must be configurable; after it, non-staff participants see the pre-freeze snapshot |
| FR-LB-06 | The leaderboard must distinguish between provisional (live) and official (result-run) states |

### FR-EXP  -  CSV Export

| ID | Requirement |
|---|---|
| FR-EXP-01 | Exports must be available for: registrations, quiz responses, challenge submissions, evaluations, round results, event results |
| FR-EXP-02 | Event result exports must include, per entry: event metadata, per-round scores, weighted total, penalties, final score, final rank, tie status, advancement status, entry status |
| FR-EXP-03 | Exports must follow RFC 4180 with UTF-8 encoding and optional BOM |
| FR-EXP-04 | All string cells must be sanitized against CSV formula injection (prepend `'` if the first character is `=`, `+`, `-`, `@`, TAB, or CR) |
| FR-EXP-05 | PII fields must require `export:pii` permission; exports without this permission must omit PII columns |
| FR-EXP-06 | Large exports must be chunked and resumable; they must not block normal traffic |
| FR-EXP-07 | A manifest JSON sidecar must accompany every export (filters, row count, SHA-256, timestamp, result run reference) |

### FR-AUDIT  -  Audit Log

| ID | Requirement |
|---|---|
| FR-AUDIT-01 | All sensitive operations (role changes, score corrections, result publication, account actions) must write to `audit_logs` in the same transaction as the change |
| FR-AUDIT-02 | Audit log entries must include: actor user ID, actor role, action, target type, target ID, before state, after state, reason, IP hash, request ID, timestamp |
| FR-AUDIT-03 | Audit log entries must never be updated or deleted; enforcement is a DB trigger |
| FR-AUDIT-04 | Authorized roles must be able to search and filter the audit log |

---

## 5. Business Rules

Business rules are invariants that must hold at all times. Violations must be prevented at the application layer (and where possible at the database layer).

| ID | Rule |
|---|---|
| BR-01 | An event-scoped record must never reference a parent record from a different event. Enforced by composite FKs `(event_id, parent_id)`. |
| BR-02 | The system clock used for all deadline and timing decisions is `now()` evaluated by PostgreSQL, not the application server or client clock. |
| BR-03 | The client timer countdown is purely presentational. The server's stored `deadline_at` is the authoritative deadline regardless of what the client displays. |
| BR-04 | `deadline_at = LEAST(started_at + round_duration, round.ends_at)`. An attempt cannot be started if `deadline_at <= now()`. |
| BR-05 | Scores are computed server-side from immutable frozen question versions and server-recorded responses. Client-submitted scores are never used. |
| BR-06 | Editing a question that any started attempt references must create a new `question_versions` row. The existing version and its frozen attempt records are immutable. |
| BR-07 | Correct-answer data must not be included in any API response visible to a participant until results are officially released for that round. |
| BR-08 | A locked judge evaluation is immutable. Correction requires an authorized unlock that creates a new revision; history is never rewritten. |
| BR-09 | `score_records` rows must never be updated or deleted. Corrections create new rows with `superseded_by` pointing to the old row. |
| BR-10 | A result run must store a `config_snapshot` (scoring config at the time of the run) and an `inputs_hash`. Recomputing the run from stored data must produce byte-identical results. |
| BR-11 | Publishing a corrected result does not delete the previous final run. The old run's `status` is set to `superseded`; it remains queryable. |
| BR-12 | The per-quiz total score may optionally be floored at 0 (`floor_total_at_zero`). The default is `false`  -  negative totals are possible. |
| BR-13 | A round cannot be finalized while any quiz text-answer is pending manual review. |
| BR-14 | When a round is paused and then resumed, every in-progress attempt's and challenge's `deadline_at` is extended by the pause duration exactly once, in a single transaction. |
| BR-15 | When a participant experiences a verifiable service outage during an active attempt, an admin may apply an audited deadline extension to the affected entries. This extension must be recorded with a mandatory reason. |
| BR-16 | The registration form version in use at the time of registration is frozen on the participant record. Changing the form does not retroactively alter existing registrations. |
| BR-17 | A participant may belong to at most one active team per event at any time. |
| BR-18 | Submitted URLs are participant claims only. The system flags duplicate repo URLs across entries but does not verify ownership. Ownership verification is a post-MVP feature. |
| BR-19 | A judge may only see and score submissions assigned to them. Blind mode hides all identity information. |
| BR-20 | Withdrawing an entry preserves all score records but sets `rank = null` and `result_status = withdrawn` in result runs. |
| BR-21 | Disqualifying an entry preserves all score records and the disqualification reason; sets `rank = null` and `result_status = disqualified` in result runs. |
| BR-22 | Team composition changes after scoring do not retroactively alter team scores. Any correction must go through the audited score-correction flow. |
| BR-23 | An event admin may not grant themselves a higher role than `event_admin`. Only super admins may grant the `super_admin` role. |
| BR-24 | When "close round" is triggered (by time or manually), all in-progress attempts must be auto-submitted from their saved answers before the round moves to `closed`. |
| BR-25 | Tied entries at the same rank cause the next rank to skip (1, 2, 2, 4). |
| BR-26 | No deployment may be made to the production environment within 2 hours before a scheduled round start, through to round close, except for approved emergency hotfixes. |
| BR-27 | PII fields (as flagged in `registration_field_defs`) must never appear in leaderboard payloads, audit log `before`/`after` values, or any API response that does not require `export:pii` permission. |
| BR-28 | Every string value written to a CSV cell must pass through the formula-injection sanitizer: prepend `'` if the first character is `=`, `+`, `-`, `@`, TAB (0x09), or CR (0x0D). Numeric columns are typed as numbers and are exempt. |
| BR-29 | `audit_logs` rows must never be updated or deleted. A database trigger must block any `UPDATE` or `DELETE` on this table. |
| BR-30 | The number, type, and order of rounds is data (stored in the `rounds` table). The application must not hardcode any assumption about round structure. |

---

## 6. Non-Functional Requirements

### NFR-PERF  -  Performance

| ID | Requirement |
|---|---|
| NFR-PERF-01 | Answer-save round-trip p95 â‰¤ 500 ms, p99 â‰¤ 1.5 s under 500 concurrent users `[T]` |
| NFR-PERF-02 | Quiz submit round-trip p95 â‰¤ 1 s, p99 â‰¤ 2.5 s under 500 simultaneous submits `[T]` |
| NFR-PERF-03 | Leaderboard read p95 â‰¤ 300 ms (304 or 200) `[T]` |
| NFR-PERF-04 | Participant dashboard first meaningful content â‰¤ 2.0 s p75 on a mid-range mobile device on 4G `[T]` |
| NFR-PERF-05 | Quiz route JavaScript bundle â‰¤ 170 KB gzipped `[T]` |
| NFR-PERF-06 | CSV export of 10,000 rows completes in â‰¤ 60 s under full event traffic `[T]` |
| NFR-PERF-07 | The platform must support a headroom test at 750""1,000 concurrent users without data loss `[T]` |

### NFR-REL  -  Reliability

| ID | Requirement |
|---|---|
| NFR-REL-01 | A write must never be reported as successful unless it has been committed to the database. No acknowledgement of an uncommitted write is permitted. |
| NFR-REL-02 | The client must queue unsaved answers locally (memory + IndexedDB) during network interruptions and flush them in order on reconnect. |
| NFR-REL-03 | Attempt and challenge deadlines must be stored as absolute `timestamptz` values in the database. They must survive application restarts, deployments, and cron failures without change. |
| NFR-REL-04 | All API mutations must be idempotent: retrying with the same `Idempotency-Key` must return the original result without side effects. |
| NFR-REL-05 | The leaderboard must continue serving the last valid snapshot if a rebuild fails. |

### NFR-SEC  -  Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All authorization decisions must go through the central `authorize(actor, permission, scope)` function. No route may implement ad-hoc authorization. |
| NFR-SEC-02 | The application must defend against SQL injection (parameterized queries only), XSS (React escaping + allow-list HTML sanitizer), CSRF (SameSite=Lax + Origin check), CSV formula injection (sanitizer), and SSRF (URL validator). |
| NFR-SEC-03 | No password, token, or full email address may appear in application logs. |
| NFR-SEC-04 | The Supabase service-role key must never be included in client-side bundles (`NEXT_PUBLIC_*` prefix is forbidden for secrets). |
| NFR-SEC-05 | Cross-event data leakage must be tested automatically on every CI run (`SEC-ISO-*` test suite). |
| NFR-SEC-06 | Image uploads must be validated by MIME type and file extension allow-list, size-capped, and stored in a dedicated non-executable bucket. |

### NFR-AUD  -  Auditability

| ID | Requirement |
|---|---|
| NFR-AUD-01 | Every result run must be reproducible from stored data: given the same `result_run_id`, `computeResults()` must produce byte-identical output. |
| NFR-AUD-02 | The audit log must record the before and after state of every sensitive operation. |
| NFR-AUD-03 | Score records must retain their scoring-config version so that historical scoring logic can be reconstructed. |

### NFR-ACC  -  Accessibility

| ID | Requirement |
|---|---|
| NFR-ACC-01 | All key participant flows (quiz, submit, leaderboard) must meet WCAG 2.2 Level AA. |
| NFR-ACC-02 | The quiz interface must be fully operable by keyboard alone. |
| NFR-ACC-03 | Color must not be the only means of conveying information (e.g., correct/wrong answer states). |

### NFR-OPS  -  Operations

| ID | Requirement |
|---|---|
| NFR-OPS-01 | A restore drill must be performed monthly and before every live event. A backup is not considered valid until a restore has been rehearsed. |
| NFR-OPS-02 | The platform must export a complete event archive (results, responses, evaluations CSV + JSON manifest) at event completion. |
| NFR-OPS-03 | No production deployment may occur within 2 hours of a scheduled round start through to round close (BR-26). |

---

## 7. Open Decisions

| ID | Decision | Owner | Due |
|---|---|---|---|
| D-P04 | Submit grace period (default 0 ms): confirm whether a short grace (e.g., 500 ms) should be added to absorb network jitter on submit | Project owner | M1 |
| D-P07 | Counted revision rule for challenges: "latest on-time revision" is proposed; confirm edge cases (e.g., multiple on-time revisions) | Project owner | M1 |
| D-P09 | Privacy and data-retention policy: define retention periods for PII, response data, and audit logs | Legal/owner | M2 |
| D-P10 | MFA enforcement: should TOTP be mandatory or optional for admins? | Project owner | M0 |
| R-01 | Missing-round policy default (`zero`, `exclude`, or `rank_last`) | Project owner | M1 |
| R-09 | Team-quiz semantics: does a team get one shared attempt or one per member? | Project owner | M1 |

---

## 8. Glossary

| Term | Definition |
|---|---|
| **Attempt** | A single quiz session for one entry in one round; has a `started_at`, `deadline_at`, and immutable frozen question list |
| **Entry** | The competing unit for a given event; either an individual participant or a team |
| **Event tier** | The paid infrastructure configuration used for live events ($50""85/month list price) |
| **Finalize** | The round state transition from `closed`/`judging` <-’ `finalized`, which locks scores and computes advancement |
| **Frozen questions** | The immutable `attempt_questions` rows generated at attempt start, locking the question version, order, and option order used for that attempt |
| **Idempotency key** | A client-generated UUID sent with mutable requests; replayed requests with the same key return the original stored result |
| **Provisional result** | A result run with `status = provisional`; visible to staff but labelled as not final |
| **Result run** | A versioned, stored application of `computeResults()` to a snapshot of score records and config; produces `calculated_results` |
| **Score record** | An append-only row in `score_records` representing one scored fact (auto quiz score, judge aggregate, manual adjustment, penalty) |
| **Snapshot** | A precomputed leaderboard payload stored in `leaderboard_snapshots` and served directly without re-aggregating |
| **Supersede** | The mechanism for correcting a score record: a new row is inserted with `superseded_by` pointing to the old row; the old row is never modified |
| **Sweeper** | A background job that periodically auto-submits in-progress attempts that have passed their `deadline_at` |
| **Watermark** | The `max(score_records.id)` value at the time a leaderboard snapshot was built; used to detect staleness |
/**
 * modules/results/compute.ts — M2-C2
 *
 * computeResults(inputs, config) → CalculatedResultRow[]
 *
 * Pure function: no I/O, no clock, no randomness. Deterministic given the same
 * inputs. Tested with golden fixtures (ARCHITECTURE.md §14.6, R-TEST-04).
 *
 * Arithmetic uses fixed-point via string→number→string to avoid IEEE 754 drift;
 * final scores are rounded to 4 decimal places (round half up), matching the
 * DB numeric(10,4) columns.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MissingRoundPolicy = "zero" | "exclude" | "rank_last";

export interface RoundConfig {
  roundId: string;
  /** Contribution weight (0–1). Only used in 'weighted' mode. */
  weight: number;
  include: boolean;
  /** Maximum possible raw score for normalisation in 'weighted' mode. */
  roundMax: number;
}

export interface ResultConfig {
  mode: "weighted" | "sum";
  /** Final score scale for weighted mode (e.g. 100). Ignored for sum. */
  scale: number;
  rounds: RoundConfig[];
  missingRoundPolicy: MissingRoundPolicy;
  /** Maximum total event-level penalty that can be applied. */
  penaltyCap?: number;
  /** Ordered tie-break chain. Supported tokens: "round_score:<id>", "total_time_asc", "last_submit_asc" */
  tieBreak: string[];
  rankScope: "active_only" | "all";
}

export interface ScoreRecord {
  id: string;
  entryId: string;
  roundId: string;
  /** source CHECK: 'quiz_auto','judge_aggregate','admin_adjust','penalty' */
  source: "quiz_auto" | "judge_aggregate" | "admin_adjust" | "penalty";
  rawScore: string; // numeric string
  finalScore: string; // numeric string (post-penalties at the score level)
  supersededBy: string | null;
}

export type EntryStatus = "active" | "withdrawn" | "disqualified";

export interface EntryInput {
  entryId: string;
  status: EntryStatus;
  statusReason?: string;
  /** ISO timestamp of the final (latest) submission across all rounds. */
  lastSubmitAt?: string;
  /** Total active time across rounds in milliseconds (for total_time_asc tie-break). */
  totalTimeMs?: number;
  /** Per-round submit timestamps for round_score tie-break. */
  roundSubmitAt?: Record<string, string>;
}

export interface ComputeResultsInput {
  entries: EntryInput[];
  scoreRecords: ScoreRecord[];
  config: ResultConfig;
}

export interface RoundBreakdownRow {
  roundId: string;
  score: string | null;
  max: number;
  status: "scored" | "unscored" | "excluded";
}

export interface CalculatedResultRow {
  entryId: string;
  finalScore: string | null;
  rank: number | null;
  tieStatus: "none" | "tied_resolved" | "tied_unresolved";
  advancementStatus: string | null;
  entryStatus: EntryStatus;
  statusReason: string | null;
  roundBreakdown: RoundBreakdownRow[];
}

// ── Fixed-point arithmetic helpers ───────────────────────────────────────────

/** Parse numeric string to float, defaulting to 0 on failure. */
function n(v: string | null | undefined): number {
  if (v == null) return 0;
  const parsed = parseFloat(v);
  return isNaN(parsed) ? 0 : parsed;
}

/** Round half-up to `dp` decimal places. */
function roundHalfUp(x: number, dp: number): number {
  const factor = Math.pow(10, dp);
  return Math.round((x + Number.EPSILON) * factor) / factor;
}

/** Format a number to exactly 4 decimal places as a string. */
function fmt(x: number): string {
  return roundHalfUp(x, 4).toFixed(4);
}

// ── Per-entry score computation ───────────────────────────────────────────────

interface EntryScores {
  entryId: string;
  finalScore: number | null; // null = rank_last policy
  roundBreakdown: RoundBreakdownRow[];
  isRankLast: boolean;
}

function computeEntryScore(
  entry: EntryInput,
  nonSupersededRecords: ScoreRecord[],
  config: ResultConfig,
): EntryScores {
  const entryRecords = nonSupersededRecords.filter((r) => r.entryId === entry.entryId);

  const breakdown: RoundBreakdownRow[] = [];
  let totalContribution = 0;
  let isRankLast = false;

  for (const rc of config.rounds) {
    if (!rc.include) continue;

    // Find the primary score record for this (entry, round)
    const primary = entryRecords.find(
      (r) => r.roundId === rc.roundId && (r.source === "quiz_auto" || r.source === "judge_aggregate"),
    );

    // Sum admin adjustments
    const adjustments = entryRecords
      .filter((r) => r.roundId === rc.roundId && r.source === "admin_adjust")
      .reduce((acc, r) => acc + n(r.rawScore), 0);

    // Sum penalties (stored as positive numbers, deducted)
    const penalties = entryRecords
      .filter((r) => r.roundId === rc.roundId && r.source === "penalty")
      .reduce((acc, r) => acc + n(r.rawScore), 0);

    if (!primary) {
      // Missing round
      switch (config.missingRoundPolicy) {
        case "zero":
          breakdown.push({ roundId: rc.roundId, score: "0.0000", max: rc.roundMax, status: "unscored" });
          // contribution = 0, already initialized
          break;
        case "exclude":
          breakdown.push({ roundId: rc.roundId, score: null, max: rc.roundMax, status: "excluded" });
          // No contribution — treated as 0 points but not ranked last
          break;
        case "rank_last":
          breakdown.push({ roundId: rc.roundId, score: null, max: rc.roundMax, status: "unscored" });
          isRankLast = true;
          break;
      }
      continue;
    }

    const roundFinal = n(primary.rawScore) + adjustments - penalties;

    let contribution: number;
    if (config.mode === "weighted") {
      const norm = rc.roundMax > 0 ? roundFinal / rc.roundMax : 0;
      contribution = rc.weight * norm * config.scale;
    } else {
      contribution = roundFinal;
    }

    totalContribution += contribution;
    breakdown.push({
      roundId: rc.roundId,
      score: fmt(roundFinal),
      max: rc.roundMax,
      status: "scored",
    });
  }

  if (isRankLast) {
    return { entryId: entry.entryId, finalScore: null, roundBreakdown: breakdown, isRankLast: true };
  }

  return {
    entryId: entry.entryId,
    finalScore: totalContribution,
    roundBreakdown: breakdown,
    isRankLast: false,
  };
}

// ── Ranking and tie-break ─────────────────────────────────────────────────────

interface ScoredEntry {
  entry: EntryInput;
  scores: EntryScores;
}

function tieBreakValue(scored: ScoredEntry, token: string): number {
  if (token.startsWith("round_score:")) {
    const roundId = token.slice("round_score:".length);
    const row = scored.scores.roundBreakdown.find((r) => r.roundId === roundId);
    return row?.score != null ? -n(row.score) : Infinity; // descending
  }
  if (token === "total_time_asc") {
    return scored.entry.totalTimeMs ?? Infinity;
  }
  if (token === "last_submit_asc") {
    const ts = scored.entry.lastSubmitAt;
    return ts ? new Date(ts).getTime() : Infinity;
  }
  return 0;
}

function compareEntries(a: ScoredEntry, b: ScoredEntry, config: ResultConfig): number {
  // rank_last entries always sort after non-rank_last
  if (a.scores.isRankLast && !b.scores.isRankLast) return 1;
  if (!a.scores.isRankLast && b.scores.isRankLast) return -1;

  // Primary: final score descending
  const aScore = a.scores.finalScore ?? -Infinity;
  const bScore = b.scores.finalScore ?? -Infinity;
  if (bScore !== aScore) return bScore - aScore;

  // Tie-break chain
  for (const token of config.tieBreak) {
    const av = tieBreakValue(a, token);
    const bv = tieBreakValue(b, token);
    if (av !== bv) return av - bv;
  }

  return 0;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute results for an event.
 *
 * @param inputs - Entries, score records (pre-filtered to non-superseded), config
 * @returns Sorted array of calculated result rows with ranks assigned (1-indexed, ties share rank)
 */
export function computeResults(inputs: ComputeResultsInput): CalculatedResultRow[] {
  const { entries, scoreRecords: records, config } = inputs;

  // Only include non-superseded records (records with supersededBy set are the old/stale ones)
  const active = records.filter((r) => r.supersededBy === null);

  // Withdrawn/disqualified entries are ALWAYS unranked (never get a rank assignment)
  // rankScope: 'active_only' additionally excludes them from the sorted list entirely
  const nonRankable = entries.filter((e) => e.status !== "active");
  const rankable = config.rankScope === "all"
    ? entries // include all but still sort withdrawn/DQ separately below
    : entries.filter((e) => e.status === "active");

  // For scoring purposes, only actually rank the active entries
  const toRank = entries.filter((e) => e.status === "active");

  // Compute per-entry scores for rankable entries
  const scored: ScoredEntry[] = toRank.map((entry) => ({
    entry,
    scores: computeEntryScore(entry, active, config),
  }));

  // Sort using the tie-break chain
  scored.sort((a, b) => compareEntries(a, b, config));

  // Assign ranks (tied entries share rank; next rank skips — 1,2,2,4)
  const results: CalculatedResultRow[] = [];
  let rank = 1;
  let prevFinalScore: number | null | undefined = undefined;
  let prevTieBreakKey = "";
  let sameRankCount = 0;

  for (let i = 0; i < scored.length; i++) {
    const { entry, scores } = scored[i]!;

    const scoreVal = scores.finalScore;
    const tieKey = config.tieBreak.map((t) => tieBreakValue(scored[i]!, t)).join("|");

    const isTiedWithPrev =
      i > 0 &&
      scoreVal === prevFinalScore &&
      tieKey === prevTieBreakKey &&
      !scores.isRankLast;

    if (isTiedWithPrev) {
      sameRankCount++;
    } else {
      rank = rank + sameRankCount;
      sameRankCount = 1;
    }

    prevFinalScore = scoreVal;
    prevTieBreakKey = tieKey;

    // Determine tie status among peers
    let tieStatus: CalculatedResultRow["tieStatus"] = "none";
    if (isTiedWithPrev) {
      tieStatus = "tied_unresolved"; // may be updated to tied_resolved by post-processing
    }

    results.push({
      entryId: entry.entryId,
      finalScore: scores.isRankLast ? null : fmt(scores.finalScore ?? 0),
      rank: scores.isRankLast ? null : rank,
      tieStatus,
      advancementStatus: null, // caller sets advancement after rank
      entryStatus: entry.status,
      statusReason: entry.statusReason ?? null,
      roundBreakdown: scores.roundBreakdown,
    });
  }

  // Mark all tied groups — if any entry shares rank, all in the group are "tied_unresolved"
  const rankGroups = new Map<number, number>();
  for (const r of results) {
    if (r.rank != null) rankGroups.set(r.rank, (rankGroups.get(r.rank) ?? 0) + 1);
  }
  for (const r of results) {
    if (r.rank != null && (rankGroups.get(r.rank) ?? 0) > 1) {
      r.tieStatus = "tied_unresolved";
    }
  }

  // Append withdrawn/disqualified entries (unranked)
  for (const entry of nonRankable) {
    const scores = computeEntryScore(entry, active, config);
    results.push({
      entryId: entry.entryId,
      finalScore: null,
      rank: null,
      tieStatus: "none",
      advancementStatus: null,
      entryStatus: entry.status,
      statusReason: entry.statusReason ?? null,
      roundBreakdown: scores.roundBreakdown,
    });
  }

  return results;
}

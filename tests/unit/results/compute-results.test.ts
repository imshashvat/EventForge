/**
 * tests/unit/results/compute-results.test.ts — M2-C7
 *
 * Golden-file tests for computeResults() (ARCHITECTURE.md §14.6, R-TEST-04).
 * Pure function — no DB, no I/O, fully deterministic.
 *
 * Covers:
 *  - Weighted mode with two rounds
 *  - Sum mode
 *  - missing_round_policy: zero / exclude / rank_last
 *  - Superseded score records are ignored
 *  - Admin adjustments and penalties applied correctly
 *  - Tie-break chain (round_score, total_time_asc, last_submit_asc)
 *  - Dense rank (1,2,2,4 — ties share rank, next rank skips)
 *  - Withdrawn / disqualified entries are unranked
 */
import { describe, it, expect } from "vitest";
import {
  computeResults,
  type ComputeResultsInput,
  type ResultConfig,
  type ScoreRecord,
  type EntryInput,
} from "@/modules/results/compute";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUND_A = "round-aaaaaaaa";
const ROUND_B = "round-bbbbbbbb";

const baseWeightedConfig: ResultConfig = {
  mode: "weighted",
  scale: 100,
  rounds: [
    { roundId: ROUND_A, weight: 0.3, include: true, roundMax: 100 },
    { roundId: ROUND_B, weight: 0.7, include: true, roundMax: 50 },
  ],
  missingRoundPolicy: "zero",
  tieBreak: [],
  rankScope: "active_only",
};

function mkRecord(
  overrides: Partial<ScoreRecord> & { entryId: string; roundId: string; rawScore: string },
): ScoreRecord {
  return {
    id: crypto.randomUUID(),
    source: "quiz_auto",
    finalScore: overrides.rawScore,
    supersededBy: null,
    ...overrides,
  };
}

function mkEntry(entryId: string, overrides: Partial<EntryInput> = {}): EntryInput {
  return { entryId, status: "active", ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeResults — weighted mode", () => {
  it("CR-1: basic two-round weighted result", () => {
    const entries = [mkEntry("e1"), mkEntry("e2")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "80" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "40" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "60" }),
      mkRecord({ entryId: "e2", roundId: ROUND_B, rawScore: "50" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config: baseWeightedConfig });

    // e1: (0.3 * 80/100 + 0.7 * 40/50) * 100 = (0.24 + 0.56)*100 = 80.0000
    // e2: (0.3 * 60/100 + 0.7 * 50/50) * 100 = (0.18 + 0.70)*100 = 88.0000
    const e1 = results.find((r) => r.entryId === "e1")!;
    const e2 = results.find((r) => r.entryId === "e2")!;

    expect(e1.finalScore).toBe("80.0000");
    expect(e2.finalScore).toBe("88.0000");
    expect(e2.rank).toBe(1);
    expect(e1.rank).toBe(2);
  });

  it("CR-2: sum mode", () => {
    const config: ResultConfig = {
      ...baseWeightedConfig,
      mode: "sum",
      rounds: [
        { roundId: ROUND_A, weight: 1, include: true, roundMax: 100 },
        { roundId: ROUND_B, weight: 1, include: true, roundMax: 50 },
      ],
    };
    const entries = [mkEntry("e1"), mkEntry("e2")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "70" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "30" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "50" }),
      mkRecord({ entryId: "e2", roundId: ROUND_B, rawScore: "50" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config });

    const e1 = results.find((r) => r.entryId === "e1")!;
    const e2 = results.find((r) => r.entryId === "e2")!;

    expect(e1.finalScore).toBe("100.0000"); // 70+30
    expect(e2.finalScore).toBe("100.0000"); // 50+50
    // Tied — both rank 1
    expect(e1.rank).toBe(1);
    expect(e2.rank).toBe(1);
    expect(e1.tieStatus).toBe("tied_unresolved");
    expect(e2.tieStatus).toBe("tied_unresolved");
  });
});

describe("computeResults — missing round policy", () => {
  it("CR-3: zero policy — missing round counts as 0", () => {
    const entries = [mkEntry("e1"), mkEntry("e2")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "80" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "40" }),
      // e2 has no score for ROUND_B
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "100" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config: baseWeightedConfig });

    const e2 = results.find((r) => r.entryId === "e2")!;
    // e2: (0.3*100/100 + 0.7*0/50)*100 = 30.0000
    expect(e2.finalScore).toBe("30.0000");
    const roundBBreakdown = e2.roundBreakdown.find((b) => b.roundId === ROUND_B)!;
    expect(roundBBreakdown.status).toBe("unscored");
    expect(roundBBreakdown.score).toBe("0.0000");
  });

  it("CR-4: exclude policy — missing round excluded from sum", () => {
    const config: ResultConfig = { ...baseWeightedConfig, missingRoundPolicy: "exclude", mode: "sum" };
    const entries = [mkEntry("e1")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "50" }),
      // ROUND_B missing
    ];

    const results = computeResults({ entries, scoreRecords: records, config });
    const e1 = results.find((r) => r.entryId === "e1")!;
    // Only ROUND_A counts: 50
    expect(e1.finalScore).toBe("50.0000");
    const bRow = e1.roundBreakdown.find((b) => b.roundId === ROUND_B)!;
    expect(bRow.status).toBe("excluded");
  });

  it("CR-5: rank_last policy — entry with missing round has rank=null", () => {
    const config: ResultConfig = { ...baseWeightedConfig, missingRoundPolicy: "rank_last" };
    const entries = [mkEntry("e1"), mkEntry("e2")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "80" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "40" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "90" }),
      // e2 missing ROUND_B → rank_last
    ];

    const results = computeResults({ entries, scoreRecords: records, config });

    const e1 = results.find((r) => r.entryId === "e1")!;
    const e2 = results.find((r) => r.entryId === "e2")!;

    expect(e1.rank).toBe(1);
    expect(e2.rank).toBeNull(); // rank_last → null
  });
});

describe("computeResults — superseded records", () => {
  it("CR-6: superseded records are ignored", () => {
    const oldId = "old-score-id";
    const newId = "new-score-id";
    const entries = [mkEntry("e1")];
    const records: ScoreRecord[] = [
      { ...mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "20" }), id: oldId, supersededBy: newId },
      { ...mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "90" }), id: newId, supersededBy: null },
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "50" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config: baseWeightedConfig });
    const e1 = results.find((r) => r.entryId === "e1")!;

    // Should use new score=90 not old=20
    // (0.3*90/100 + 0.7*50/50)*100 = (0.27 + 0.70)*100 = 97.0000
    expect(e1.finalScore).toBe("97.0000");
  });
});

describe("computeResults — adjustments and penalties", () => {
  it("CR-7: admin_adjust adds to base score", () => {
    const entries = [mkEntry("e1")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "60", source: "quiz_auto" }),
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "10", source: "admin_adjust" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "50", source: "quiz_auto" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config: baseWeightedConfig });
    const e1 = results.find((r) => r.entryId === "e1")!;

    // round_final_A = 60 + 10 = 70
    // (0.3*70/100 + 0.7*50/50)*100 = (0.21+0.70)*100 = 91.0000
    expect(e1.finalScore).toBe("91.0000");
  });

  it("CR-8: penalty deducts from base score", () => {
    const entries = [mkEntry("e1")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "100", source: "quiz_auto" }),
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "15", source: "penalty" }),
      mkRecord({ entryId: "e1", roundId: ROUND_B, rawScore: "50", source: "quiz_auto" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config: baseWeightedConfig });
    const e1 = results.find((r) => r.entryId === "e1")!;

    // round_final_A = 100 - 15 = 85
    // (0.3*85/100 + 0.7*50/50)*100 = (0.255+0.70)*100 = 95.5000
    expect(e1.finalScore).toBe("95.5000");
  });
});

describe("computeResults — tie-break chain", () => {
  it("CR-9: total_time_asc breaks ties (lower time → higher rank)", () => {
    const config: ResultConfig = {
      ...baseWeightedConfig,
      mode: "sum",
      tieBreak: ["total_time_asc"],
      rounds: [{ roundId: ROUND_A, weight: 1, include: true, roundMax: 100 }],
    };
    const entries: EntryInput[] = [
      { entryId: "e1", status: "active", totalTimeMs: 5000 },
      { entryId: "e2", status: "active", totalTimeMs: 3000 }, // faster → rank 1
    ];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "80" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "80" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config });
    const e1 = results.find((r) => r.entryId === "e1")!;
    const e2 = results.find((r) => r.entryId === "e2")!;

    expect(e2.rank).toBe(1);
    expect(e1.rank).toBe(2);
  });

  it("CR-10: last_submit_asc breaks ties (earlier submit → higher rank)", () => {
    const config: ResultConfig = {
      ...baseWeightedConfig,
      mode: "sum",
      tieBreak: ["last_submit_asc"],
      rounds: [{ roundId: ROUND_A, weight: 1, include: true, roundMax: 100 }],
    };
    const entries: EntryInput[] = [
      { entryId: "e1", status: "active", lastSubmitAt: "2026-10-01T12:00:00Z" },
      { entryId: "e2", status: "active", lastSubmitAt: "2026-10-01T11:00:00Z" }, // earlier → rank 1
    ];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "90" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "90" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config });

    expect(results.find((r) => r.entryId === "e2")!.rank).toBe(1);
    expect(results.find((r) => r.entryId === "e1")!.rank).toBe(2);
  });
});

describe("computeResults — withdrawn and disqualified", () => {
  it("CR-11: withdrawn entries have rank=null and entryStatus=withdrawn", () => {
    const config: ResultConfig = { ...baseWeightedConfig, rankScope: "all" };
    const entries: EntryInput[] = [
      mkEntry("e1"),
      { entryId: "e2", status: "withdrawn", statusReason: "Requested withdrawal" },
    ];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "80" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config });

    const e2 = results.find((r) => r.entryId === "e2")!;
    expect(e2.rank).toBeNull();
    expect(e2.entryStatus).toBe("withdrawn");
    expect(e2.statusReason).toBe("Requested withdrawal");
  });

  it("CR-12: disqualified entry rank=null, active entries ranked normally", () => {
    const config: ResultConfig = { ...baseWeightedConfig, rankScope: "active_only" };
    const entries: EntryInput[] = [
      mkEntry("e1"),
      mkEntry("e2"),
      { entryId: "e3", status: "disqualified", statusReason: "Plagiarism" },
    ];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "70" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "90" }),
      mkRecord({ entryId: "e3", roundId: ROUND_A, rawScore: "100" }), // irrelevant, unranked
    ];

    const results = computeResults({ entries, scoreRecords: records, config });

    expect(results.find((r) => r.entryId === "e3")!.rank).toBeNull();
    expect(results.find((r) => r.entryId === "e2")!.rank).toBe(1);
    expect(results.find((r) => r.entryId === "e1")!.rank).toBe(2);
  });
});

describe("computeResults — dense rank skipping", () => {
  it("CR-13: tied entries share rank; next rank skips correctly (1,2,2,4)", () => {
    const config: ResultConfig = {
      ...baseWeightedConfig,
      mode: "sum",
      rounds: [{ roundId: ROUND_A, weight: 1, include: true, roundMax: 100 }],
      tieBreak: [],
    };
    const entries = [mkEntry("e1"), mkEntry("e2"), mkEntry("e3"), mkEntry("e4")];
    const records: ScoreRecord[] = [
      mkRecord({ entryId: "e1", roundId: ROUND_A, rawScore: "100" }),
      mkRecord({ entryId: "e2", roundId: ROUND_A, rawScore: "80" }),  // tied for rank 2
      mkRecord({ entryId: "e3", roundId: ROUND_A, rawScore: "80" }),  // tied for rank 2
      mkRecord({ entryId: "e4", roundId: ROUND_A, rawScore: "60" }),
    ];

    const results = computeResults({ entries, scoreRecords: records, config });
    const ranked = results.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!);

    expect(ranked[0]?.rank).toBe(1); // e1
    expect(ranked[1]?.rank).toBe(2); // e2 or e3
    expect(ranked[2]?.rank).toBe(2); // e2 or e3
    expect(ranked[3]?.rank).toBe(4); // e4 — skips rank 3
  });
});

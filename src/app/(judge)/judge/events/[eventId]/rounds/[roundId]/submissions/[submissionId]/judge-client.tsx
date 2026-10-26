/**
 * Judge workspace — score a submission against an evaluation rubric.
 *
 * Route: /judge/events/[eventId]/rounds/[roundId]/submissions/[submissionId]
 *
 * Architecture:
 *   - Server Component loads rubric + submission details
 *   - JudgeClient handles criterion scoring with real-time score preview
 *   - Submit fires POST /api/v1/judging/evaluations
 *
 * ARCHITECTURE.md §13: "judges see only assigned items (BR-19)"
 */
"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, AlertBanner } from "@/components/ui/input";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Criterion {
  id: string;
  label: string;
  description: string;
  maxPoints: number;
  weight: number; // 0-1, sums to 1 across criteria
}

interface JudgeClientProps {
  evaluationId: string;          // judging_assignment id
  submissionId: string;
  participantName: string;
  submissionBody: string;        // markdown / code / URL
  rubricTitle: string;
  criteria: Criterion[];
  totalMaxPoints: number;
  /** Existing scores if re-visiting a draft */
  existingScores?: Record<string, number>;
}

// ── Criterion row ─────────────────────────────────────────────────────────────

function CriterionRow({
  criterion,
  score,
  onChange,
  disabled,
}: {
  criterion: Criterion;
  score: number | undefined;
  onChange: (val: number) => void;
  disabled: boolean;
}) {
  const isSet = score !== undefined;
  const pct = isSet ? score / criterion.maxPoints : 0;
  const barColor = pct >= 0.75 ? "var(--success)" : pct >= 0.4 ? "var(--warning)" : "var(--error)";

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        background: "var(--surface-2)",
        borderColor: isSet ? "color-mix(in srgb, var(--teal-500) 25%, transparent)" : "var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p
            className="font-medium text-sm mb-0.5"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
          >
            {criterion.label}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {criterion.description}
          </p>
        </div>
        <span
          className="text-xs shrink-0 tabular-nums"
          style={{ color: "var(--text-secondary)" }}
        >
          max {criterion.maxPoints} pts
        </span>
      </div>

      {/* Score input + bar */}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={criterion.maxPoints}
          step={1}
          value={score ?? 0}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--teal-500)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`${criterion.label} score`}
          aria-valuenow={score ?? 0}
          aria-valuemax={criterion.maxPoints}
        />
        <div
          className="num text-sm font-bold tabular-nums w-12 text-right shrink-0"
          style={{ color: isSet ? "var(--text-primary)" : "var(--text-disabled)" }}
        >
          {score ?? "—"}/{criterion.maxPoints}
        </div>
      </div>

      {isSet && (
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: "var(--surface-3)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct * 100}%`, background: barColor }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main judge client ─────────────────────────────────────────────────────────

export function JudgeClient({
  evaluationId,
  submissionId,
  participantName,
  submissionBody,
  rubricTitle,
  criteria,
  totalMaxPoints,
  existingScores = {},
}: JudgeClientProps) {
  const [scores, setScores] = useState<Record<string, number>>(existingScores);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCriteriaScored = criteria.every((c) => scores[c.id] !== undefined);

  const totalScore = useMemo(() => {
    return criteria.reduce((sum, c) => sum + (scores[c.id] ?? 0), 0);
  }, [scores, criteria]);

  const pct = totalMaxPoints > 0 ? Math.round((totalScore / totalMaxPoints) * 100) : 0;

  function setScore(criterionId: string, val: number) {
    setScores((prev) => ({ ...prev, [criterionId]: val }));
  }

  async function handleSubmit() {
    if (!allCriteriaScored || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/judging/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluationId,
          submissionId,
          scores: criteria.map((c) => ({
            criterionId: c.id,
            score: scores[c.id]!,
            maxScore: c.maxPoints,
          })),
          notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error ?? "Failed to submit evaluation");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{
              background: "color-mix(in srgb, var(--success) 12%, transparent)",
              color: "var(--success)",
            }}
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2
            className="text-lg font-bold mb-1"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Evaluation submitted
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Score: <strong style={{ color: "var(--teal-500)" }}>{totalScore}/{totalMaxPoints}</strong> ({pct}%)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* ── Left: Submission ────────────────────────────────────── */}
      <div className="lg:w-5/12 shrink-0 flex flex-col gap-4">
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            Participant
          </p>
          <p
            className="font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {participantName}
          </p>
        </div>

        <div
          className="rounded-2xl border flex-1 overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--border)" }}
          >
            <p
              className="text-sm font-medium"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
            >
              Submission
            </p>
          </div>
          <div className="p-4 overflow-y-auto max-h-[60vh]">
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}
            >
              {submissionBody}
            </pre>
          </div>
        </div>
      </div>

      {/* ── Right: Rubric + scoring ─────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Rubric header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs mb-0.5" style={{ color: "var(--text-secondary)" }}>
              Rubric
            </p>
            <p
              className="font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              {rubricTitle}
            </p>
          </div>

          {/* Score preview */}
          <div
            className="rounded-xl border px-4 py-2 text-center"
            style={{
              background: "var(--surface-2)",
              borderColor: "var(--border)",
            }}
          >
            <p
              className="num text-2xl font-bold tabular-nums"
              style={{ color: "var(--teal-500)" }}
            >
              {totalScore}
              <span
                className="text-sm font-normal ml-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                /{totalMaxPoints}
              </span>
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {pct}%
            </p>
          </div>
        </div>

        {/* Criteria */}
        <div className="flex flex-col gap-3">
          {criteria.map((criterion) => (
            <CriterionRow
              key={criterion.id}
              criterion={criterion}
              score={scores[criterion.id]}
              onChange={(val) => setScore(criterion.id, val)}
              disabled={isSubmitting}
            />
          ))}
        </div>

        {/* Judge notes */}
        <div>
          <label
            className="text-sm font-medium block mb-1.5"
            style={{ color: "var(--text-primary)" }}
          >
            Judge notes <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>(optional)</span>
          </label>
          <Textarea
            id="judge-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add your reasoning, feedback, or notes for this evaluation…"
            disabled={isSubmitting}
            rows={3}
          />
        </div>

        {error && <AlertBanner type="error">{error}</AlertBanner>}

        <div className="flex items-center gap-3 flex-wrap mt-auto pt-2">
          {!allCriteriaScored && (
            <p className="text-xs flex-1" style={{ color: "var(--text-secondary)" }}>
              Score all {criteria.length} criteria to submit.
            </p>
          )}
          <Button
            id="judge-submit"
            variant="primary"
            size="md"
            loading={isSubmitting}
            loadingText="Submitting…"
            disabled={!allCriteriaScored}
            onClick={() => void handleSubmit()}
            className="ml-auto"
          >
            Submit evaluation
          </Button>
        </div>
      </div>
    </div>
  );
}

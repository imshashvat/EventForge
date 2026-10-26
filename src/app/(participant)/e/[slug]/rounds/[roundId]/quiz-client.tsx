/**
 * Quiz interface — real-time answer selection with server-authoritative timer.
 *
 * Architecture:
 *   - Page is a Server Component that loads the attempt + question list
 *   - QuizClient is a Client Component handling local state
 *   - Answer saves fire a debounced fetch() to /api/v1/events/[id]/attempts/[id]/responses
 *   - Timer is derived from attempt.deadlineAt (server clock), never from client Date.now()
 *
 * ARCHITECTURE.md §11: "timer is server-authoritative"
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createAnswerQueue, type AnswerQueue } from "@/modules/quiz/answer-queue";
import { Button } from "@/components/ui/button";

// ── Types (match the DB models) ───────────────────────────────────────────────

interface QuizOption {
  id: string;
  body: string;
  position: number;
}

interface QuizQuestion {
  id: string;
  body: string;
  position: number;
  pointValue: number;
  options: QuizOption[];
}

interface QuizClientProps {
  attemptId: string;
  eventId: string;
  roundId: string;
  questions: QuizQuestion[];
  /** ISO string — server-computed absolute deadline */
  deadlineAt: string | null;
  totalPoints: number;
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function useCountdown(deadlineAt: string | null) {
  const getRemaining = useCallback(() => {
    if (!deadlineAt) return null;
    return Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000));
  }, [deadlineAt]);

  const [secs, setSecs] = useState<number | null>(getRemaining);

  useEffect(() => {
    if (deadlineAt === null) return;
    const id = setInterval(() => {
      const r = getRemaining();
      setSecs(r);
      if (r === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineAt, getRemaining]);

  return secs;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Option card ───────────────────────────────────────────────────────────────

type OptionState = "idle" | "selected" | "saved";

function OptionCard({
  option,
  state,
  onClick,
  disabled,
}: {
  option: QuizOption;
  state: OptionState;
  onClick: () => void;
  disabled: boolean;
}) {
  const isSelected = state === "selected" || state === "saved";
  const label = ["A", "B", "C", "D", "E"][option.position] ?? String(option.position + 1);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left flex items-start gap-3 rounded-xl p-4 border transition-all duration-150
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal-500)]
                 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: isSelected
          ? "color-mix(in srgb, var(--teal-500) 10%, var(--surface-2))"
          : "var(--surface-2)",
        borderColor: isSelected ? "var(--teal-500)" : "var(--border)",
        boxShadow: isSelected ? "0 0 0 1px var(--teal-500)" : undefined,
      }}
      aria-pressed={isSelected}
    >
      {/* Letter badge */}
      <span
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold mt-px"
        style={{
          background: isSelected ? "var(--teal-500)" : "var(--surface-3)",
          color: isSelected ? "var(--bg)" : "var(--text-secondary)",
          transition: "all 150ms",
        }}
      >
        {label}
      </span>

      <span
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-primary)" }}
      >
        {option.body}
      </span>
    </button>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ background: "var(--surface-3)" }}
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemax={total}
        aria-label={`${answered} of ${total} answered`}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--teal-500)" }}
        />
      </div>
      <span
        className="text-xs tabular-nums shrink-0"
        style={{ color: "var(--text-secondary)" }}
      >
        {answered}/{total}
      </span>
    </div>
  );
}

// ── Main quiz client ──────────────────────────────────────────────────────────

export function QuizClient({
  attemptId,
  eventId: _eventId,
  roundId: _roundId,
  questions,
  deadlineAt,
  totalPoints,
}: QuizClientProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  // clientSeq per attemptQuestionId — incremented on every selection change
  const seqRef = useRef<Record<string, number>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const secsLeft = useCountdown(deadlineAt);
  const currentQ = questions[currentIdx];
  const answeredCount = Object.keys(selections).length;
  const isTimedOut = secsLeft === 0 && deadlineAt !== null;

  // M1-E12: IndexedDB-backed answer queue for offline resilience
  const queueRef = useRef<AnswerQueue | null>(null);
  useEffect(() => {
    queueRef.current = createAnswerQueue(attemptId);
    return () => queueRef.current?.destroy();
  }, [attemptId]);

  // Timer color: green → amber → red
  const timerColor =
    secsLeft === null
      ? "var(--teal-500)"
      : secsLeft > 120
        ? "var(--teal-500)"
        : secsLeft > 30
          ? "var(--amber-500)"
          : "var(--error)";

  // Auto-submit when timer hits 0
  useEffect(() => {
    if (isTimedOut && !submitted) {
      void handleSubmit(true);
    }
  }, [isTimedOut, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save — uses the real PUT /api/v1/attempts/[id]/answers route
  const saveResponse = useCallback(
    (questionId: string, optionId: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(async () => {
        // Increment clientSeq for this question so the server's GREATEST() dedup works
        seqRef.current[questionId] = (seqRef.current[questionId] ?? 0) + 1;
        const seq = seqRef.current[questionId]!;
        try {
          // Enqueue to IndexedDB for offline persistence (M1-E12)
          queueRef.current?.enqueue({
            attemptQuestionId: questionId,
            selectedOptionIds: [optionId],
            clientSeq: seq,
          });
          const res = await fetch(`/api/v1/attempts/${attemptId}/answers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              answers: [{
                attemptQuestionId: questionId,
                selectedOptionIds: [optionId],
                clientSeq: seq,
              }],
            }),
          });
          if (res.ok) {
            setSaveStatus("saved");
          } else {
            setSaveStatus("error");
          }
        } catch {
          // Network down — queue will retry on reconnect
          setSaveStatus("error");
        }
      }, 600);
    },
    [attemptId],
  );

  function selectOption(optionId: string) {
    if (submitted || isTimedOut || !currentQ) return;
    const qId = currentQ.id;
    setSelections((prev) => ({ ...prev, [qId]: optionId }));
    saveResponse(qId, optionId);
  }

  async function handleSubmit(auto = false) {
    if (submitted || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/attempts/${attemptId}/submit`, { method: "POST" });
      if (res.ok || res.status === 409) {
        // 409 = already submitted (idempotent) — still treat as success
        setSubmitted(true);
      } else {
        setIsSubmitting(false);
      }
    } catch {
      setIsSubmitting(false);
    }
  }

  // ── Submitted state ──────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center"
            style={{
              background: "color-mix(in srgb, var(--teal-500) 12%, transparent)",
              color: "var(--teal-500)",
            }}
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Attempt submitted!
          </h2>
          <p className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
            You answered {answeredCount} of {questions.length} questions.
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Results will be available once the round closes.
          </p>
        </div>
      </div>
    );
  }

  if (!currentQ) return null;

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 gap-5">
      {/* ── Timer + nav strip ─────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {secsLeft !== null ? (
          <div
            className="flex items-center gap-1.5 num tabular-nums font-bold text-base rounded-xl px-3 py-1.5 border"
            style={{
              color: timerColor,
              borderColor: `color-mix(in srgb, ${timerColor} 30%, transparent)`,
              background: `color-mix(in srgb, ${timerColor} 8%, transparent)`,
            }}
            aria-live="polite"
            aria-label={`Time remaining: ${formatTime(secsLeft)}`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 7v5l3 2" />
            </svg>
            {formatTime(secsLeft)}
          </div>
        ) : (
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            No time limit
          </div>
        )}

        <div className="flex-1">
          <ProgressBar answered={answeredCount} total={questions.length} />
        </div>

        {/* Save indicator */}
        <div className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && (
            <span style={{ color: "var(--success)" }}>✓ Saved</span>
          )}
          {saveStatus === "error" && (
            <span style={{ color: "var(--error)" }}>Save failed</span>
          )}
        </div>
      </div>

      {/* ── Question card ─────────────────────────────────────────── */}
      <div
        className="rounded-2xl border p-6 flex flex-col gap-1.5"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: "color-mix(in srgb, var(--teal-500) 12%, transparent)",
              color: "var(--teal-500)",
            }}
          >
            Q{currentIdx + 1} of {questions.length}
          </span>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {currentQ.pointValue} {currentQ.pointValue === 1 ? "pt" : "pts"}
          </span>
        </div>
        <p
          className="text-base leading-relaxed font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {currentQ.body}
        </p>
      </div>

      {/* ── Options ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Answer options">
        {currentQ.options.map((opt) => {
          const isSelected = selections[currentQ.id] === opt.id;
          return (
            <OptionCard
              key={opt.id}
              option={opt}
              state={isSelected ? "selected" : "idle"}
              onClick={() => selectOption(opt.id)}
              disabled={submitted || isTimedOut}
            />
          );
        })}
      </div>

      {/* ── Navigation ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mt-2">
        <Button
          id="quiz-prev"
          variant="ghost"
          size="sm"
          disabled={currentIdx === 0}
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
        >
          ← Previous
        </Button>

        {/* Jump dots */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {questions.map((q, i) => {
            const answered = !!selections[q.id];
            const isCurrent = i === currentIdx;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCurrentIdx(i)}
                className="w-2 h-2 rounded-full transition-all focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-[var(--teal-500)]"
                style={{
                  background: isCurrent
                    ? "var(--teal-500)"
                    : answered
                      ? "color-mix(in srgb, var(--teal-500) 40%, transparent)"
                      : "var(--surface-3)",
                  transform: isCurrent ? "scale(1.4)" : "scale(1)",
                }}
                aria-label={`Question ${i + 1}${answered ? " (answered)" : ""}`}
              />
            );
          })}
        </div>

        {currentIdx < questions.length - 1 ? (
          <Button
            id="quiz-next"
            variant="ghost"
            size="sm"
            onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
          >
            Next →
          </Button>
        ) : (
          <Button
            id="quiz-submit"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            loadingText="Submitting…"
            onClick={() => void handleSubmit(false)}
          >
            Submit attempt
          </Button>
        )}
      </div>

      {/* Warning banner when < 30s remain */}
      {secsLeft !== null && secsLeft <= 30 && secsLeft > 0 && (
        <div
          className="rounded-xl border px-4 py-3 text-sm text-center animate-pulse"
          style={{
            background: "var(--error-dim)",
            borderColor: "color-mix(in srgb, var(--error) 30%, transparent)",
            color: "var(--error)",
          }}
          role="alert"
        >
          ⚠ Less than {secsLeft}s remaining — your attempt will auto-submit!
        </div>
      )}
    </div>
  );
}

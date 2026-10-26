"use client";

/**
 * Question bank + question authoring client — M1-E10
 *
 * Manages:
 *  - Creating / selecting a question bank
 *  - Creating questions (single_choice, multi_choice, true_false, short_text)
 *  - Listing existing questions in a bank
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionType = "single_choice" | "multi_choice" | "true_false" | "short_text";
type Difficulty = "easy" | "medium" | "hard";

interface QuestionBank { id: string; name: string; description?: string | null }
interface QuestionRow {
  id: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  tags: string[];
  createdAt: string;
}

interface OptionDraft {
  optionText: string;
  isCorrect: boolean;
  displayOrder: number;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  true_false: "True / False",
  short_text: "Short text",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultOptions(type: QuestionType): OptionDraft[] {
  if (type === "true_false") {
    return [
      { optionText: "True", isCorrect: true, displayOrder: 1 },
      { optionText: "False", isCorrect: false, displayOrder: 2 },
    ];
  }
  if (type === "short_text") return [];
  return [
    { optionText: "", isCorrect: true, displayOrder: 1 },
    { optionText: "", isCorrect: false, displayOrder: 2 },
  ];
}

// ── Main component ─────────────────────────────────────────────────────────────

export function QuestionAuthoringClient({ eventId }: { eventId: string }) {
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [selectedBank, setSelectedBank] = useState<QuestionBank | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [showNewBank, setShowNewBank] = useState(false);
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bank form
  const [bankName, setBankName] = useState("");
  const [bankDesc, setBankDesc] = useState("");

  // Question form
  const [qType, setQType] = useState<QuestionType>("single_choice");
  const [stem, setStem] = useState("");
  const [marks, setMarks] = useState("1");
  const [negMarks, setNegMarks] = useState("0");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [options, setOptions] = useState<OptionDraft[]>(defaultOptions("single_choice"));
  const [acceptedAnswers, setAcceptedAnswers] = useState("");
  const [tags, setTags] = useState("");

  // Load banks
  const loadBanks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/question-banks`);
      const data = await res.json() as { banks?: QuestionBank[] };
      setBanks(data.banks ?? []);
      if (data.banks && data.banks.length > 0 && !selectedBank) {
        setSelectedBank(data.banks[0]!);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [eventId, selectedBank]);

  // Load questions for selected bank
  const loadQuestions = useCallback(async () => {
    if (!selectedBank) return;
    try {
      const res = await fetch(`/api/v1/question-banks/${selectedBank.id}/questions`);
      const data = await res.json() as { questions?: QuestionRow[] };
      setQuestions(data.questions ?? []);
    } catch { /* ignore */ }
  }, [selectedBank]);

  useEffect(() => { void loadBanks(); }, [loadBanks]);
  useEffect(() => { void loadQuestions(); }, [loadQuestions]);

  // Sync options when type changes
  useEffect(() => {
    setOptions(defaultOptions(qType));
  }, [qType]);

  // ── Create bank ──────────────────────────────────────────────────────────────

  async function handleCreateBank(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/question-banks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bankName.trim(), description: bankDesc.trim() || undefined }),
      });
      const data = await res.json() as { bank?: QuestionBank; error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to create bank"); return; }
      setBankName(""); setBankDesc(""); setShowNewBank(false);
      await loadBanks();
      if (data.bank) setSelectedBank(data.bank);
    } finally { setSaving(false); }
  }

  // ── Create question ──────────────────────────────────────────────────────────

  async function handleCreateQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBank) return;
    setSaving(true); setError(null);

    const body = {
      questionType: qType,
      stem: stem.trim(),
      marks,
      negMarks,
      difficulty,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      options: qType !== "short_text" ? options : undefined,
      acceptedAnswers: qType === "short_text"
        ? acceptedAnswers.split("\n").map((a) => a.trim()).filter(Boolean)
        : undefined,
    };

    try {
      const res = await fetch(`/api/v1/question-banks/${selectedBank.id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to create question"); return; }
      setStem(""); setMarks("1"); setNegMarks("0"); setTags(""); setAcceptedAnswers("");
      setOptions(defaultOptions(qType)); setShowNewQuestion(false);
      await loadQuestions();
    } finally { setSaving(false); }
  }

  // ── Option helpers ────────────────────────────────────────────────────────────

  function updateOption(idx: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, ...patch } : o));
  }

  function addOption() {
    setOptions((prev) => [
      ...prev,
      { optionText: "", isCorrect: false, displayOrder: prev.length + 1 },
    ]);
  }

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx).map((o, i) => ({ ...o, displayOrder: i + 1 })));
  }

  function toggleCorrect(idx: number) {
    if (qType === "single_choice" || qType === "true_false") {
      setOptions((prev) => prev.map((o, i) => ({ ...o, isCorrect: i === idx })));
    } else {
      updateOption(idx, { isCorrect: !options[idx]!.isCorrect });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="py-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="flex gap-6 min-h-0">
      {/* ── Left: Bank sidebar ── */}
      <aside className="w-56 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-disabled)" }}>
            Banks
          </span>
          <button
            className="text-xs hover:opacity-80"
            style={{ color: "var(--teal-500)" }}
            onClick={() => setShowNewBank(true)}
          >
            + New
          </button>
        </div>

        {banks.length === 0 && !showNewBank && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            No banks yet.
          </p>
        )}

        {banks.map((bank) => (
          <button
            key={bank.id}
            onClick={() => { setSelectedBank(bank); setShowNewQuestion(false); }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: selectedBank?.id === bank.id ? "var(--surface-3)" : "transparent",
              color: selectedBank?.id === bank.id ? "var(--text-primary)" : "var(--text-secondary)",
              border: `1px solid ${selectedBank?.id === bank.id ? "var(--border-strong)" : "transparent"}`,
            }}
          >
            {bank.name}
          </button>
        ))}

        {/* New bank form */}
        {showNewBank && (
          <form onSubmit={(e) => void handleCreateBank(e)} className="flex flex-col gap-2 mt-1">
            <input
              className="form-input text-xs"
              placeholder="Bank name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              required
              maxLength={120}
            />
            <input
              className="form-input text-xs"
              placeholder="Description (optional)"
              value={bankDesc}
              onChange={(e) => setBankDesc(e.target.value)}
              maxLength={500}
            />
            <div className="flex gap-1">
              <Button type="submit" size="sm" variant="primary" loading={saving}>Create</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewBank(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </aside>

      {/* ── Right: Question list + editor ── */}
      <div className="flex-1 min-w-0">
        {!selectedBank ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            Select or create a question bank to get started.
          </div>
        ) : (
          <>
            {/* Bank header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                  {selectedBank.name}
                </h2>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {questions.length} question{questions.length !== 1 ? "s" : ""}
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => setShowNewQuestion(true)}>
                + Add question
              </Button>
            </div>

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: "var(--error-dim)", color: "var(--error)" }}>
                {error}
              </div>
            )}

            {/* New question form */}
            {showNewQuestion && (
              <form
                onSubmit={(e) => void handleCreateQuestion(e)}
                className="rounded-xl border p-5 mb-5 flex flex-col gap-4"
                style={{ background: "var(--surface-2)", borderColor: "var(--teal-700)" }}
              >
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  New question
                </h3>

                {/* Type + Difficulty + Marks row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Type</label>
                    <select
                      className="form-input text-sm"
                      value={qType}
                      onChange={(e) => setQType(e.target.value as QuestionType)}
                    >
                      {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                        <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Difficulty</label>
                    <select
                      className="form-input text-sm"
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Marks</label>
                      <input className="form-input text-sm" value={marks} onChange={(e) => setMarks(e.target.value)} pattern="\d+(\.\d{1,4})?" required />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Neg.</label>
                      <input className="form-input text-sm" value={negMarks} onChange={(e) => setNegMarks(e.target.value)} pattern="\d+(\.\d{1,4})?" />
                    </div>
                  </div>
                </div>

                {/* Stem */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Question stem *</label>
                  <textarea
                    className="form-input resize-y text-sm"
                    rows={3}
                    value={stem}
                    onChange={(e) => setStem(e.target.value)}
                    required
                    maxLength={5000}
                    placeholder="Enter the question text…"
                  />
                </div>

                {/* Options — for choice types */}
                {qType !== "short_text" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Options (✓ = correct)
                    </label>
                    {options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCorrect(idx)}
                          className="w-5 h-5 rounded border shrink-0 transition-colors"
                          title="Mark as correct"
                          style={{
                            background: opt.isCorrect ? "var(--success)" : "var(--surface-3)",
                            borderColor: opt.isCorrect ? "var(--success)" : "var(--border)",
                          }}
                          aria-label={`Option ${idx + 1} correct: ${opt.isCorrect}`}
                        />
                        <input
                          className="form-input text-sm flex-1"
                          value={opt.optionText}
                          onChange={(e) => updateOption(idx, { optionText: e.target.value })}
                          placeholder={`Option ${idx + 1}`}
                          required={qType !== "true_false"}
                          disabled={qType === "true_false"}
                        />
                        {qType === "multi_choice" && options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOption(idx)}
                            className="text-xs shrink-0"
                            style={{ color: "var(--error)" }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    {qType === "multi_choice" && (
                      <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                        + Add option
                      </Button>
                    )}
                  </div>
                )}

                {/* Accepted answers — for short_text */}
                {qType === "short_text" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Accepted answers (one per line, case-insensitive)
                    </label>
                    <textarea
                      className="form-input resize-y text-sm"
                      rows={3}
                      value={acceptedAnswers}
                      onChange={(e) => setAcceptedAnswers(e.target.value)}
                      placeholder={"answer one\nanother valid answer"}
                    />
                  </div>
                )}

                {/* Tags */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Tags (comma-separated, optional)
                  </label>
                  <input
                    className="form-input text-sm"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="e.g. arrays, sorting, greedy"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" size="sm" loading={saving} loadingText="Saving…">
                    Save question
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewQuestion(false); setError(null); }}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* Question list */}
            {questions.length === 0 && !showNewQuestion ? (
              <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                No questions yet in this bank.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="rounded-xl border px-4 py-3 flex items-center gap-3"
                    style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
                  >
                    <span className="text-xs w-6 text-right shrink-0" style={{ color: "var(--text-disabled)" }}>
                      {idx + 1}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                    >
                      {TYPE_LABELS[q.questionType]}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {q.difficulty}
                    </span>
                    {q.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {q.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: "color-mix(in srgb, var(--teal-700) 25%, transparent)", color: "var(--teal-300)" }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="flex-1" />
                    <span className="text-xs" style={{ color: "var(--text-disabled)" }}>
                      {new Date(q.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

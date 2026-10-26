/**
 * Challenge round client — /e/[slug]/rounds/[roundId] (challenge type)
 *
 * Participant submits a URL (GitHub, demo, video) for a challenge task.
 * Flow: startChallenge → saveDraft (auto every 30s + on change) → submit
 * Deadline is server-authoritative (from challengeStart.deadlineAt).
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface ChallengeTask {
  id: string;
  title: string;
  description: string;
  allowedUrlTypes: string[];
  maxRevisions: number | null;
}

interface ChallengeClientProps {
  eventId: string;
  roundId: string;
  taskId: string;
  entryId: string;
  task: ChallengeTask;
  deadlineAt: string | null;
  initialUrls?: Record<string, string>;
  initialStatus?: "draft" | "submitted";
  revisionCount?: number;
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function useCountdown(deadlineAt: string | null) {
  const getRemaining = useCallback(() => {
    if (!deadlineAt) return null;
    return Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000));
  }, [deadlineAt]);

  const [secs, setSecs] = useState<number | null>(getRemaining);

  useEffect(() => {
    if (!deadlineAt) return;
    const id = setInterval(() => {
      const r = getRemaining();
      setSecs(r);
      if (r === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineAt, getRemaining]);

  return secs;
}

function formatTime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ChallengeClient({
  eventId,
  roundId,
  taskId,
  entryId,
  task,
  deadlineAt,
  initialUrls = {},
  initialStatus = "draft",
  revisionCount = 0,
}: ChallengeClientProps) {
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls);
  const [status, setStatus] = useState<"draft" | "submitted" | "submitting">(initialStatus);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [revisions, setRevisions] = useState(revisionCount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const secsLeft = useCountdown(deadlineAt);
  const isTimedOut = secsLeft === 0 && deadlineAt !== null;
  const isLocked = status === "submitted" || isTimedOut;

  const timerColor =
    secsLeft === null ? "var(--teal)" :
    secsLeft > 300 ? "var(--teal)" :
    secsLeft > 60 ? "var(--amber, #f59e0b)" :
    "var(--error)";

  // ── Draft save ────────────────────────────────────────────────────────────

  const saveDraft = useCallback(async (currentUrls: Record<string, string>) => {
    setSaveState("saving");
    try {
      const res = await fetch(
        `/api/v1/events/${eventId}/rounds/${roundId}/challenges/${taskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, urls: currentUrls, action: "draft" }),
        },
      );
      if (res.ok) {
        const data = await res.json() as { revisionNo?: number };
        setSaveState("saved");
        if (data.revisionNo) setRevisions(data.revisionNo);
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }, [eventId, roundId, taskId, entryId]);

  function onUrlChange(field: string, value: string) {
    const next = { ...urls, [field]: value };
    setUrls(next);
    setSaveState("idle");
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => void saveDraft(next), 2000);
  }

  // Auto-save every 30s
  useEffect(() => {
    if (isLocked) return;
    const id = setInterval(() => void saveDraft(urls), 30_000);
    return () => clearInterval(id);
  }, [isLocked, saveDraft, urls]);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (isLocked || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/v1/events/${eventId}/rounds/${roundId}/challenges/${taskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, urls, action: "submit" }),
        },
      );
      if (res.ok || res.status === 409) {
        setStatus("submitted");
      } else {
        setIsSubmitting(false);
      }
    } catch {
      setIsSubmitting(false);
    }
  }

  // ── Submitted state ───────────────────────────────────────────────────────

  if (status === "submitted") {
    return (
      <div className="ch-submitted">
        <div className="ch-submitted-icon">✅</div>
        <h2 className="ch-submitted-title">Submission received!</h2>
        <p className="ch-submitted-desc">
          Your challenge submission has been recorded ({revisions} revision{revisions !== 1 ? "s" : ""}).
          Judges will review your submission after the round closes.
        </p>
      </div>
    );
  }

  const urlTypes = task.allowedUrlTypes.length > 0
    ? task.allowedUrlTypes
    : ["githubUrl", "demoUrl", "videoUrl"];

  const urlLabels: Record<string, string> = {
    githubUrl: "GitHub Repository",
    demoUrl: "Live Demo URL",
    videoUrl: "Demo Video URL",
  };

  const urlPlaceholders: Record<string, string> = {
    githubUrl: "https://github.com/username/repo",
    demoUrl: "https://your-demo.vercel.app",
    videoUrl: "https://youtu.be/...",
  };

  return (
    <div className="ch-page">
      {/* Timer strip */}
      <div className="ch-timer-strip">
        {secsLeft !== null ? (
          <span className="ch-timer" style={{ color: timerColor }}>
            ⏱ {formatTime(secsLeft)} remaining
          </span>
        ) : (
          <span className="ch-timer" style={{ color: "var(--text-3)" }}>No time limit</span>
        )}
        <span className="ch-save-status">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && <span style={{ color: "var(--success)" }}>✓ Draft saved (rev {revisions})</span>}
          {saveState === "error" && <span style={{ color: "var(--error)" }}>Save failed — retrying</span>}
        </span>
      </div>

      {/* Task description */}
      <div className="ch-task-card">
        <h2 className="ch-task-title">{task.title}</h2>
        <div
          className="ch-task-desc"
          dangerouslySetInnerHTML={{ __html: task.description.replace(/\n/g, "<br>") }}
        />
        {task.maxRevisions && (
          <p className="ch-task-meta">
            Max revisions: {task.maxRevisions} · Used: {revisions}
          </p>
        )}
      </div>

      {/* Timeout warning */}
      {isTimedOut && (
        <div className="ch-timeout-banner" role="alert">
          ⚠ Time&apos;s up — submission window closed.
        </div>
      )}

      {/* URL fields */}
      <div className="ch-urls">
        {urlTypes.map(field => (
          <div key={field} className="ch-url-group">
            <label className="ch-url-label" htmlFor={`ch-url-${field}`}>
              {urlLabels[field] ?? field}
            </label>
            <input
              id={`ch-url-${field}`}
              type="url"
              className="ch-url-input"
              value={urls[field] ?? ""}
              onChange={e => onUrlChange(field, e.target.value)}
              placeholder={urlPlaceholders[field] ?? "https://"}
              disabled={isLocked}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      {!isTimedOut && (
        <div className="ch-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void saveDraft(urls)}
            disabled={isLocked}
          >
            Save draft
          </Button>
          <Button
            id="ch-submit"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            loadingText="Submitting…"
            onClick={() => void handleSubmit()}
            disabled={isLocked || Object.values(urls).every(v => !v.trim())}
          >
            Submit challenge
          </Button>
        </div>
      )}

      <style>{`
        .ch-page { max-width: 640px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); display: flex; flex-direction: column; gap: var(--space-5); }
        .ch-timer-strip { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
        .ch-timer { font-size: var(--text-sm); font-variant-numeric: tabular-nums; font-weight: 700; }
        .ch-save-status { font-size: var(--text-xs); color: var(--text-3); }
        .ch-task-card { border: 1px solid var(--border); padding: var(--space-5); background: var(--surface-1); }
        .ch-task-title { font-family: Georgia, serif; font-size: var(--text-xl); font-weight: 400; color: var(--text-1); margin: 0 0 var(--space-3); }
        .ch-task-desc { font-size: var(--text-sm); color: var(--text-2); line-height: 1.7; }
        .ch-task-meta { font-size: var(--text-xs); color: var(--text-3); margin-top: var(--space-3); border-top: 1px solid var(--border); padding-top: var(--space-3); }
        .ch-timeout-banner { padding: var(--space-3) var(--space-4); border: 1px solid var(--error); color: var(--error); font-size: var(--text-sm); text-align: center; }
        .ch-urls { display: flex; flex-direction: column; gap: var(--space-4); }
        .ch-url-group { display: flex; flex-direction: column; gap: var(--space-2); }
        .ch-url-label { font-size: var(--text-sm); font-weight: 500; color: var(--text-1); letter-spacing: 0.02em; }
        .ch-url-input { width: 100%; padding: var(--space-3) var(--space-3); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-1); font-size: var(--text-sm); font-family: var(--font-mono, monospace); outline: none; transition: border-color 0.15s; box-sizing: border-box; }
        .ch-url-input:focus { border-color: var(--teal); }
        .ch-url-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .ch-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); }
        .ch-submitted { text-align: center; padding: var(--space-16) var(--space-8); }
        .ch-submitted-icon { font-size: 3rem; margin-bottom: var(--space-4); }
        .ch-submitted-title { font-family: Georgia, serif; font-size: var(--text-2xl); font-weight: 400; color: var(--text-1); margin: 0 0 var(--space-3); }
        .ch-submitted-desc { font-size: var(--text-sm); color: var(--text-2); max-width: 400px; margin: 0 auto; line-height: 1.6; }
      `}</style>
    </div>
  );
}

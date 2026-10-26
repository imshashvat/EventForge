"use client";

/**
 * LeaderboardClient — /events/[slug]/leaderboard
 *
 * Live polling implementation (ARCHITECTURE.md §15.3):
 *  - Poll every 15 s ± 20% jitter
 *  - If-None-Match: ETag → 304 stops body parse
 *  - Back off to 30 s after 3 consecutive 304s
 *  - Pause when document is hidden (Page Visibility API)
 *  - Stale banner if data is > 30 s old
 *  - Shows own rank with "You" badge (isMe flag from API)
 */

import { useEffect, useRef, useCallback, useState } from "react";

interface LeaderboardEntry {
  rank: number;
  entryCode: string;
  displayName: string;
  teamName: string | null;
  finalScore: string;
  roundScores: Record<string, string>;
  tied: boolean;
  isMe?: boolean;
}

interface Snapshot {
  eventId: string;
  scope: string;
  version: number;
  generatedAt: string;
  provisional: boolean;
  etag: string;
  entries: LeaderboardEntry[];
}

interface Props {
  eventId: string;
  eventName: string;
  initialScope?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jitter(ms: number): number {
  // ±20% jitter per ARCHITECTURE.md §15.3
  const variance = ms * 0.2;
  return ms - variance + Math.random() * variance * 2;
}

// ── Rank badge ────────────────────────────────────────────────────────────────

function RankDisplay({ rank }: { rank: number }) {
  const podium: Record<number, { label: string; color: string }> = {
    1: { label: "1st", color: "var(--gold)" },
    2: { label: "2nd", color: "var(--silver)" },
    3: { label: "3rd", color: "var(--bronze)" },
  };
  const p = podium[rank];
  return (
    <span
      className="text-[14px] tabular-nums inline-block w-8 text-center"
      style={{ color: p?.color ?? "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
    >
      {p?.label ?? `#${rank}`}
    </span>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      className="flex items-center gap-4 py-3 border-b border-[var(--border)]"
      style={{
        background: entry.isMe
          ? "color-mix(in srgb, var(--brand) 6%, transparent)"
          : "transparent",
      }}
    >
      <RankDisplay rank={entry.rank} />

      <div className="flex-1 min-w-0">
        <span
          className="text-[16px] truncate block"
          style={{ color: "var(--text)" }}
        >
          {entry.displayName}
          {entry.isMe && (
            <span className="ml-2 text-[14px]" style={{ color: "var(--brand)" }}>
              (you)
            </span>
          )}
        </span>
        {entry.teamName && (
          <span className="text-[14px] block" style={{ color: "var(--text-muted)" }}>
            {entry.teamName}
          </span>
        )}
      </div>

      <span
        className="text-[16px] tabular-nums shrink-0"
        style={{ fontVariantNumeric: "tabular-nums", color: "var(--text)" }}
      >
        {entry.finalScore}
        {entry.tied && (
          <span className="text-[14px] ml-1" style={{ color: "var(--text-muted)" }}>T</span>
        )}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeaderboardClient({ eventId, eventName, initialScope = "overall" }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope] = useState(initialScope);

  const etag = useRef<string | null>(null);
  const consecutiveNotModified = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchedAt = useRef<number>(0);

  const fetchLeaderboard = useCallback(async () => {
    if (document.hidden) return; // pause when tab not visible

    try {
      const headers: Record<string, string> = {};
      if (etag.current) headers["If-None-Match"] = etag.current;

      const res = await fetch(
        `/api/v1/events/${eventId}/leaderboard?scope=${scope}`,
        { headers },
      );

      if (res.status === 304) {
        consecutiveNotModified.current += 1;
      } else if (res.ok) {
        consecutiveNotModified.current = 0;
        const data = (await res.json()) as Snapshot;
        setSnapshot(data);
        etag.current = data.etag;
        lastFetchedAt.current = Date.now();
        setStale(false);
        setError(null);
      } else {
        setError(`Leaderboard unavailable (${res.status})`);
      }
    } catch {
      setError("Network error — retrying…");
    }

    // Check staleness
    if (lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current > 30_000) {
      setStale(true);
    }

    // Schedule next poll: back off to 30 s after 3 consecutive 304s
    const baseInterval =
      consecutiveNotModified.current >= 3 ? 30_000 : 15_000;
    timerRef.current = setTimeout(fetchLeaderboard, jitter(baseInterval));
  }, [eventId, scope]);

  useEffect(() => {
    fetchLeaderboard();
    const onVisibilityChange = () => {
      if (!document.hidden) fetchLeaderboard();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchLeaderboard]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="container"
      style={{ paddingTop: "32px", paddingBottom: "64px" }}
    >
      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "24px", marginBottom: "24px" }}>
        <p className="text-[14px] mb-2" style={{ color: "var(--text-muted)" }}>
          {eventName}
        </p>
        <h1
          className="text-[32px]"
          style={{ fontFamily: "Georgia, serif", fontWeight: 400, color: "var(--text)" }}
        >
          Leaderboard
          {snapshot?.provisional && (
            <span
              className="ml-3 text-[14px] inline-block border-l-2 pl-2"
              style={{ borderColor: "var(--live)", color: "var(--live)" }}
            >
              Provisional
            </span>
          )}
        </h1>
        {snapshot && (
          <p className="text-[14px] mt-1" style={{ color: "var(--text-muted)" }}>
            {snapshot.entries.length} participants ·{" "}
            Updated {new Date(snapshot.generatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Stale banner */}
      {stale && (
        <div
          className="mb-4 text-[14px] border-l-2 pl-3 py-2"
          style={{ borderColor: "var(--live)", color: "var(--live)" }}
          role="status"
        >
          Data may be stale — reconnecting…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mb-4 text-[14px] border-l-2 pl-3 py-2"
          style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {!snapshot && !error && (
        <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
          Loading leaderboard…
        </div>
      )}

      {/* Entries */}
      {snapshot && (
        <div>
          {/* Column headers */}
          <div
            className="flex items-center gap-4 pb-2 text-[14px]"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}
          >
            <span className="w-8 text-center">Rank</span>
            <span className="flex-1">Participant</span>
            <span className="shrink-0">Score</span>
          </div>

          {snapshot.entries.length === 0 ? (
            <p className="py-12 text-center text-[14px]" style={{ color: "var(--text-muted)" }}>
              No scores yet.
            </p>
          ) : (
            snapshot.entries.map((e) => <Row key={e.entryCode} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}

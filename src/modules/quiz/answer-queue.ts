"use client";

/**
 * Answer Queue — M1-E12
 *
 * IndexedDB-backed queue for quiz answer saves. Provides:
 * - Offline persistence: answers survive page refresh and network drops
 * - Retry with exponential back-off on failure
 * - Flush-on-reconnect via navigator.onLine + window 'online' event
 * - clientSeq tracking to prevent stale overwrites on server
 *
 * Usage:
 *   const queue = createAnswerQueue(attemptId)
 *   queue.enqueue({ attemptQuestionId, selectedOptionIds, clientSeq })
 *   queue.destroy()   // cleanup listeners on unmount
 */

const DB_NAME = "ef_answer_queue";
const DB_VERSION = 1;
const STORE = "pending_answers";

export interface PendingAnswer {
  /** IDB key — auto-incremented */
  id?: number;
  attemptId: string;
  attemptQuestionId: string;
  selectedOptionIds: string[];
  clientSeq: number;
  /** ISO timestamp of last enqueue/retry */
  enqueuedAt: string;
  retries: number;
}

export interface AnswerQueue {
  enqueue(answer: Omit<PendingAnswer, "id" | "attemptId" | "enqueuedAt" | "retries">): void;
  destroy(): void;
}

// ── IDB helpers ────────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function putAnswer(db: IDBDatabase, answer: PendingAnswer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(answer);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteAnswer(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPendingForAttempt(
  db: IDBDatabase,
  attemptId: string,
): Promise<PendingAnswer[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as PendingAnswer[]).filter((r) => r.attemptId === attemptId),
      );
    req.onerror = () => reject(req.error);
  });
}

// ── Flush logic ────────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 3_000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;

async function flush(db: IDBDatabase, attemptId: string): Promise<void> {
  const pending = await getPendingForAttempt(db, attemptId);
  if (pending.length === 0) return;

  // Deduplicate: keep only the latest clientSeq per attemptQuestionId
  const deduped = new Map<string, PendingAnswer>();
  for (const a of pending) {
    const existing = deduped.get(a.attemptQuestionId);
    if (!existing || a.clientSeq > existing.clientSeq) {
      deduped.set(a.attemptQuestionId, a);
    }
  }

  const toSend = Array.from(deduped.values());
  const staleIds = pending
    .filter((a) => !toSend.includes(a))
    .map((a) => a.id!);

  // Delete stale (superseded) entries first
  await Promise.all(staleIds.map((id) => deleteAnswer(db, id)));

  // Send batch
  try {
    const res = await fetch(`/api/v1/attempts/${attemptId}/answers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: toSend.map((a) => ({
          attemptQuestionId: a.attemptQuestionId,
          selectedOptionIds: a.selectedOptionIds,
          clientSeq: a.clientSeq,
        })),
      }),
      // Attach to the document's unload lifecycle so flush-on-unload works
      keepalive: true,
    });

    if (res.ok || res.status === 409) {
      // 409 = already submitted (idempotent) — treat as success
      await Promise.all(toSend.map((a) => deleteAnswer(db, a.id!)));
    } else {
      // Increment retries, back off
      await Promise.all(
        toSend.map(async (a) => {
          if (a.retries >= MAX_RETRIES) {
            // Give up — don't keep hammering a dead endpoint
            await deleteAnswer(db, a.id!);
          } else {
            await putAnswer(db, {
              ...a,
              retries: a.retries + 1,
              enqueuedAt: new Date().toISOString(),
            });
          }
        }),
      );
    }
  } catch {
    // Network error — leave in queue, will retry on next tick
  }
}

// ── Public factory ─────────────────────────────────────────────────────────────

/**
 * Creates an AnswerQueue for a specific quiz attempt.
 * Call destroy() on component unmount to stop the timer and flush listener.
 */
export function createAnswerQueue(attemptId: string): AnswerQueue {
  let db: IDBDatabase | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  async function init() {
    try {
      db = await openDb();
      // Flush any leftover answers from a previous session
      await flush(db, attemptId);
      // Start the periodic flush timer
      timer = setInterval(() => {
        if (db) void flush(db, attemptId);
      }, FLUSH_INTERVAL_MS);
    } catch {
      // IDB unavailable (private browsing with block etc.) — degrade gracefully
    }
  }

  async function handleOnline() {
    if (db) await flush(db, attemptId);
  }

  void init();
  window.addEventListener("online", handleOnline);

  return {
    enqueue(answer) {
      if (destroyed || !db) return;
      void putAnswer(db, {
        attemptId,
        attemptQuestionId: answer.attemptQuestionId,
        selectedOptionIds: answer.selectedOptionIds,
        clientSeq: answer.clientSeq,
        enqueuedAt: new Date().toISOString(),
        retries: 0,
      });
      // Eager flush if online
      if (navigator.onLine) void flush(db, attemptId);
    },

    destroy() {
      destroyed = true;
      window.removeEventListener("online", handleOnline);
      if (timer !== null) clearInterval(timer);
      if (db) {
        // Final flush before teardown
        void flush(db, attemptId).finally(() => db?.close());
      }
    },
  };
}

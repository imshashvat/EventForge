"use client";
/**
 * ParticipantActions — inline approve/reject/waitlist buttons.
 * Calls PATCH /api/v1/events/[eventId]/registrations/[participantId]
 * and refreshes the page on success.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  eventId: string;
  participantId: string;
  currentStatus: "pending" | "approved" | "rejected" | "waitlisted";
}

export function ParticipantActions({ eventId, participantId, currentStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(decision: "approved" | "rejected" | "waitlisted") {
    setLoading(decision);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/events/${eventId}/registrations/${participantId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Action failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  if (currentStatus === "approved") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          loading={loading === "rejected"}
          loadingText="…"
          onClick={() => void review("rejected")}
        >
          Revoke
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={loading === "waitlisted"}
          loadingText="…"
          onClick={() => void review("waitlisted")}
        >
          Waitlist
        </Button>
        {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>{error}</span>}
      </div>
    );
  }

  if (currentStatus === "pending" || currentStatus === "waitlisted") {
    return (
      <div className="flex items-center gap-2">
        <Button
          id={`approve-${participantId}`}
          size="sm"
          variant="primary"
          loading={loading === "approved"}
          loadingText="…"
          onClick={() => void review("approved")}
        >
          Approve
        </Button>
        {currentStatus === "pending" && (
          <Button
            size="sm"
            variant="secondary"
            loading={loading === "waitlisted"}
            loadingText="…"
            onClick={() => void review("waitlisted")}
          >
            Waitlist
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          loading={loading === "rejected"}
          loadingText="…"
          onClick={() => void review("rejected")}
        >
          Reject
        </Button>
        {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>{error}</span>}
      </div>
    );
  }

  return null;
}

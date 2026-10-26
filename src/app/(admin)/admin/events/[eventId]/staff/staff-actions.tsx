"use client";
/**
 * StaffActions — add or remove a staff member from an event.
 * Calls POST/DELETE /api/v1/events/[eventId]/roles
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const ASSIGNABLE_ROLES = [
  { value: "event_admin", label: "Event Admin" },
  { value: "round_manager", label: "Round Manager" },
  { value: "judge", label: "Judge" },
  { value: "reviewer", label: "Reviewer" },
  { value: "observer", label: "Observer" },
];

interface AddProps {
  eventId: string;
  action: "add";
}
interface RemoveProps {
  eventId: string;
  action: "remove";
  userId: string;
  roleKey?: string;
}

type Props = AddProps | RemoveProps;

export function StaffActions(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Add form ─────────────────────────────────────────────────────────────
  if (props.action === "add") {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("reviewer");

    async function handleAdd(e: React.FormEvent) {
      e.preventDefault();
      if (!email.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/events/${props.eventId}/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), roleKey: role }),
        });
        if (res.ok) {
          setEmail("");
          router.refresh();
        } else {
          const data = await res.json().catch(() => ({})) as { error?: string };
          setError(data.error ?? "Failed to add staff");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }

    return (
      <form onSubmit={(e) => void handleAdd(e)} className="staff-add-form">
        <input
          type="email"
          className="staff-input"
          placeholder="staff@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <select
          className="staff-select"
          value={role}
          onChange={e => setRole(e.target.value)}
        >
          {ASSIGNABLE_ROLES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="sm" loading={loading} loadingText="Adding…">
          Add
        </Button>
        {error && <span className="staff-error">{error}</span>}
        <style>{`
          .staff-add-form { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); flex-wrap: wrap; }
          .staff-input { flex: 1; min-width: 200px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-1); font-size: var(--text-sm); outline: none; }
          .staff-input:focus { border-color: var(--teal); }
          .staff-select { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-1); font-size: var(--text-sm); outline: none; cursor: pointer; }
          .staff-error { font-size: var(--text-xs); color: var(--error); }
        `}</style>
      </form>
    );
  }

  // ── Remove button ─────────────────────────────────────────────────────────
  const { eventId: removeEventId, userId: removeUserId, roleKey: removeRoleKey } =
    props as Extract<Props, { action: "remove" }>;

  async function handleRemove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/events/${removeEventId}/roles`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: removeUserId, roleKey: removeRoleKey }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Failed to remove");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <Button
        size="sm"
        variant="danger"
        loading={loading}
        loadingText="Removing…"
        onClick={() => void handleRemove()}
      >
        Remove
      </Button>
      {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>{error}</span>}
    </div>
  );
}

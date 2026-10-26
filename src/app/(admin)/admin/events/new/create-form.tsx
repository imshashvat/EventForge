"use client";

/**
 * Create event form client component — called by the /admin/events/new page.
 * Sends POST /api/v1/events, then redirects to /admin/events/[id] on success.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface FieldError {
  field: string;
  message: string;
}

export function CreateEventForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  function fieldError(name: string): string | undefined {
    return errors.find((e) => e.field === name)?.message;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors([]);
    setGlobalError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const startsAt = data.get("startsAt") as string;
    const endsAt = data.get("endsAt") as string;
    const maxParticipants = data.get("maxParticipants") as string;

    const body = {
      slug: (data.get("slug") as string).toLowerCase().trim(),
      name: (data.get("name") as string).trim(),
      tagline: (data.get("tagline") as string).trim() || undefined,
      description: (data.get("description") as string).trim() || undefined,
      registrationMode: data.get("registrationMode") as string,
      teamMode: data.get("teamMode") as string,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      maxParticipants: maxParticipants ? parseInt(maxParticipants, 10) : undefined,
    };

    try {
      const res = await fetch("/api/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        const eventId = (json as { event?: { id?: string } }).event?.id;
        if (eventId) {
          router.push(`/admin/events/${eventId}`);
        } else {
          router.push("/admin/events");
        }
        return;
      }

      // Handle validation errors
      if (res.status === 422 && (json as { issues?: { path?: string[]; message: string }[] }).issues) {
        const issues = (json as { issues: { path?: string[]; message: string }[] }).issues;
        setErrors(issues.map((i) => ({ field: i.path?.[0] ?? "_", message: i.message })));
      } else {
        setGlobalError((json as { error?: string }).error ?? "Failed to create event");
      }
    } catch {
      setGlobalError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6 max-w-2xl">
      {globalError && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            background: "var(--error-dim)",
            borderColor: "color-mix(in srgb, var(--error) 30%, transparent)",
            color: "var(--error)",
          }}
        >
          {globalError}
        </div>
      )}

      {/* Name + Slug */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Event name *" error={fieldError("name")}>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="e.g. Hack the Future 2026"
            className="form-input"
          />
        </Field>
        <Field label="URL slug *" error={fieldError("slug")} hint="3-64 chars: lowercase, digits, hyphens">
          <input
            name="slug"
            required
            pattern="[a-z0-9-]{3,64}"
            maxLength={64}
            placeholder="hack-the-future-2026"
            className="form-input"
          />
        </Field>
      </div>

      {/* Tagline */}
      <Field label="Tagline" error={fieldError("tagline")}>
        <input
          name="tagline"
          maxLength={160}
          placeholder="One-sentence hook shown on the event card"
          className="form-input"
        />
      </Field>

      {/* Description */}
      <Field label="Description" error={fieldError("description")}>
        <textarea
          name="description"
          rows={4}
          maxLength={5000}
          placeholder="Full event description — rules, prizes, eligibility…"
          className="form-input resize-y"
        />
      </Field>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Starts at" error={fieldError("startsAt")}>
          <input name="startsAt" type="datetime-local" className="form-input" />
        </Field>
        <Field label="Ends at" error={fieldError("endsAt")}>
          <input name="endsAt" type="datetime-local" className="form-input" />
        </Field>
      </div>

      {/* Registration mode + Team mode */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Registration mode" error={fieldError("registrationMode")}>
          <select name="registrationMode" className="form-input" defaultValue="open">
            <option value="open">Open — auto-approve</option>
            <option value="approval">Approval required</option>
            <option value="invite_only">Invite only</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Field label="Team mode" error={fieldError("teamMode")}>
          <select name="teamMode" className="form-input" defaultValue="individual">
            <option value="individual">Individual</option>
            <option value="team">Team only</option>
            <option value="both">Individual or team</option>
          </select>
        </Field>
      </div>

      {/* Capacity */}
      <Field label="Max participants" error={fieldError("maxParticipants")} hint="Leave blank for unlimited">
        <input
          name="maxParticipants"
          type="number"
          min={1}
          max={100000}
          placeholder="e.g. 500"
          className="form-input"
        />
      </Field>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          id="create-event-submit"
          type="submit"
          variant="primary"
          loading={submitting}
          loadingText="Creating…"
        >
          Create event
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Reusable field wrapper ────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs font-semibold"
        style={{ color: "var(--text-secondary)", letterSpacing: "0.03em" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs" style={{ color: "var(--text-disabled)" }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

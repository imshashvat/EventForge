"use client";

/**
 * Registration form builder client — M1-B5
 * Drag-to-reorder field list with live inline editing.
 * Saves via PUT /api/v1/events/[eventId]/registration-form.
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = "text" | "email" | "phone" | "select" | "checkbox" | "url";

interface FieldDef {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];   // for select only
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  email: "Email address",
  phone: "Phone number",
  url: "URL",
  select: "Dropdown (select)",
  checkbox: "Checkbox (yes/no)",
};

const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  text: "T",
  email: "@",
  phone: "📞",
  url: "🔗",
  select: "▾",
  checkbox: "☑",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 60) || "field";
}

function makeBlankField(): FieldDef {
  return { key: "", label: "", fieldType: "text", required: false };
}

// ── Main component ────────────────────────────────────────────────────────────

export function RegistrationFormBuilder({ eventId }: { eventId: string }) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState<number | null>(null);
  const [participantsExist, setParticipantsExist] = useState(false);

  // ── Load existing form ────────────────────────────────────────────────────

  const loadForm = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/registration-form`);
      const data = await res.json() as {
        form?: { id: string; version: number } | null;
        fields?: FieldDef[];
      };
      setFields(data.fields ?? []);
      setFormVersion(data.form?.version ?? null);
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId]);

  // Check if participants exist (affects whether edits create new version)
  const checkParticipants = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/events/${eventId}/registrations?limit=1`);
      const data = await res.json() as { total?: number };
      setParticipantsExist((data.total ?? 0) > 0);
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    void loadForm();
    void checkParticipants();
  }, [loadForm, checkParticipants]);

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/registration-form`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json() as { form?: { version: number }; error?: string; issues?: { message: string }[] };
      if (!res.ok) {
        setError(data.error ?? data.issues?.[0]?.message ?? "Save failed");
        return;
      }
      setFormVersion(data.form?.version ?? formVersion);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  // ── Field mutations ───────────────────────────────────────────────────────

  function addField() {
    setFields((prev) => [...prev, makeBlankField()]);
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateField(idx: number, patch: Partial<FieldDef>) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f;
        const updated = { ...f, ...patch };
        // Auto-generate key from label if key is still empty or was auto-generated
        if ("label" in patch && (f.key === "" || f.key === slugKey(f.label))) {
          updated.key = slugKey(patch.label ?? "");
        }
        return updated;
      }),
    );
  }

  function moveField(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= fields.length) return;
    setFields((prev) => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next]!, arr[idx]!];
      return arr;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="py-8 text-sm text-center" style={{ color: "var(--text-secondary)" }}>Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header info */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {formVersion && (
            <span className="text-xs px-2 py-0.5 rounded-full mr-2"
              style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}>
              v{formVersion}
            </span>
          )}
          {participantsExist && (
            <span className="text-xs" style={{ color: "var(--warning)" }}>
              ⚠ Participants exist — edits will create a new form version
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs" style={{ color: "var(--success)" }}>✓ Saved</span>}
          <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving} loadingText="Saving…">
            Save form
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--error-dim)", color: "var(--error)" }}>
          {error}
        </div>
      )}

      {/* Field list */}
      {fields.length === 0 ? (
        <div className="py-10 text-center rounded-xl border border-dashed" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
            No fields yet. Registration will only collect name and email from the user profile.
          </p>
          <Button variant="secondary" size="sm" onClick={addField}>+ Add first field</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field, idx) => (
            <FieldEditor
              key={idx}
              field={field}
              idx={idx}
              total={fields.length}
              onChange={(patch) => updateField(idx, patch)}
              onRemove={() => removeField(idx)}
              onMove={(dir) => moveField(idx, dir)}
            />
          ))}
        </div>
      )}

      {fields.length > 0 && (
        <Button variant="ghost" size="sm" onClick={addField} className="self-start">
          + Add field
        </Button>
      )}

      {/* Built-in system fields notice */}
      <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>Built-in fields</span> (always collected):
        Display name · Email address
      </div>
    </div>
  );
}

// ── Field editor row ──────────────────────────────────────────────────────────

function FieldEditor({
  field,
  idx,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  field: FieldDef;
  idx: number;
  total: number;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(idx === 0 || field.label === "");

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
      >
        {/* Type icon */}
        <span className="text-xs w-5 text-center shrink-0" style={{ color: "var(--teal-300)" }}>
          {FIELD_TYPE_ICONS[field.fieldType]}
        </span>

        {/* Label / key preview */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {field.label || <span style={{ color: "var(--text-disabled)" }}>Untitled field</span>}
            {field.required && <span className="ml-1 text-xs" style={{ color: "var(--error)" }}>*</span>}
          </p>
          {field.key && (
            <p className="text-xs truncate" style={{ color: "var(--text-disabled)", fontFamily: "monospace" }}>
              {field.key}
            </p>
          )}
        </div>

        {/* Type badge */}
        <span className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
          {FIELD_TYPE_LABELS[field.fieldType]}
        </span>

        {/* Move + delete */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-3)] disabled:opacity-30"
            title="Move up"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={idx === total - 1}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-3)] disabled:opacity-30"
            title="Move down"
          >
            ↓
          </button>
          <button
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center rounded text-xs hover:bg-[var(--error-dim)]"
            title="Remove field"
            style={{ color: "var(--error)" }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div
          className="border-t px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
          style={{ borderColor: "var(--border)" }}
        >
          {/* Label */}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Label *</label>
            <input
              className="form-input text-sm"
              value={field.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="e.g. College name"
              required
            />
          </div>

          {/* Key */}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Field key (snake_case)</label>
            <input
              className="form-input text-sm"
              style={{ fontFamily: "monospace" }}
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="college_name"
              pattern="[a-z_][a-z0-9_]*"
              required
            />
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Field type</label>
            <select
              className="form-input text-sm"
              value={field.fieldType}
              onChange={(e) => {
                const t = e.target.value as FieldType;
                const newOpts: string[] | undefined = t === "select" ? (field.options ?? [""]) : undefined;
                if (newOpts !== undefined) {
                  onChange({ fieldType: t, options: newOpts });
                } else {
                  onChange({ fieldType: t });
                }
              }}
            >
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {/* Placeholder */}
          {field.fieldType !== "checkbox" && field.fieldType !== "select" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Placeholder (optional)</label>
              <input
                className="form-input text-sm"
                value={field.placeholder ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    onChange({ placeholder: e.target.value });
                  } else {
                    const { placeholder: _p, ...rest } = field;
                    onChange(rest as Partial<FieldDef>);
                  }
                }}
                placeholder="Hint shown inside the input"
              />
            </div>
          )}

          {/* Required toggle */}
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id={`req-${idx}`}
              type="checkbox"
              checked={field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              className="w-4 h-4 accent-[var(--teal-500)]"
            />
            <label htmlFor={`req-${idx}`} className="text-sm" style={{ color: "var(--text-primary)" }}>
              Required
            </label>
          </div>

          {/* Select options */}
          {field.fieldType === "select" && (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Options (one per line)</label>
              <textarea
                className="form-input resize-y text-sm"
                rows={3}
                value={(field.options ?? []).join("\n")}
                onChange={(e) =>
                  onChange({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
                }
                placeholder={"Option A\nOption B\nOption C"}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

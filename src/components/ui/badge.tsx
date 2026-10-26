/**
 * Badge / StatusPill — EventForge UI primitive
 *
 * UI Master Guide rules:
 *   - radius 0 (pill variant NOT available — use left-border instead)
 *   - No fill — left 2px border + transparent bg
 *   - Tokens from globals.css only
 *   - Color never the sole signal (always pair with text)
 *
 * StatusPill: left 2px border, no fill (Delulu3 .pill pattern)
 * Badge:      small uppercase label with left border
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
import { cn } from "@/lib/cn";
import * as React from "react";

export type StatusVariant =
  | "default"
  | "open"
  | "active"
  | "live"
  | "paused"
  | "closed"
  | "draft"
  | "approved"
  | "rejected"
  | "pending"
  | "waitlisted"
  | "withdrawn"
  | "published"
  | "neutral";

const statusConfig: Record<StatusVariant, { label: string; color: string }> = {
  default:    { label: "-",          color: "var(--text-muted)" },
  open:       { label: "Open",       color: "var(--success)" },
  active:     { label: "Active",     color: "var(--success)" },
  live:       { label: "Live",       color: "var(--live)" },
  paused:     { label: "Paused",     color: "var(--live)" },
  closed:     { label: "Closed",     color: "var(--text-muted)" },
  draft:      { label: "Draft",      color: "var(--text-muted)" },
  approved:   { label: "Approved",   color: "var(--success)" },
  rejected:   { label: "Rejected",   color: "var(--danger)" },
  pending:    { label: "Pending",    color: "var(--live)" },
  waitlisted: { label: "Waitlisted", color: "var(--live)" },
  withdrawn:  { label: "Withdrawn",  color: "var(--text-muted)" },
  published:  { label: "Published",  color: "var(--success)" },
  neutral:    { label: "—",          color: "var(--text-muted)" },
};

interface StatusPillProps {
  status: StatusVariant;
  /** Override the label */
  label?: string;
  className?: string;
}

/** Left 2px border pill — the standard status indicator */
export function StatusPill({ status, label, className }: StatusPillProps) {
  const cfg = statusConfig[status];
  const text = label ?? cfg.label;
  const isLive = status === "live" || status === "active";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[14px] pl-2 border-l-2",
        className,
      )}
      style={{ borderColor: cfg.color, color: cfg.color }}
    >
      {isLive && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse-live"
          style={{ background: cfg.color }}
          aria-hidden="true"
        />
      )}
      {text}
    </span>
  );
}

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusVariant | undefined;
  /** Override color via CSS variable name */
  color?: string | undefined;
}

/** Compact uppercase badge — left 2px border, no fill */
export function Badge({ status, color, className, children, ...props }: BadgeProps) {
  const borderColor = color ?? (status ? statusConfig[status].color : "var(--text-muted)");

  return (
    <span
      className={cn(
        "inline-flex items-center text-[14px] font-medium pl-2 border-l-2 uppercase tracking-wide",
        className,
      )}
      style={{ borderColor, color: borderColor }}
      {...props}
    >
      {children ?? (status ? statusConfig[status].label : null)}
    </span>
  );
}

/** RankBadge — gold/silver/bronze for top 3, numeric for rest (tabular-nums) */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const podium: Record<number, { label: string; color: string }> = {
    1: { label: "1st", color: "var(--gold)" },
    2: { label: "2nd", color: "var(--silver)" },
    3: { label: "3rd", color: "var(--bronze)" },
  };
  const p = podium[rank];
  return (
    <span
      className={cn("inline-block text-[14px] tabular-nums", className)}
      style={{ color: p?.color ?? "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
    >
      {p?.label ?? `#${rank}`}
    </span>
  );
}

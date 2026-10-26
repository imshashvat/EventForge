/**
 * Card — EventForge surface containers
 *
 * UI Master Guide rules:
 *   - radius 0 (no rounded-*)
 *   - no shadows (var(--shadow) = none)
 *   - transparent background (use border only) OR surface bg
 *   - tokens from globals.css only
 *
 * Variants:
 *   default  — 1px border all sides, surface bg, padding 24
 *   section  — border top only, no bg (like Delulu3 .card-top / .chart-box)
 *   inner    — surface bg + border (nested panels)
 *   ghost    — border only, transparent bg
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
import { cn } from "@/lib/cn";
import * as React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "section" | "inner" | "ghost" | "compact";
}

const variants: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "border border-[var(--border)] bg-transparent p-6",
  section: "border-t border-[var(--border)] bg-transparent pt-6",
  inner:   "border border-[var(--border)] bg-[var(--surface)] p-6",
  ghost:   "border border-[var(--border)] bg-transparent p-6",
  compact: "border border-[var(--border)] bg-transparent p-4",
};

export function Card({ variant = "default", className, children, ...props }: CardProps) {
  return (
    <div className={cn(variants[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-6 flex items-start justify-between gap-4", className)} {...props}>
      {children}
    </div>
  );
}

/** Georgia serif heading inside a card */
export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-[24px] text-[var(--text)] leading-snug", className)}
      style={{ fontFamily: "Georgia, serif", fontWeight: 400 }}
      {...props}
    >
      {children}
    </h2>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-[14px] text-[var(--text-muted)]", className)} {...props}>
      {children}
    </p>
  );
}

export function CardFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-6 pt-6 flex items-center gap-3 border-t border-[var(--border)]", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Stat card — used in admin dashboard overview */
export function StatCard({
  label,
  value,
  delta,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-[var(--border)] py-6", className)}>
      <p className="text-[14px] text-[var(--text-muted)] mb-2">{label}</p>
      <p
        className="text-[32px] leading-none text-[var(--text)] tabular-nums"
        style={{ fontFamily: "Georgia, serif", fontWeight: 400 }}
      >
        {value}
      </p>
      {delta && (
        <p className="text-[14px] text-[var(--text-muted)] mt-1">{delta}</p>
      )}
    </div>
  );
}

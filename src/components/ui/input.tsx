/**
 * Input, Textarea, Select — EventForge form primitives
 *
 * UI Master Guide rules:
 *   - radius 0 (no rounded-*)
 *   - bg: var(--bg), 1px border var(--border)
 *   - min-height 44px (touch target)
 *   - focus: 3px outline var(--focus), border-color var(--brand)
 *   - 14px label above
 *   - inline error: 14px var(--bad) below field
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// ── Field wrapper ─────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  /** htmlFor — or use id as alias (both map to label htmlFor) */
  htmlFor?: string | undefined;
  /** Alias for htmlFor (backwards compat with existing pages) */
  id?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, id, error, hint, required, className, children }: FieldProps) {
  const forId = htmlFor ?? id;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={forId}
        className="text-[14px] font-medium text-[var(--text)]"
      >
        {label}
        {required && <span className="text-[var(--bad)] ml-1" aria-hidden="true">*</span>}
        {hint && (
          <span className="text-[var(--text-muted)] font-normal ml-2">{hint}</span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-[14px] text-[var(--bad)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error, className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "block w-full min-h-[44px] px-3 py-3",
        "bg-[var(--bg)] text-[var(--text)] text-[16px]",
        "border border-[var(--border)]",
        "placeholder:text-[var(--text-muted)]",
        "focus:outline focus:outline-[3px] focus:outline-[var(--focus)] focus:outline-offset-0",
        "focus:border-[var(--brand)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors duration-[150ms]",
        error && "border-[var(--bad)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// ── Textarea ──────────────────────────────────────────────────────────────────
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "block w-full min-h-[120px] px-3 py-3 resize-vertical",
        "bg-[var(--bg)] text-[var(--text)] text-[16px]",
        "border border-[var(--border)]",
        "placeholder:text-[var(--text-muted)]",
        "focus:outline focus:outline-[3px] focus:outline-[var(--focus)] focus:outline-offset-0",
        "focus:border-[var(--brand)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors duration-[150ms]",
        error && "border-[var(--bad)]",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

// ── Select ────────────────────────────────────────────────────────────────────
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block w-full min-h-[44px] px-3 py-3 pr-8",
        "bg-[var(--bg)] text-[var(--text)] text-[16px]",
        "border border-[var(--border)]",
        "focus:outline focus:outline-[3px] focus:outline-[var(--focus)] focus:outline-offset-0",
        "focus:border-[var(--brand)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors duration-[150ms]",
        "appearance-none",
        error && "border-[var(--bad)]",
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23bdbab6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

// ── Backwards-compat aliases (used by existing sign-in/up and judge pages) ──

/** FormField — alias for Field, kept for existing imports */
export const FormField = Field;

/** AlertBanner — inline error/info banner */
export function AlertBanner({
  type = "error",
  children,
  className,
}: {
  type?: "error" | "info" | "success";
  children: React.ReactNode;
  className?: string;
}) {
  const colors: Record<typeof type, { border: string; text: string }> = {
    error:   { border: "var(--bad)",     text: "var(--bad)" },
    info:    { border: "var(--brand)",   text: "var(--text-muted)" },
    success: { border: "var(--good)",    text: "var(--good)" },
  };
  const c = colors[type];
  return (
    <div
      role="alert"
      className={className}
      style={{
        borderLeft: `2px solid ${c.border}`,
        paddingLeft: "12px",
        paddingTop: "8px",
        paddingBottom: "8px",
        fontSize: "14px",
        color: c.text,
      }}
    >
      {children}
    </div>
  );
}

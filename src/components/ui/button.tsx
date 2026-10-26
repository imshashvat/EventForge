/**
 * Button — EventForge UI primitive
 *
 * UI Master Guide rules (Phase 1):
 *   - radius 0 (no rounded-*)
 *   - no shadows/gradients
 *   - tokens from globals.css only (--action, --on-action, --text, --bg, etc.)
 *   - min-height 44px (touch target)
 *   - both dark + light themes via CSS vars
 *
 * Variants: primary | secondary | danger | ghost | link | icon
 * Sizes:    sm | md (default) | lg
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link" | "icon" | "cta";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  /** Render as child element (e.g. wrap an <a> tag). */
  asChild?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-[inherit] font-medium " +
  "border cursor-pointer select-none whitespace-nowrap no-underline " +
  "transition-colors duration-[150ms] " +
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none " +
  // focus: 3px outline, no border-radius (guide: radius 0)
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[4px] focus-visible:outline-[var(--focus)]";

const variantClasses: Record<ButtonVariant, string> = {
  // action fill (cream in dark, near-black in light); on-action text
  primary:
    "bg-[var(--action)] text-[var(--on-action)] border-[var(--action)] " +
    "hover:bg-[var(--text)] hover:border-[var(--text)] hover:text-[var(--bg)]",

  // transparent + border
  secondary:
    "bg-transparent text-[var(--text)] border-[var(--border)] " +
    "hover:border-[var(--text)]",

  // danger
  danger:
    "bg-[var(--danger)] text-white border-[var(--danger)] " +
    "hover:opacity-90",

  // no border, subtle text
  ghost:
    "bg-transparent text-[var(--text-muted)] border-transparent " +
    "hover:text-[var(--text)]",

  // text-only, inline
  link:
    "bg-transparent border-transparent text-[var(--link)] underline-offset-4 " +
    "hover:underline p-0 min-h-0 h-auto",

  // square icon button
  // cta — same as primary; no gradient (guide: no gradients except hero scrim on landing)
  cta:
    "bg-[var(--action)] text-[var(--on-action)] border-[var(--action)] " +
    "hover:bg-[var(--text)] hover:border-[var(--text)] hover:text-[var(--bg)] font-medium",

  icon:
    "bg-transparent border-transparent text-[var(--text-muted)] aspect-square " +
    "hover:text-[var(--text)] hover:bg-[var(--wash)]",
};

/**
 * Inline colour overrides per variant — necessary because global `a { color }` beats
 * Tailwind utility classes when the Button is rendered as an anchor via asChild.
 * Inline styles always win the specificity war.
 */
const variantColor: Record<ButtonVariant, string> = {
  primary:   "var(--on-action)",
  cta:       "var(--on-action)",
  secondary: "var(--text)",
  danger:    "#ffffff",
  ghost:     "var(--text-muted)",
  link:      "var(--link)",
  icon:      "var(--text-muted)",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-[14px] px-3 min-h-[36px]",
  md: "text-[16px] px-4 min-h-[44px]",
  lg: "text-[16px] px-6 min-h-[44px]",
};
const iconSizeClasses: Record<ButtonSize, string> = {
  sm: "p-2 min-h-[36px] min-w-[36px]",
  md: "p-2 min-h-[44px] min-w-[44px]",
  lg: "p-3 min-h-[44px] min-w-[44px]",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      loadingText,
      asChild = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;
    const sizeStyle = variant === "icon" ? iconSizeClasses[size] : sizeClasses[size];

    return (
      <Comp
        ref={ref}
        data-slot="button"
        disabled={isDisabled}
        aria-disabled={isDisabled}
        className={cn(base, variantClasses[variant], sizeStyle, className)}
        style={{ textDecoration: "none", color: variantColor[variant] }}
        {...props}
      >
        {loading ? (
          <>
            <Spinner size={size === "lg" ? "md" : "sm"} />
            {loadingText ?? (typeof children === "string" ? children : "Loading…")}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

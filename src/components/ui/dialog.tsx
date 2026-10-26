/**
 * Dialog — Radix Dialog wrapper
 *
 * UI Master Guide rules (Part 6):
 *   - bg: var(--surface), 1px border, max-w 640px, padding 32
 *   - overlay: rgba(0,0,0,0.55) [~#0009]
 *   - serif H2 + 44px close button
 *   - radius 0
 *   - no shadow
 *   - destructive confirm variant = danger button
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
}

export function Dialog({
  title,
  description,
  children,
  className,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      {/* Overlay */}
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-40 bg-black/55",
          "data-[state=open]:animate-fade-in",
          "data-[state=closed]:opacity-0 transition-opacity duration-[200ms]",
        )}
      />
      {/* Panel — radius 0, no shadow, 1px border */}
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-[min(640px,calc(100vw-32px))]",
          "bg-[var(--surface)] border border-[var(--border)] p-8",
          "data-[state=open]:animate-slide-in",
          "focus:outline-none",
          className,
        )}
        {...props}
      >
        {/* Close × — 44px target */}
        <DialogPrimitive.Close
          className={cn(
            "absolute top-4 right-4",
            "min-h-[44px] min-w-[44px] flex items-center justify-center",
            "text-[var(--text-muted)] hover:text-[var(--text)]",
            "text-[20px] transition-colors duration-[150ms]",
            "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--focus)] focus-visible:outline-offset-[4px]",
          )}
          aria-label="Close dialog"
        >
          ×
        </DialogPrimitive.Close>

        {/* Title — Georgia serif per guide */}
        <DialogPrimitive.Title
          className="text-[24px] text-[var(--text)] mb-2 pr-12"
          style={{ fontFamily: "Georgia, serif", fontWeight: 400 }}
        >
          {title}
        </DialogPrimitive.Title>

        {description && (
          <DialogPrimitive.Description className="text-[14px] text-[var(--text-muted)] mb-6">
            {description}
          </DialogPrimitive.Description>
        )}

        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

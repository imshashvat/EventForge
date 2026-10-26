/**
 * Toast — Radix Toast wrapper
 *
 * UI Master Guide rules:
 *   - radius 0, no shadow
 *   - bg: var(--surface), 1px border var(--border)
 *   - position: fixed bottom-right (24px from edges)
 *   - role=status (Radix handles aria-live)
 *   - 14px text
 *
 * Usage:
 *   Wrap your app with <ToastProvider />.
 *   Call useToast() hook to show toasts imperatively.
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cn } from "@/lib/cn";

// ── Context ───────────────────────────────────────────────────────────────────
interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<ToastData, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside <ToastProvider>");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastData[]>([]);

  const toast = React.useCallback((opts: Omit<ToastData, "id">) => {
    setToasts((prev) => [...prev, { ...opts, id: crypto.randomUUID() }]);
  }, []);

  const dismiss = (id: string) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider>
        {children}

        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration ?? 4000}
            onOpenChange={(open) => { if (!open) dismiss(t.id); }}
            className={cn(
              // Layout
              "flex flex-col gap-1 p-4 min-w-[240px] max-w-[400px]",
              // Border/bg — radius 0, no shadow per guide
              "border border-[var(--border)] bg-[var(--surface)]",
              // Animation
              "data-[state=open]:animate-slide-in data-[state=closed]:opacity-0",
              "transition-opacity duration-[150ms]",
              // Variant accent border-left
              t.variant === "error"   && "border-l-2 border-l-[var(--bad)]",
              t.variant === "success" && "border-l-2 border-l-[var(--good)]",
            )}
          >
            <ToastPrimitive.Title className="text-[14px] font-medium text-[var(--text)]">
              {t.title}
            </ToastPrimitive.Title>
            {t.description && (
              <ToastPrimitive.Description className="text-[14px] text-[var(--text-muted)]">
                {t.description}
              </ToastPrimitive.Description>
            )}
            <ToastPrimitive.Close
              className={cn(
                "absolute top-2 right-2 text-[var(--text-muted)]",
                "hover:text-[var(--text)] text-[14px]",
                "min-h-[32px] min-w-[32px] flex items-center justify-center",
                "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--focus)] focus-visible:outline-offset-[4px]",
              )}
              aria-label="Close"
            >
              ×
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}

        <ToastPrimitive.Viewport
          className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 outline-none"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

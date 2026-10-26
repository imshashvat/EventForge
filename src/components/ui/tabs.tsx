/**
 * Tabs — Radix Tabs wrapper
 *
 * UI Master Guide rules (Part 6):
 *   - Active tab: bottom 1px border var(--text), no fill, no radius
 *   - Inactive: text-muted, transparent
 *   - 44px min-height on trigger
 *   - radius 0 everywhere
 *
 * Presentational only — no imports from modules/<name>/repo.
 */
"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const TabsRoot = TabsPrimitive.Root;

export function TabsList({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex gap-0 border-b border-[var(--border)]",
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // Layout — 44px min-height, no radius
        "min-h-[44px] px-4 text-[16px] font-medium",
        // Default state
        "text-[var(--text-muted)] border-b-2 border-transparent -mb-[1px]",
        // Active state — bottom 1px border var(--text), no fill
        "data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)]",
        // Transitions
        "transition-colors duration-[150ms]",
        // Focus
        "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--focus)] focus-visible:outline-offset-[4px]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-6 focus:outline-none", className)}
      {...props}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

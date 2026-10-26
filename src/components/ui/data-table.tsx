/**
 * DataTable — server-rendered table with pagination toolbar
 *
 * UI Master Guide rules:
 *   - radius 0, no shadow
 *   - border-top on wrapper (.tbl-wrap)
 *   - th: 14px muted, border-bottom
 *   - td: 14px, border-bottom, 12px padding
 *   - numeric cells: tabular-nums, text-right
 *   - no PII (email) in on-screen tables (BR-27) — enforced by caller
 *
 * Presentational only — data + pagination state arrive as props.
 * No imports from modules/<name>/repo.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  caption?: string;
  keyField?: keyof T;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  caption,
  keyField,
  emptyMessage = "No data found.",
  className,
}: DataTableProps<T>) {
  return (
    <div
      className={cn("border-t border-[var(--border)] pt-6 overflow-x-auto", className)}
    >
      <table className="w-full border-collapse text-[14px]">
        {caption && (
          <caption className="sr-only">{caption}</caption>
        )}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "text-left text-[14px] font-medium text-[var(--text-muted)]",
                  "px-3 py-2 border-b border-[var(--border)]",
                  col.numeric && "text-right tabular-nums",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-[var(--text-muted)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={keyField ? String(row[keyField]) : i}
                className="border-b border-[var(--border)] hover:bg-[var(--wash)] transition-colors duration-[100ms]"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-3 align-top text-[var(--text)]",
                      col.numeric && "text-right tabular-nums",
                    )}
                  >
                    {col.render
                      ? col.render(row, i)
                      : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagination controls ───────────────────────────────────────────────────────
interface PagerProps {
  page: number;
  total: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}

export function Pager({ page, total, pageSize, onPrev, onNext }: PagerProps) {
  const totalPages = Math.ceil(total / pageSize);
  return (
    <div className="flex items-center gap-4 mt-6 text-[14px]">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1}
        className={cn(
          "min-h-[44px] px-4 border border-[var(--border)] text-[var(--text)]",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "hover:border-[var(--text)] transition-colors duration-[150ms]",
        )}
      >
        Previous
      </button>
      <span role="status" className="text-[var(--text-muted)]">
        Page {page} of {totalPages > 0 ? totalPages : 1}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages}
        className={cn(
          "min-h-[44px] px-4 border border-[var(--border)] text-[var(--text)]",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "hover:border-[var(--text)] transition-colors duration-[150ms]",
        )}
      >
        Next
      </button>
    </div>
  );
}

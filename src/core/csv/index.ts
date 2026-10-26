/**
 * core/csv — RFC 4180 serializer + formula-injection sanitizer (BR-28, FR-EXP-04)
 *
 * Rules:
 *  - Separator: comma; line ending: CRLF
 *  - Fields containing comma, double-quote, CR, or LF are quoted
 *  - Double-quotes within quoted fields are doubled
 *  - Formula injection: string cells whose first char is =, +, -, @, TAB, CR
 *    get a single quote prepended (before quoting the cell)
 *  - Numeric columns bypass the sanitizer (typed as numbers, not strings)
 *  - Optional UTF-8 BOM (FEATURE_EXPORT_BOM)
 *
 * NOTE: No 'server-only' import — this is a pure function library
 * with no I/O or secrets, so it is safe to unit-test without a server context.
 */

/** Characters that trigger formula injection if they appear at position 0 */
const INJECTION_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Sanitize a string cell value against CSV formula injection (BR-28).
 * Prepends "'" if the first character is a known injection trigger.
 * Pure function — used in unit tests with a fixed corpus (R-TEST-04).
 */
export function sanitizeCell(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  if (first !== undefined && INJECTION_CHARS.has(first)) {
    return "'" + value;
  }
  return value;
}

/**
 * Quote a CSV field per RFC 4180:
 * - If the value contains comma, double-quote, CR, or LF → wrap in double quotes
 * - Double-quotes within the value are doubled
 */
export function quoteField(value: string): string {
  const needsQuoting = value.includes(",") || value.includes('"') ||
    value.includes("\r") || value.includes("\n");
  if (!needsQuoting) return value;
  return '"' + value.replace(/"/g, '""') + '"';
}

export type CellValue = string | number | boolean | null | undefined | Date;

/**
 * Serialize a single cell to its CSV representation.
 * - null/undefined → empty string
 * - number → formatted as number (no thousands separator, "." decimal, NO sanitization)
 * - boolean → "true" or "false"
 * - Date → ISO-8601 UTC string
 * - string → sanitized then quoted if necessary
 */
export function serializeCell(value: CellValue, isNumeric = false): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  // string
  const str = String(value);
  if (isNumeric) return str; // caller guarantees numeric content
  return quoteField(sanitizeCell(str));
}

export interface CsvColumnDef {
  header: string;
  key: string;
  isNumeric?: boolean;
}

/**
 * Serialize rows to a complete RFC 4180 CSV string.
 * @param columns   Column definitions (order is the output column order)
 * @param rows      Array of record objects
 * @param withBom   Prepend UTF-8 BOM (for spreadsheet compatibility)
 */
export function serializeCsv(
  columns: CsvColumnDef[],
  rows: Record<string, CellValue>[],
  withBom = false,
): string {
  const CRLF = "\r\n";
  const parts: string[] = [];

  if (withBom) parts.push("\uFEFF");

  // Header row
  parts.push(columns.map((c) => quoteField(c.header)).join(",") + CRLF);

  // Data rows
  for (const row of rows) {
    const cells = columns.map((c) => serializeCell(row[c.key], c.isNumeric));
    parts.push(cells.join(",") + CRLF);
  }

  return parts.join("");
}

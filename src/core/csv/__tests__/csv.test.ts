/**
 * CSV sanitizer corpus tests (R-TEST-04 / R-SEC-10)
 *
 * This test file IS the corpus. Every known formula-injection vector and every
 * legitimate value that must NOT be sanitized must appear here.
 * Never remove an entry — only add.
 */
import { describe, it, expect } from "vitest";
import { sanitizeCell, serializeCell, quoteField, serializeCsv } from "@/core/csv";

describe("sanitizeCell — formula injection corpus", () => {
  // ── Injection triggers — must be prefixed with "'" ─────────────────────────
  it.each([
    ["=SUM(A1:A10)",           "'=SUM(A1:A10)"],
    ["=CMD|' /C calc'!A0",    "'=CMD|' /C calc'!A0"],
    ["+1-2",                   "'+1-2"],
    ["-2+3",                   "'-2+3"],
    ["@SUM(1+1)",              "'@SUM(1+1)"],
    ["\tinjection",            "'\tinjection"],
    ["\rinjection",            "'\rinjection"],
    ["=HYPERLINK(\"evil\")",   "'=HYPERLINK(\"evil\")"],
  ])("sanitizes injection string %j to %j", (input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });

  // ── Safe strings — must NOT be modified ────────────────────────────────────
  it.each([
    ["Hello World"],
    ["normal text"],
    [""],
    ["A name with spaces"],
    ["email@example.com"],
    ["https://example.com"],
    ["Team Name: Alpha"],
    [" leading space"],    // space is NOT an injection char
    ["/ path/like"],
    ["(parentheses)"],
    ["[brackets]"],
    ["{braces}"],
    ["#hashtag"],
    ["1234"],
    ["3.14159"],
    ["null"],
    ["false"],
    ["true"],
    ["100%"],
  ])("does not modify safe string %j", (input) => {
    expect(sanitizeCell(input)).toBe(input);
  });
});

describe("serializeCell — type handling", () => {
  it("serializes null as empty string", () => {
    expect(serializeCell(null)).toBe("");
  });
  it("serializes undefined as empty string", () => {
    expect(serializeCell(undefined)).toBe("");
  });
  it("serializes number without modification", () => {
    expect(serializeCell(-2.5)).toBe("-2.5");
  });
  it("serializes 0 without modification", () => {
    expect(serializeCell(0)).toBe("0");
  });
  it("serializes true as 'true'", () => {
    expect(serializeCell(true)).toBe("true");
  });
  it("serializes false as 'false'", () => {
    expect(serializeCell(false)).toBe("false");
  });
  it("serializes Date as ISO-8601 UTC", () => {
    const d = new Date("2026-09-25T00:00:00Z");
    expect(serializeCell(d)).toBe("2026-09-25T00:00:00.000Z");
  });
  it("does NOT sanitize numeric column strings", () => {
    expect(serializeCell("-2.5", true)).toBe("-2.5");
  });
});

describe("quoteField — RFC 4180 quoting", () => {
  it("leaves plain strings unquoted", () => {
    expect(quoteField("hello")).toBe("hello");
  });
  it("quotes strings containing commas", () => {
    expect(quoteField("a,b")).toBe('"a,b"');
  });
  it("quotes strings containing double-quotes (doubled)", () => {
    expect(quoteField('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes strings containing newlines", () => {
    expect(quoteField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("quotes strings containing CR", () => {
    expect(quoteField("line1\rline2")).toBe('"line1\rline2"');
  });
});

describe("serializeCsv — integration", () => {
  it("produces RFC 4180 output with CRLF line endings", () => {
    const cols = [
      { header: "Name", key: "name" },
      { header: "Score", key: "score", isNumeric: true },
    ];
    const rows = [
      { name: "Alice", score: 42 },
      { name: "Bob, Jr.", score: -1 },
      { name: "=DANGER", score: 0 },
    ];
    const out = serializeCsv(cols, rows, false);
    const lines = out.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("Name,Score");
    expect(lines[1]).toBe("Alice,42");
    expect(lines[2]).toBe('"Bob, Jr.",-1');
    // injection sanitization + quoting
    expect(lines[3]).toBe("'=DANGER,0");
  });

  it("prepends BOM when requested", () => {
    const out = serializeCsv([{ header: "X", key: "x" }], [{ x: "y" }], true);
    expect(out.startsWith("\uFEFF")).toBe(true);
  });
});

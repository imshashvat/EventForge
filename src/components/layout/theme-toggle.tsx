/**
 * ThemeToggle — client component to switch dark/light theme
 *
 * Writes data-theme attribute to <html>. Dark is default.
 * Uses localStorage to persist preference across sessions.
 * No flash: dark is server-rendered default.
 */
"use client";

import * as React from "react";

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");

  // Read persisted theme on mount
  React.useEffect(() => {
    const stored = localStorage.getItem("ef-theme") as "dark" | "light" | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next === "dark" ? "" : "light");
    localStorage.setItem("ef-theme", next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: "44px",
        padding: "0 12px",
        background: "transparent",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
        fontSize: "14px",
        cursor: "pointer",
        transition: "color 150ms, border-color 150ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
      }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

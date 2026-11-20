/**
 * CSV for the admin exports: one quoting rule for every file ADCode hands an administrator.
 *
 * Spreadsheets run a cell that starts with = + - or @ as a formula, and model names, traffic
 * sources and shared comments are typed by other people, so such a cell gets a leading quote.
 * Numbers are left alone: a negative change is still a number in Excel and Sheets.
 */
export function csvCell(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to a file Excel opens as UTF-8 (byte-order mark, CRLF line ends). */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** A safe download name: letters, digits, dots and dashes only. */
export function exportFilename(parts: readonly string[], extension: "csv" | "json"): string {
  const stem = parts.map((part) => part.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).join("-");
  return `${stem.slice(0, 120) || "adcode-export"}.${extension}`;
}

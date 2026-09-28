/**
 * Hostile-renderer validation for editing project memory from the Tools page.
 *
 * A memory name becomes a file under `.adcode/memory`, so it is checked with the memory
 * package's own name rules - the same compiled-in alphabet the MCP server applies to names
 * from connected agents. Session notes are the assistant's own log and are not writable here.
 */
import { isValidName, normalizeName } from "@adcode/memory";
import type { MemoryWriteInputView } from "../shared/api.ts";

const WRITABLE_KINDS = new Set(["decision", "convention", "preference"]);

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.includes("\u0000")) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

export function parseMemoryName(value: unknown): string | null {
  if (typeof value !== "string" || !isValidName(value)) return null;
  return normalizeName(value);
}

export function parseMemoryWrite(value: unknown): MemoryWriteInputView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = parseMemoryName(raw["name"]);
  const description = text(raw["description"], 300);
  const body = text(raw["body"], 20_000);
  const type = raw["type"];
  if (name === null || description === null || body === null || typeof type !== "string" || !WRITABLE_KINDS.has(type)) return null;
  return { name, description, type: type as MemoryWriteInputView["type"], body };
}

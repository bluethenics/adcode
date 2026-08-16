/**
 * Markdown-with-frontmatter, parsed and serialized.
 *
 * Brief §5.1 makes markdown the source of truth and requires the store be "git-diffable
 * and human-readable": "What does this thing know about me?" must have an answer the
 * user can point at, open, edit, and delete.
 *
 * That last part - the user can edit it - is why this parser is defensive. A file on
 * disk is not necessarily one this build wrote: it may have been hand-edited, merged by
 * git, or produced by another agent. Anything that does not parse cleanly is rejected
 * rather than half-understood.
 *
 * This is a deliberately small YAML *subset*, not YAML. Pulling in a real YAML parser
 * would add a dependency and a much larger attack surface to read five known keys.
 */
import { MEMORY_KINDS, isValidName, normalizeName } from "./names.ts";
import type { MemoryKind, MemoryRecord } from "./types.ts";

const DELIMITER = "---";

/** A value needs quoting if it could be misread on the way back in. */
function needsQuoting(value: string): boolean {
  return (
    value.includes(":") ||
    value.includes("#") ||
    value.startsWith("[") ||
    value.startsWith('"') ||
    value.trim() !== value
  );
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];

  return inner
    .split(",")
    .map((entry) => unquote(entry))
    .filter((entry) => entry.length > 0);
}

export function parseMemory(text: string): MemoryRecord | null {
  if (typeof text !== "string") return null;

  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${DELIMITER}\n`)) return null;

  // Only the first delimiter *after* the opening one closes the block. A `---` later in
  // the body is a horizontal rule, which is ordinary markdown; treating it as a
  // terminator would silently truncate the memory at its first rule.
  const rest = normalized.slice(DELIMITER.length + 1);
  const closeIndex = rest.indexOf(`\n${DELIMITER}`);
  if (closeIndex === -1) return null;

  const header = rest.slice(0, closeIndex);
  const afterDelimiter = rest.slice(closeIndex + 1 + DELIMITER.length);
  const body = afterDelimiter.replace(/^\n+/, "").trim();

  const fields = new Map<string, string>();
  for (const line of header.split("\n")) {
    if (line.trim().length === 0) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.length > 0) fields.set(key, value);
  }

  const name = normalizeName(unquote(fields.get("name") ?? ""));
  const description = unquote(fields.get("description") ?? "");
  const rawType = unquote(fields.get("type") ?? "");
  const created = unquote(fields.get("created") ?? "");

  if (!isValidName(name)) return null;
  if (description.length === 0) return null;
  if (!MEMORY_KINDS.includes(rawType as MemoryKind)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) return null;

  return {
    name,
    description,
    type: rawType as MemoryKind,
    created,
    agents: parseList(fields.get("agents") ?? "[]"),
    body,
  };
}

export function serializeMemory(record: MemoryRecord): string {
  const description = record.description.trim();
  const agents = record.agents.map((agent) => agent.trim()).filter((agent) => agent.length > 0);

  const header = [
    DELIMITER,
    `name: ${record.name}`,
    `description: ${needsQuoting(description) ? quote(description) : description}`,
    `type: ${record.type}`,
    `created: ${record.created}`,
    `agents: [${agents.join(", ")}]`,
    DELIMITER,
  ].join("\n");

  return `${header}\n\n${record.body.trim()}\n`;
}

/** `[[wiki-links]]`, which is how §5.1 relates one memory to another. */
export function extractLinks(body: string): string[] {
  if (typeof body !== "string") return [];

  const found = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]]{1,160})\]\]/g)) {
    const candidate = normalizeName(match[1] ?? "");
    if (isValidName(candidate)) found.add(candidate);
  }

  return [...found];
}

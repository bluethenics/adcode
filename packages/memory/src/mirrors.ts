/**
 * The generated mirrors, `AGENTS.md` and `CLAUDE.md`, and the project-context digest.
 *
 * Brief §5.1: "They exist so an agent that speaks neither MCP nor your schema still gets
 * the context by reading a file it already looks for."
 *
 * Both mirrors are byte-identical on purpose. They are two filenames for one idea, and
 * the only reason there are two is that different tools look for different names -
 * letting them drift would mean an agent's behaviour depended on which one it happened
 * to read.
 *
 * Pure: takes records, returns text.
 */
import { MEMORY_KINDS } from "./names.ts";
import type { MemoryKind, MemoryRecord } from "./types.ts";

const HEADINGS: Readonly<Record<MemoryKind, string>> = {
  decision: "Decisions",
  convention: "Conventions",
  preference: "Preferences",
  session: "Recent sessions",
};

const WARNING = [
  "<!--",
  "  GENERATED FILE - do not edit.",
  "",
  "  Rewritten from .adcode/memory/**/*.md on every memory write. Any edit here is lost",
  "  on the next one. Edit the markdown files instead; they are the source of truth.",
  "-->",
].join("\n");

/** How many session entries to mirror. The full log stays on disk. */
const SESSION_LIMIT = 5;

export function renderMirror(records: readonly MemoryRecord[]): string {
  const lines: string[] = [WARNING, "", "# Project memory", ""];

  if (records.length === 0) {
    lines.push("No memories recorded yet.", "");
    return lines.join("\n");
  }

  lines.push(
    "Shared memory for every AI working in this project. Read this first; it is the",
    "cheapest way to find out what has already been decided and why.",
    "",
  );

  for (const kind of MEMORY_KINDS) {
    const inKind = records.filter((record) => record.type === kind);
    if (inKind.length === 0) continue;

    const shown = kind === "session" ? inKind.slice(-SESSION_LIMIT).reverse() : inKind;

    lines.push(`## ${HEADINGS[kind]}`, "");

    for (const record of shown) {
      lines.push(`### ${record.name}`, "", `${record.description}`, "");

      if (record.body.length > 0) {
        lines.push(record.body, "");
      }
    }
  }

  return lines.join("\n");
}

/**
 * §5.2's `project_context()`: "The digest a fresh agent should read first."
 *
 * Deliberately shorter than the mirror - descriptions only, no bodies. A fresh agent
 * calling this wants to know what is known, so it can then read the two memories that
 * matter; handing it the whole store would spend its context on the answer to a question
 * it has not asked yet.
 */
export function renderProjectContext(records: readonly MemoryRecord[]): string {
  if (records.length === 0) {
    return [
      "# Project context",
      "",
      "No memories have been recorded for this project yet.",
      "",
      "Use `memory_write` to record a decision, convention, or preference worth keeping.",
    ].join("\n");
  }

  const lines: string[] = ["# Project context", ""];

  for (const kind of MEMORY_KINDS) {
    const inKind = records.filter((record) => record.type === kind);
    if (inKind.length === 0) continue;

    const shown = kind === "session" ? inKind.slice(-SESSION_LIMIT).reverse() : inKind;

    lines.push(`## ${HEADINGS[kind]}`, "");
    for (const record of shown) {
      lines.push(`- **${record.name}** - ${record.description}`);
    }
    lines.push("");
  }

  lines.push(
    `${records.length} ${records.length === 1 ? "memory" : "memories"} total.`,
    "Call `memory_read(name)` for the full text of any of them.",
  );

  return lines.join("\n");
}

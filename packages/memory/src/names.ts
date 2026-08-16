/**
 * Memory names, and the paths they map to.
 *
 * Brief §5.2 exposes `memory_write(name, ...)` over MCP, so this name arrives from
 * whatever agent is connected and becomes a file on the user's disk. It is untrusted in
 * exactly the way an ad creative is, and gets the same shape of defence: a compiled-in
 * alphabet it must match, checked in one place, with a property test asserting nothing
 * gets past it.
 *
 * Pure: no I/O, no clock.
 */

export type MemoryKind = "decision" | "convention" | "preference" | "session";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "decision",
  "convention",
  "preference",
  "session",
];

/** §5.1's layout: one directory per kind. */
const DIRECTORY: Readonly<Record<MemoryKind, string>> = {
  decision: "decisions",
  convention: "conventions",
  preference: "preferences",
  session: "sessions",
};

const MAX_NAME_LENGTH = 128;

/**
 * Letters, digits, and internal hyphens. No dots, so `..` cannot be spelled; no
 * separators, so a name cannot describe a directory; no underscores, keeping the store
 * uniformly kebab-case and git-diffable at a glance.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Device names Windows still reserves, with or without an extension: `CON.md` is not a
 * file. The store must behave identically on every platform, so these are rejected
 * everywhere rather than only where they would fail.
 */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Lowercase and trim.
 *
 * Lowercasing is not cosmetic. Windows and macOS filesystems are case-insensitive, so
 * `Foo` and `foo` would be one file but two memories, and which one survived would
 * depend on the order they happened to be written.
 */
export function normalizeName(raw: string): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function isValidName(raw: string): boolean {
  const name = normalizeName(raw);

  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (!NAME_PATTERN.test(name)) return false;
  if (RESERVED.has(name)) return false;

  return true;
}

/** The path of a memory relative to the store root, or `null` if the name is rejected. */
export function relativePathFor(kind: MemoryKind, rawName: string): string | null {
  if (!isValidName(rawName)) return null;

  const directory = DIRECTORY[kind];
  if (directory === undefined) return null;

  return `${directory}/${normalizeName(rawName)}.md`;
}

export function directoryFor(kind: MemoryKind): string {
  return DIRECTORY[kind];
}

export function kindForDirectory(directory: string): MemoryKind | null {
  for (const kind of MEMORY_KINDS) {
    if (DIRECTORY[kind] === directory) return kind;
  }
  return null;
}

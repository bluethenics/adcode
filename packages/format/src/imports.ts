/**
 * Sorting and pruning the import block.
 *
 * Only the contiguous run of imports at the top of the file is touched. An import further
 * down is there for a reason - a lazy require inside a branch, a deliberate ordering around
 * a side effect - and hoisting it would change when it runs.
 *
 * **Pruning is deliberately timid.** A statement is dropped only when *none* of the names it
 * binds appear anywhere else in the file. A statement where some names are used is kept
 * whole rather than rewritten, because editing a binding list correctly means handling
 * aliases, type-only specifiers, and default-plus-named forms, and getting that subtly
 * wrong deletes code somebody needs. Side-effect imports - `import "./styles.css"` - bind
 * nothing and are never dropped.
 *
 * The reference check is textual. A name used only inside a string or a comment counts as
 * used, which errs towards keeping an import nobody needs rather than removing one somebody
 * does.
 */
import { toLines, type FormatOptions } from "./types.ts";

const IMPORT_LANGUAGES = new Set([
  "javascript", "typescript", "javascriptreact", "typescriptreact",
]);

export const organizeSupported = (languageId: string): boolean => IMPORT_LANGUAGES.has(languageId);

interface ImportLine {
  readonly text: string;
  readonly source: string;
  readonly names: readonly string[];
  /** `import "./x.css"` - binds nothing, runs for effect. */
  readonly sideEffect: boolean;
}

const IMPORT_START = /^\s*import\b/;
const FROM = /from\s*["']([^"']+)["']/;
const BARE = /^\s*import\s*["']([^"']+)["']/;

/** Every identifier an import statement introduces. */
function bindingsOf(statement: string): string[] {
  const beforeFrom = statement.split(/\bfrom\b/)[0] ?? "";
  const body = beforeFrom.replace(/^\s*import\b/, "").replace(/\btype\b/g, "");

  const names: string[] = [];

  // `{ a, b as c }` - the local name is what matters, so an alias contributes only `c`.
  const braces = /\{([^}]*)\}/.exec(body);
  if (braces !== null) {
    for (const part of (braces[1] ?? "").split(",")) {
      const piece = part.trim();
      if (piece.length === 0) continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)/.exec(piece);
      names.push(alias?.[1] ?? (/^([A-Za-z_$][\w$]*)/.exec(piece)?.[1] ?? ""));
    }
  }

  // The default and namespace forms, which sit outside any braces.
  const outside = body.replace(/\{[^}]*\}/g, "");
  for (const piece of outside.split(",")) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (namespace !== null) {
      names.push(namespace[1] ?? "");
      continue;
    }
    const plain = /^([A-Za-z_$][\w$]*)$/.exec(trimmed);
    if (plain !== null) names.push(plain[1] ?? "");
  }

  return names.filter((name) => name.length > 0);
}

/** Packages before relative paths; that is the order almost every project already uses. */
function rank(source: string): number {
  if (source.startsWith(".")) return 2;
  if (source.startsWith("node:")) return 0;
  return 1;
}

export function organizeImports(text: string, options: FormatOptions): string {
  const lines = toLines(text);

  // Find the contiguous import block, allowing comments and blank lines inside it.
  let end = -1;
  const block: number[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (IMPORT_START.test(line)) {
      // A statement spanning several lines is not handled; leaving it alone is safer than
      // reassembling it wrongly.
      if (!/["']/.test(line)) return text;
      block.push(index);
      end = index;
      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    break;
  }

  if (block.length < 2) return text;

  const statements: ImportLine[] = block.map((index) => {
    const text_ = (lines[index] ?? "").trim();
    const bare = BARE.exec(text_);
    const from = FROM.exec(text_);

    return {
      text: text_,
      source: bare?.[1] ?? from?.[1] ?? "",
      names: bare !== null ? [] : bindingsOf(text_),
      sideEffect: bare !== null,
    };
  });

  // Everything after the import block, which is where a name has to appear to count.
  const rest = lines.slice(end + 1).join("\n");

  const kept = statements.filter((statement) => {
    if (statement.sideEffect) return true;
    if (statement.names.length === 0) return true;
    return statement.names.some((name) =>
      new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(rest),
    );
  });

  const seen = new Set<string>();
  const deduped = kept.filter((statement) => {
    if (seen.has(statement.text)) return false;
    seen.add(statement.text);
    return true;
  });

  const sideEffects = deduped.filter((statement) => statement.sideEffect);
  const rest_ = deduped
    .filter((statement) => !statement.sideEffect)
    .sort((a, b) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source));

  const organised = [...sideEffects, ...rest_].map((statement) => statement.text);

  const after = lines.slice(end + 1);
  while (after.length > 0 && after[0]?.trim() === "") after.shift();

  const result = [...organised, "", ...after];
  while (result.length > 0 && result[result.length - 1]?.trim() === "") result.pop();

  return result.join(options.lineEnding) + options.lineEnding;
}

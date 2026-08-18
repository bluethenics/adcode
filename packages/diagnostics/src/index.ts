/**
 * @adcode/diagnostics - the Diagnostic type, plain-English explanations, and the ordering
 * the Problems panel draws.
 *
 * Plain TypeScript: no Electron, no Monaco, no DOM, no I/O. Monaco's language workers are
 * the only source filling this today, but nothing here knows that - which is what lets the
 * live preview server and a future language server report into the same panel without the
 * panel learning about either.
 */
import type { Diagnostic, FileGroup, Severity, SeverityCounts } from "./types.ts";

export type { Diagnostic, Explanation, FileGroup, Severity, SeverityCounts } from "./types.ts";
export { explain, subject, TABLE, type TableEntry } from "./table.ts";

/** Worst first. The panel's whole job is putting the thing that stops you at the top. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

function comparePositions(a: Diagnostic, b: Diagnostic): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;

  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

/**
 * Group by file, worst file first.
 *
 * "Worst" is the highest severity the file contains, not its count: one file with a single
 * error outranks one with nine warnings, because the error is the one that will not run.
 * Ties break alphabetically so the list does not reshuffle as the user types.
 */
export function groupByFile(diagnostics: readonly Diagnostic[]): FileGroup[] {
  const byFile = new Map<string, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const existing = byFile.get(diagnostic.file);
    if (existing === undefined) byFile.set(diagnostic.file, [diagnostic]);
    else existing.push(diagnostic);
  }

  const groups: FileGroup[] = [];

  for (const [file, items] of byFile) {
    groups.push({ file, diagnostics: [...items].sort(comparePositions) });
  }

  groups.sort((a, b) => {
    const worstA = Math.min(...a.diagnostics.map((d) => SEVERITY_RANK[d.severity]));
    const worstB = Math.min(...b.diagnostics.map((d) => SEVERITY_RANK[d.severity]));
    if (worstA !== worstB) return worstA - worstB;

    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  return groups;
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): SeverityCounts {
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    else if (diagnostic.severity === "warning") warnings += 1;
    else infos += 1;
  }

  return { errors, warnings, infos };
}

/**
 * What the activity-bar badge shows. `null` means no badge at all rather than a zero: a
 * badge reading 0 is a badge that trained the user to ignore badges.
 */
export function badgeFor(counts: SeverityCounts): { text: string; tone: "error" | "warning" } | null {
  if (counts.errors > 0) {
    return { text: counts.errors > 99 ? "99+" : String(counts.errors), tone: "error" };
  }
  if (counts.warnings > 0) {
    return { text: counts.warnings > 99 ? "99+" : String(counts.warnings), tone: "warning" };
  }
  return null;
}

/**
 * The one-line summary in the panel header. Written out in words because "3 errors,
 * 1 warning" is read faster than "3E 1W" by exactly the person this panel is for.
 */
export function summarise(counts: SeverityCounts): string {
  const parts: string[] = [];

  if (counts.errors > 0) parts.push(`${counts.errors} error${counts.errors === 1 ? "" : "s"}`);
  if (counts.warnings > 0) {
    parts.push(`${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`);
  }
  if (counts.infos > 0) parts.push(`${counts.infos} suggestion${counts.infos === 1 ? "" : "s"}`);

  if (parts.length === 0) return "No problems";
  return parts.join(", ");
}

/**
 * The one shape every diagnostic source produces.
 *
 * Monaco's language workers fill this today. A language server (slice 3 of the Language
 * group) and the live preview server will fill the same shape later, which is the point of
 * declaring it in a package rather than inside the panel that happens to draw it first.
 *
 * Positions are one-based, matching Monaco, the editor's status bar, and every compiler a
 * user has ever read output from. Zero-based would be correct for arrays and wrong for
 * everything a person looks at.
 */

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Workspace-relative, forward-slashed. The panel groups on it and shows it verbatim. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: Severity;
  /**
   * Normalised family, not the raw owner: `typescript` and `javascript` both arrive as
   * `ts` because they share one error-code space, and a table keyed by both would be the
   * same forty entries written twice.
   */
  readonly source: string;
  /** The compiler's own code, as a string. Empty when the source does not supply one. */
  readonly code: string;
  /**
   * The original message, kept verbatim and never discarded - only demoted below the
   * rewrite. A translation layer is safe to ship precisely because the real text stays
   * one glance away when the rewrite is wrong.
   */
  readonly message: string;
}

export interface Explanation {
  /** What went wrong, in words that assume no knowledge of the type system. */
  readonly plain: string;
  /** What to do about it. Absent when there is nothing honest to suggest. */
  readonly hint?: string;
}

export interface FileGroup {
  readonly file: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SeverityCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
}

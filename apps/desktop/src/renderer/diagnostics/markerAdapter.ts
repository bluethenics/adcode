/**
 * The one place Monaco and the Problems panel touch.
 *
 * Monaco's language workers already publish everything this panel shows; nothing in this
 * repo had ever read them. This file turns an `IMarker` into the `Diagnostic` that
 * `@adcode/diagnostics` defines, and that is its whole job.
 *
 * Keeping the seam to one file is not tidiness. The live preview server reports its own
 * failures as `Diagnostic`s, and a language server will later report most of them - none
 * of which involve Monaco. If the panel read `IMarker` directly it would have to learn a
 * second shape for every new source; instead every source meets it here or not at all.
 *
 * There is no `monaco-editor` import. The marker type is declared structurally, so the
 * conversion is a pure function testable in milliseconds without a window - the same
 * reason `editorOptions.ts` and `layoutSizes.ts` sit outside the shell they serve.
 */
import type { Diagnostic, Severity } from "@adcode/diagnostics";

/**
 * The part of Monaco's `IMarker` this conversion reads, declared structurally.
 *
 * Checked against the real thing where `subscribeToMarkers` is called: passing an actual
 * `IMarker[]` to a parameter of this type is the compile-time proof that the two agree.
 */
export interface RawMarker {
  readonly owner?: string | undefined;
  readonly source?: string | undefined;
  readonly severity: number;
  readonly code?: string | { readonly value: string } | undefined;
  readonly message: string;
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

/**
 * `MarkerSeverity` is a const enum in Monaco, which `erasableSyntaxOnly` will not let us
 * import as a value. The numbers are part of Monaco's public API and are written out here
 * rather than reached for.
 */
const MARKER_SEVERITY: Readonly<Record<number, Severity>> = {
  1: "info", // Hint - Monaco's lowest rung, shown but never badged
  2: "info",
  4: "warning",
  8: "error",
};

/**
 * Language ids collapse into families, because a family shares one error-code space.
 * TypeScript and JavaScript emit the same numbered errors from the same compiler; a table
 * keyed on both would be the same forty entries written twice.
 */
const SOURCE_FAMILY: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "ts",
  typescriptreact: "ts",
  javascriptreact: "ts",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  handlebars: "html",
  razor: "html",
};

export function sourceFamily(owner: string | undefined, source: string | undefined): string {
  const raw = (owner ?? source ?? "").toLowerCase();
  return SOURCE_FAMILY[raw] ?? raw;
}

/** Monaco carries a code either bare or wrapped with a documentation link. */
export function markerCode(code: RawMarker["code"]): string {
  if (code === undefined) return "";
  if (typeof code === "string") return code;
  return code.value;
}

/**
 * Convert one marker. `file` is the workspace-relative path the caller already resolved -
 * this function does no path arithmetic, because the renderer already has exactly one
 * implementation of that and a second would eventually disagree with it.
 *
 * Returns `null` for a severity Monaco may add later. An unknown severity is not an error
 * to report; it is a row we do not know how to rank, and inventing a rank for it would put
 * it in the wrong place in a list whose entire value is its order.
 */
export function toDiagnostic(marker: RawMarker, file: string): Diagnostic | null {
  const severity = MARKER_SEVERITY[marker.severity];
  if (severity === undefined) return null;

  return {
    file,
    line: marker.startLineNumber,
    column: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
    severity,
    source: sourceFamily(marker.owner, marker.source),
    code: markerCode(marker.code),
    message: marker.message,
  };
}

/**
 * A model's path, expressed relative to the workspace root, or `null` when it lies
 * outside one.
 *
 * This exists rather than reusing the renderer's git-facing `relativePath` because of one
 * Windows detail: `Uri.fsPath` lower-cases a drive letter, so a workspace opened at
 * `E:\work` produces marker paths beginning `e:\work`. A case-sensitive prefix test - the
 * right test for git, which wants an exact path - drops every marker in the workspace on
 * Windows, and the panel simply shows nothing with no error anywhere to explain why.
 *
 * So: exact match first, and only then a case-insensitive one. The fallback cannot open
 * the wrong file, because navigation re-resolves the result against the root rather than
 * using it as a path; the worst it can do on a case-sensitive filesystem is label a row
 * with the casing the root was opened under.
 */
export function workspaceRelative(root: string | null, absolute: string): string | null {
  if (root === null || root.length === 0 || absolute.length === 0) return null;

  const slashed = (value: string): string => value.split("\\").join("/").replace(/\/+$/, "");

  const normalisedRoot = slashed(root);
  const normalisedPath = slashed(absolute);
  if (normalisedRoot.length === 0) return null;

  const prefix = `${normalisedRoot}/`;

  if (normalisedPath.startsWith(prefix)) return normalisedPath.slice(prefix.length);

  if (normalisedPath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalisedPath.slice(prefix.length);
  }

  return null;
}

/**
 * Convert a batch, dropping anything the workspace cannot place.
 *
 * `resolveFile` returns `null` for a model outside the workspace - a file opened from a
 * git commit, a diff view, an untitled buffer. Those genuinely have no row to occupy: the
 * panel groups by workspace path, and a read-only view of an old commit is not a file the
 * user can go and fix.
 */
export function toDiagnostics(
  markers: readonly RawMarker[],
  resolveFile: (marker: RawMarker) => string | null,
): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const marker of markers) {
    const file = resolveFile(marker);
    if (file === null) continue;

    const diagnostic = toDiagnostic(marker, file);
    if (diagnostic !== null) out.push(diagnostic);
  }

  return out;
}

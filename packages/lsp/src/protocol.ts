/**
 * The messages ADCode sends, and the mapping from what comes back into shapes the rest of
 * the app already understands.
 *
 * The only structural thing worth stating loudly: **LSP counts from zero and everything a
 * user looks at counts from one.** Lines and characters on the wire are zero-based; Monaco,
 * the status bar, `@adcode/diagnostics`, and every compiler message a person has ever read
 * are one-based. Every conversion happens here, in two named functions, because an
 * off-by-one that leaks past this file becomes "the error is highlighted on the wrong line"
 * and is then extremely hard to trace back to a subtraction.
 */
import type { Diagnostic, Severity } from "@adcode/diagnostics";

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity?: number;
  readonly code?: string | number;
  readonly source?: string;
  readonly message: string;
}

export interface LspCompletionItem {
  readonly label: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly documentation?: string | { readonly value: string };
  readonly insertText?: string;
  readonly insertTextFormat?: number;
  readonly sortText?: string;
  readonly filterText?: string;
  readonly textEdit?: { readonly range: LspRange; readonly newText: string };
}

/** Zero-based on the wire, one-based everywhere a person can see it. */
export function toEditorLine(lspLine: number): number {
  return lspLine + 1;
}

export function toEditorColumn(lspCharacter: number): number {
  return lspCharacter + 1;
}

export function toLspPosition(line: number, column: number): LspPosition {
  return { line: Math.max(0, line - 1), character: Math.max(0, column - 1) };
}

/**
 * LSP severity numbers to ours.
 *
 * A missing severity means "the client decides", and the spec is explicit about that. We
 * decide error, because a server that bothered to report something and did not rank it is
 * more likely to have found a problem than a note.
 */
const SEVERITY: Readonly<Record<number, Severity>> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info",
};

export function severityFor(lspSeverity: number | undefined): Severity {
  if (lspSeverity === undefined) return "error";
  return SEVERITY[lspSeverity] ?? "info";
}

/**
 * One published diagnostic, in the shape the Problems panel already draws.
 *
 * `source` is the server's own id rather than the `source` field it sent: the explanation
 * table is keyed on a family we control, and a server that calls itself "Pyright" one
 * release and "basedpyright" the next would silently orphan every entry keyed to it.
 */
export function toDiagnostic(
  lsp: LspDiagnostic,
  file: string,
  source: string,
): Diagnostic {
  return {
    file,
    line: toEditorLine(lsp.range.start.line),
    column: toEditorColumn(lsp.range.start.character),
    endLine: toEditorLine(lsp.range.end.line),
    endColumn: toEditorColumn(lsp.range.end.character),
    severity: severityFor(lsp.severity),
    source,
    code: lsp.code === undefined ? "" : String(lsp.code),
    message: lsp.message,
  };
}

/** A `file://` URI for an absolute path, which is the only address LSP speaks. */
export function pathToUri(absolute: string): string {
  const slashed = absolute.split("\\").join("/");
  const withRoot = slashed.startsWith("/") ? slashed : `/${slashed}`;

  // Encoded per segment: a path with a space or a `#` in it is otherwise a different URI
  // than the one the server will echo back, and diagnostics land against nothing.
  const encoded = withRoot
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `file://${encoded}`;
}

export function uriToPath(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, "");
  const decoded = decodeURIComponent(withoutScheme);

  // `/C:/x` is how a Windows path arrives; the leading slash is part of the URI, not the
  // path, and leaving it on produces a path nothing on disk matches.
  return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

/* ── Outgoing messages ─────────────────────────────────────────────────── */

export interface Request {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
}

export interface Notification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params: unknown;
}

export function request(id: number, method: string, params: unknown): Request {
  return { jsonrpc: "2.0", id, method, params };
}

export function notification(method: string, params: unknown): Notification {
  return { jsonrpc: "2.0", method, params };
}

/**
 * What ADCode tells a server it can do.
 *
 * Deliberately small. Announcing a capability the client does not implement is how a server
 * ends up sending requests nobody answers, and several of them block on the reply - so an
 * over-claimed capability presents as a server that hangs on the third keystroke rather
 * than as an obvious mistake.
 */
export function initializeParams(rootPath: string, processId: number | null): unknown {
  return {
    processId,
    rootUri: pathToUri(rootPath),
    workspaceFolders: [{ uri: pathToUri(rootPath), name: "workspace" }],
    capabilities: {
      textDocument: {
        synchronization: { dynamicRegistration: false, didSave: true },
        publishDiagnostics: { relatedInformation: false },
        completion: {
          dynamicRegistration: false,
          completionItem: { snippetSupport: true, documentationFormat: ["plaintext"] },
        },
        hover: { dynamicRegistration: false, contentFormat: ["plaintext"] },
      },
      workspace: { workspaceFolders: true, configuration: false },
    },
  };
}

export function didOpenParams(uri: string, languageId: string, version: number, text: string): unknown {
  return { textDocument: { uri, languageId, version, text } };
}

/**
 * Full-text sync on every change.
 *
 * Incremental sync is the protocol's preferred mode and is measurably cheaper, but it
 * requires the client and server to agree exactly on the document's state after every edit
 * - and when they drift, the server is analysing a file that does not exist, reporting
 * errors at positions that do not correspond to anything. Full text cannot drift. Until
 * there is a measurement showing this is too slow, correctness wins.
 */
export function didChangeParams(uri: string, version: number, text: string): unknown {
  return { textDocument: { uri, version }, contentChanges: [{ text }] };
}

export function didCloseParams(uri: string): unknown {
  return { textDocument: { uri } };
}

export function positionParams(uri: string, line: number, column: number): unknown {
  return { textDocument: { uri }, position: toLspPosition(line, column) };
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

/**
 * One edit a server wants applied, in the editor's own one-based coordinates.
 *
 * Converted here rather than in the renderer for the same reason completions are: the reply
 * is arbitrary JSON from a subprocess, and the place to turn it into a checked shape is
 * before it reaches anything that will act on it.
 */
export interface EditorTextEdit {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly text: string;
}

export interface FormattingOptions {
  readonly tabSize: number;
  readonly insertSpaces: boolean;
}

export function formattingParams(uri: string, options: FormattingOptions): unknown {
  return {
    textDocument: { uri },
    // The protocol's own names. `trimFinalNewlines` is deliberately not requested: some
    // servers read it as "remove the final newline entirely", which every other tool then
    // puts back.
    options: {
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces,
      trimTrailingWhitespace: true,
      insertFinalNewline: true,
    },
  };
}

function isPosition(value: unknown): value is LspPosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as { line?: unknown; character?: unknown };
  return typeof position.line === "number" && typeof position.character === "number";
}

/**
 * Validate a formatting reply into edits, or return null.
 *
 * `null` means "this server did not answer with edits" - it does not support formatting,
 * it timed out, or it sent something unrecognisable - and the caller falls back to the
 * built-in formatter. An empty array is a different answer entirely: the server formatted
 * the file and found nothing to change, and falling back there would undo its opinion.
 */
export function toEditorEdits(raw: unknown): EditorTextEdit[] | null {
  if (!Array.isArray(raw)) return null;

  const edits: EditorTextEdit[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;

    const { range, newText } = entry as { range?: unknown; newText?: unknown };
    if (typeof newText !== "string") return null;
    if (typeof range !== "object" || range === null) return null;

    const { start, end } = range as { start?: unknown; end?: unknown };
    if (!isPosition(start) || !isPosition(end)) return null;

    edits.push({
      startLine: toEditorLine(start.line),
      startColumn: toEditorColumn(start.character),
      endLine: toEditorLine(end.line),
      endColumn: toEditorColumn(end.character),
      text: newText,
    });
  }

  return edits;
}

/* ── Definitions ──────────────────────────────────────────────────────────── */

/** Where a symbol is defined, in the editor's one-based coordinates. */
export interface EditorLocation {
  /** Absolute path, converted from the server's file URI. */
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

function locationFrom(value: unknown): EditorLocation | null {
  if (typeof value !== "object" || value === null) return null;

  // `Location` has `uri`; `LocationLink` has `targetUri` and `targetSelectionRange`. Both
  // are legal answers to the same request, and a client that reads only one of them works
  // with half the servers in the wild.
  const raw = value as {
    uri?: unknown;
    range?: unknown;
    targetUri?: unknown;
    targetSelectionRange?: unknown;
    targetRange?: unknown;
  };

  const uri = typeof raw.uri === "string" ? raw.uri : typeof raw.targetUri === "string" ? raw.targetUri : null;
  if (uri === null) return null;

  const range = (raw.range ?? raw.targetSelectionRange ?? raw.targetRange) as
    | { start?: unknown; end?: unknown }
    | undefined;
  if (range === undefined) return null;

  const start = range.start as { line?: unknown; character?: unknown } | undefined;
  const end = (range.end ?? range.start) as { line?: unknown; character?: unknown } | undefined;
  if (typeof start?.line !== "number" || typeof start.character !== "number") return null;
  if (typeof end?.line !== "number" || typeof end.character !== "number") return null;

  return {
    path: uriToPath(uri),
    line: toEditorLine(start.line),
    column: toEditorColumn(start.character),
    endLine: toEditorLine(end.line),
    endColumn: toEditorColumn(end.character),
  };
}

/**
 * Validate a definition reply into locations.
 *
 * `null` means the server had no answer - it does not support the request, it timed out, or
 * it genuinely does not know. The caller then falls back to searching by name, and says so
 * in the UI.
 */
export function toEditorLocations(raw: unknown): EditorLocation[] | null {
  if (raw === null || raw === undefined) return null;

  const values = Array.isArray(raw) ? raw : [raw];
  const locations = values.map(locationFrom).filter((one): one is EditorLocation => one !== null);

  return locations.length === 0 ? null : locations;
}

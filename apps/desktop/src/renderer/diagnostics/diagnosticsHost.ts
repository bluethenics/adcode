/**
 * Everything that has to know Monaco exists in order to feed the Problems panel.
 *
 * `markerAdapter.ts` holds the conversion, which is pure and tested. This file holds the
 * three things that cannot be: the subscription, the hover, and the code-fix round trip.
 * Keeping them apart is what makes the interesting half testable in milliseconds.
 */
import * as monaco from "monaco-editor";
/*
 * The worker accessors moved in monaco-editor 0.56: `monaco.languages.typescript` is now
 * typed `{ deprecated: true }` and carries nothing. The language features live under
 * `languages/features/*` and are imported directly. Getting this wrong is a compile error
 * rather than a runtime surprise, which is the good outcome.
 */
import {
  getJavaScriptWorker,
  getTypeScriptWorker,
} from "monaco-editor/languages/features/typescript/register.js";
import type { Diagnostic } from "@adcode/diagnostics";
import { explain } from "@adcode/diagnostics";
import { toDiagnostics, workspaceRelative, type RawMarker } from "./markerAdapter.ts";
import type { QuickFix } from "../panels/problemsPanel.ts";

/**
 * Markers change on nearly every keystroke, and the panel redraws its whole list. Coalesce
 * a burst into one redraw: the same reason quick open debounces rather than querying per
 * character - nothing the user types may ever wait on anything (§7).
 */
const REDRAW_DEBOUNCE_MS = 90;

/** Languages whose workers publish markers today, and so the ones worth hovering. */
const COVERED_LANGUAGES = [
  "typescript",
  "javascript",
  "json",
  "css",
  "scss",
  "less",
  "html",
];

export interface DiagnosticsHost {
  /** Current diagnostics for every open model inside the workspace. */
  current(): readonly Diagnostic[];
  onChange(listener: (diagnostics: readonly Diagnostic[]) => void): void;
  /** Resolved on click, never on render. Empty when the language has nothing to offer. */
  quickFixes(diagnostic: Diagnostic): Promise<readonly QuickFix[]>;
  /** Re-read markers now - used when the workspace root changes under us. */
  refresh(): void;
  /**
   * Replace everything reported by a non-Monaco source.
   *
   * This is the seam the panel was designed around: the live preview server reports a
   * failed start through here, and a language server will report most of its findings the
   * same way. Whole-source replacement rather than add/remove because a source always
   * knows its complete current set, and reconciling deltas is how a panel ends up showing
   * an error that was fixed ten minutes ago.
   */
  setExternal(source: string, diagnostics: readonly Diagnostic[]): void;
  /**
   * `adcode.formatting.lintDiagnostics`.
   *
   * Off means nothing is reported anywhere - no rows in the panel, no badge, no inline
   * lens. The markers themselves are left alone: turning the reporting off is a statement
   * about what the user wants shown, not a reason to stop the compiler working, and
   * turning it back on has to be instant rather than a recompile.
   */
  setEnabled(enabled: boolean): void;
}

export interface DiagnosticsHostDeps {
  /** The open folder, or null. Read fresh on every pass: it changes while we are alive. */
  readonly workspaceRoot: () => string | null;
  /**
   * Does this model belong in the panel at all?
   *
   * Being inside the workspace is not enough, and assuming it was shipped a real bug: the
   * commit browser and the diff views create Monaco models for historical revisions of
   * files, and those models get type-checked like any other. The panel filled up with
   * errors in `tsconfig.json` and `vitest.config.ts` - files the user had not opened, in
   * versions they could not edit, checked outside the project that gives them meaning.
   *
   * The panel's own empty state promises "errors in your open files". This is the
   * predicate that makes that sentence true.
   */
  readonly includeFile: (fsPath: string) => boolean;
  /**
   * `adcode.editing.plainEnglishErrors`. Off means the hover returns nothing and Monaco
   * shows its own, which is the right fallback - suppressing our rewrite to substitute the
   * raw message would also suppress the type information Monaco's hover carries with it.
   */
  readonly explanationsEnabled: () => boolean;
}

export function createDiagnosticsHost(deps: DiagnosticsHostDeps): DiagnosticsHost {
  const listeners: ((diagnostics: readonly Diagnostic[]) => void)[] = [];

  let fromMarkers: readonly Diagnostic[] = [];

  /** Keyed by source, so each reporter replaces only its own rows. */
  const fromElsewhere = new Map<string, readonly Diagnostic[]>();

  let enabled = true;

  function merged(): readonly Diagnostic[] {
    if (!enabled) return [];
    if (fromElsewhere.size === 0) return fromMarkers;
    return [...fromMarkers, ...[...fromElsewhere.values()].flat()];
  }

  function announce(): void {
    const all = merged();
    for (const listener of listeners) listener(all);
  }

  /**
   * Relative path back to the model it came from.
   *
   * Rebuilding an absolute path from the relative one and re-parsing it into a Uri would
   * work almost always, and fail exactly where `workspaceRelative` had to be forgiving
   * about drive-letter casing. Remembering the Uri we already held costs one map.
   */
  const modelByFile = new Map<string, monaco.Uri>();

  let timer: ReturnType<typeof setTimeout> | null = null;

  function collect(): void {
    const root = deps.workspaceRoot();
    const markers = monaco.editor.getModelMarkers({});

    modelByFile.clear();

    fromMarkers = toDiagnostics(markers as readonly RawMarker[], (marker) => {
      // `getModelMarkers` returns `IMarker`, which carries its resource; the structural
      // `RawMarker` deliberately does not, so the pure conversion never learns about Uri.
      const resource = (marker as unknown as { resource: monaco.Uri }).resource;
      if (!deps.includeFile(resource.fsPath)) return null;

      const relative = workspaceRelative(root, resource.fsPath);

      if (relative !== null) modelByFile.set(relative, resource);
      return relative;
    });

    announce();
  }

  function scheduleCollect(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      collect();
    }, REDRAW_DEBOUNCE_MS);
  }

  monaco.editor.onDidChangeMarkers(() => scheduleCollect());

  // A model closing does not always emit a marker change, and a panel still listing errors
  // for a file the user closed is a panel that sends them somewhere that is not there.
  monaco.editor.onWillDisposeModel(() => scheduleCollect());
  monaco.editor.onDidCreateModel(() => scheduleCollect());

  /**
   * Show the plain-English explanation where the eye already is.
   *
   * Returning `null` when we have no rewrite is deliberate: Monaco then falls through to
   * its own hover, which shows the compiler's message and the type information. Returning
   * the raw message ourselves would suppress that and trade information for nothing.
   */
  monaco.languages.registerHoverProvider(COVERED_LANGUAGES, {
    provideHover(model, position) {
      if (!deps.explanationsEnabled()) return null;

      const markers = monaco.editor.getModelMarkers({ resource: model.uri });

      for (const marker of markers) {
        const range = new monaco.Range(
          marker.startLineNumber,
          marker.startColumn,
          marker.endLineNumber,
          marker.endColumn,
        );
        if (!range.containsPosition(position)) continue;

        if (!deps.includeFile(model.uri.fsPath)) return null;

        const root = deps.workspaceRoot();
        const file = workspaceRelative(root, model.uri.fsPath) ?? model.uri.fsPath;
        const converted = toDiagnostics([marker as RawMarker], () => file)[0];
        if (converted === undefined) continue;

        const explanation = explain(converted);
        if (explanation === null) continue;

        const lines = [`**${explanation.plain}**`];
        if (explanation.hint !== undefined) lines.push(`→ ${explanation.hint}`);

        return {
          range,
          contents: lines.map((value) => ({ value })),
        };
      }

      return null;
    },
  });

  /**
   * Ask the TypeScript worker for the same quick fixes VS Code's lightbulb shows.
   *
   * `getCodeFixesAtPosition` is public, typed API on the worker; nothing here invents an
   * edit. Every other language returns nothing rather than a button that does nothing.
   */
  async function quickFixes(diagnostic: Diagnostic): Promise<readonly QuickFix[]> {
    const uri = modelByFile.get(diagnostic.file);
    if (uri === undefined) return [];

    const model = monaco.editor.getModel(uri);
    if (model === null) return [];

    const code = Number(diagnostic.code);
    if (!Number.isFinite(code)) return [];

    const language = model.getLanguageId();
    const accessor =
      language === "javascript" || language === "javascriptreact"
        ? await getJavaScriptWorker()
        : await getTypeScriptWorker();

    const client = await accessor(model.uri);

    const start = model.getOffsetAt({
      lineNumber: diagnostic.line,
      column: diagnostic.column,
    });
    const end = model.getOffsetAt({
      lineNumber: diagnostic.endLine,
      column: diagnostic.endColumn,
    });

    const actions = await client.getCodeFixesAtPosition(
      model.uri.toString(),
      start,
      end,
      [code],
      {},
    );

    return actions.map((action: unknown) => {
      const fix = action as {
        description: string;
        changes: { fileName: string; textChanges: { span: { start: number; length: number }; newText: string }[] }[];
      };

      return {
        title: fix.description,
        apply(): void {
          for (const change of fix.changes) {
            const target = monaco.editor.getModel(monaco.Uri.parse(change.fileName));
            if (target === null) continue;

            // `pushEditOperations` rather than `applyEdits`: the edit belongs on the undo
            // stack. A fix a beginner cannot undo with Ctrl+Z is a fix they cannot risk.
            target.pushEditOperations(
              [],
              change.textChanges.map((edit) => {
                const from = target.getPositionAt(edit.span.start);
                const to = target.getPositionAt(edit.span.start + edit.span.length);

                return {
                  range: new monaco.Range(
                    from.lineNumber,
                    from.column,
                    to.lineNumber,
                    to.column,
                  ),
                  text: edit.newText,
                };
              }),
              () => null,
            );
          }
        },
      };
    });
  }

  collect();

  return {
    current: merged,

    onChange(listener) {
      listeners.push(listener);
      listener(merged());
    },

    quickFixes,
    refresh: collect,

    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      // Announced immediately: the panel, the badge and the status bar all listen, and a
      // switch whose effect waits for the next compile reads as broken.
      announce();
    },

    setExternal(source, incoming) {
      if (incoming.length === 0) {
        if (!fromElsewhere.delete(source)) return;
      } else {
        fromElsewhere.set(source, [...incoming]);
      }

      announce();
    },
  };
}

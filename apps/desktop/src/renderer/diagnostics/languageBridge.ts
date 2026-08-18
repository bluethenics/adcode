/**
 * Language servers, from the renderer's side.
 *
 * Four jobs, and they all exist because slice 1 built the seams for them:
 *
 * 1. Tell the main process which documents are open and what is in them.
 * 2. Push the diagnostics that come back into the Problems panel, through the same
 *    `setExternal` the live preview uses.
 * 3. Offer the server's completions to Monaco's suggest widget, alongside the keyword
 *    tables rather than instead of them.
 * 4. Say something useful when a language has a server that is not installed.
 *
 * That fourth one is the difference between an editor that appears not to support Python
 * and one that needs a two-minute install. It reports as `info`, so it never badges the
 * activity bar - a missing optional tool is not a problem with the user's code, and the
 * badge is reserved for things that are.
 */
import * as monaco from "monaco-editor";
import type { Diagnostic } from "@adcode/diagnostics";
import type { LanguageCompletion, LanguageServerState } from "../../shared/api.ts";
import { workspaceRelative } from "./markerAdapter.ts";

/**
 * Long enough that a burst of typing is one message, short enough that the squiggle feels
 * like it belongs to the keystroke. Sending on every character makes a full-text sync
 * quadratic in a large file for no benefit anyone can perceive.
 */
const SYNC_DEBOUNCE_MS = 250;

export interface LanguageBridgeDeps {
  readonly workspaceRoot: () => string | null;
  /** Replace everything this source has reported. */
  readonly publish: (diagnostics: readonly Diagnostic[]) => void;
}

/**
 * LSP's `CompletionItemKind` to Monaco's.
 *
 * The two enumerations agree on their numbering for the values both define, which is not a
 * coincidence - Monaco's came from the protocol. Mapping through a table rather than
 * casting the number keeps that an observation about today rather than an assumption.
 */
const COMPLETION_KIND: Readonly<Record<number, monaco.languages.CompletionItemKind>> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter,
};

export interface LanguageBridge {
  /** Current server states, for the status bar and settings. */
  states(): readonly LanguageServerState[];
  onStateChange(listener: (states: readonly LanguageServerState[]) => void): void;
}

export function createLanguageBridge(deps: LanguageBridgeDeps): LanguageBridge {
  /** Diagnostics from servers, keyed by workspace-relative path. */
  const byFile = new Map<string, Diagnostic[]>();

  /** Which languages currently have a document open, so a missing server has somewhere to report. */
  const openByLanguage = new Map<string, Set<string>>();

  let serverStates: readonly LanguageServerState[] = [];
  const stateListeners: ((states: readonly LanguageServerState[]) => void)[] = [];

  /**
   * Gated on the path alone, deliberately - not on "is there an editable tab for this".
   *
   * `onDidCreateModel` fires while the model is being built, which is *before* the shell
   * has pushed the tab that would make the tab test pass. Gating on it meant every document
   * was rejected at exactly the moment it mattered and nothing ever retried, so no server
   * was ever told about anything.
   *
   * The path test is time-independent and covers the case the tab test existed for anyway:
   * historical buffers are keyed `adcode-commit-diff:…` and `adcode-local:…`, which do not
   * resolve inside the workspace and are filtered here for free.
   */
  function relativeFor(model: monaco.editor.ITextModel): string | null {
    return workspaceRelative(deps.workspaceRoot(), model.uri.fsPath);
  }

  /**
   * One `info` row per language whose server is missing, attached to a file of that
   * language that is actually open.
   *
   * Attached to a real file rather than invented as its own group, because the panel groups
   * by file and a group called "Python" would be the only row in it that is not a place the
   * user can go and look.
   */
  function missingServerRows(): Diagnostic[] {
    const rows: Diagnostic[] = [];

    for (const state of serverStates) {
      if (state.status !== "missing" && state.status !== "failed") continue;

      const files = openByLanguage.get(state.languageId);
      const file = files === undefined ? undefined : [...files][0];
      if (file === undefined) continue;

      rows.push({
        file,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
        severity: "info",
        source: "adcode",
        code: "",
        message:
          state.status === "missing"
            ? `Smarter help for this language needs ${state.label}. Install it with: ${state.detail ?? ""}`
            : `${state.label} stopped: ${state.detail ?? "no reason given"}`,
      });
    }

    return rows;
  }

  function republish(): void {
    deps.publish([...[...byFile.values()].flat(), ...missingServerRows()]);
  }

  window.adcode.language.onDiagnostics((file, diagnostics) => {
    const relative = workspaceRelative(deps.workspaceRoot(), file);
    if (relative === null) return;

    if (diagnostics.length === 0) byFile.delete(relative);
    else byFile.set(relative, diagnostics.map((item) => ({ ...item, file: relative })));

    republish();
  });

  window.adcode.language.onState((states) => {
    serverStates = states;
    for (const listener of stateListeners) listener(states);
    republish();
  });

  /* ── Document synchronisation ───────────────────────────────────────── */

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function track(model: monaco.editor.ITextModel): void {
    const relative = relativeFor(model);
    if (relative === null) return;

    const languageId = model.getLanguageId();
    const path = model.uri.fsPath;

    const forLanguage = openByLanguage.get(languageId) ?? new Set<string>();
    forLanguage.add(relative);
    openByLanguage.set(languageId, forLanguage);

    window.adcode.language.opened(path, languageId, model.getValue());
    republish();

    model.onDidChangeContent(() => {
      const existing = timers.get(path);
      if (existing !== undefined) clearTimeout(existing);

      timers.set(
        path,
        setTimeout(() => {
          timers.delete(path);
          window.adcode.language.changed(path, model.getLanguageId(), model.getValue());
        }, SYNC_DEBOUNCE_MS),
      );
    });

    model.onWillDispose(() => {
      const timer = timers.get(path);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(path);
      }

      openByLanguage.get(languageId)?.delete(relative);
      byFile.delete(relative);

      window.adcode.language.closed(path, languageId);
      republish();
    });
  }

  monaco.editor.onDidCreateModel((model) => track(model));
  for (const model of monaco.editor.getModels()) track(model);

  /* ── Completions and hover ──────────────────────────────────────────── */

  /*
   * Registered for every language rather than only the ones with a bundled server: a user
   * can add their own in settings at any moment, and a provider registered at boot for a
   * fixed list would not cover it until the next restart. `completionAt` returns nothing
   * when no server is running, which costs one IPC round trip on a language that has none.
   */
  monaco.languages.registerCompletionItemProvider("*", {
    async provideCompletionItems(model, position) {
      const path = model.uri.fsPath;
      if (workspaceRelative(deps.workspaceRoot(), path) === null) return { suggestions: [] };

      const items = await window.adcode.language.completion(
        path,
        model.getLanguageId(),
        position.lineNumber,
        position.column,
      );

      if (items.length === 0) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      return { suggestions: items.map((item) => toMonacoSuggestion(item, range)) };
    },
  });

  monaco.languages.registerHoverProvider("*", {
    async provideHover(model, position) {
      const path = model.uri.fsPath;
      if (workspaceRelative(deps.workspaceRoot(), path) === null) return null;

      const text = await window.adcode.language.hover(
        path,
        model.getLanguageId(),
        position.lineNumber,
        position.column,
      );

      return text === null ? null : { contents: [{ value: text }] };
    },
  });

  void window.adcode.language.states().then((states) => {
    serverStates = states;
    republish();
  });

  return {
    states: () => serverStates,
    onStateChange(listener) {
      stateListeners.push(listener);
      listener(serverStates);
    },
  };
}

function toMonacoSuggestion(
  item: LanguageCompletion,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  const suggestion: monaco.languages.CompletionItem = {
    label: item.label,
    kind: (item.kind === null ? undefined : COMPLETION_KIND[item.kind]) ??
      monaco.languages.CompletionItemKind.Text,
    insertText: item.insertText,
    range,
    // Only when the server said so. Marking literal text as a snippet is how a completion
    // containing `$` or `}` silently loses characters on the way in.
    ...(item.isSnippet
      ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
      : {}),
    ...(item.detail === null ? {} : { detail: item.detail }),
    ...(item.documentation === null ? {} : { documentation: item.documentation }),
    ...(item.sortText === null ? {} : { sortText: item.sortText }),
  };

  return suggestion;
}

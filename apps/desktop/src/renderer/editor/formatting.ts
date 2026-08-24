/**
 * Formatting: the language server first, the built-in formatter otherwise.
 *
 * One Monaco provider rather than two. Registering the fallback as its own provider and
 * hoping Monaco picks the right one would be a coin toss - Monaco does not rank providers
 * by how much they know - so the choice is made here, explicitly, in an order that is easy
 * to state: **if a server answers with edits, they win.**
 *
 * The distinction that makes this correct is between "no edits" and "no answer":
 *
 * - `null` from the bridge means no server answered - none is running, it does not support
 *   formatting, or it timed out. Fall back.
 * - `[]` means a server *did* format the file and found nothing to change. Falling back
 *   there would overrule a server that had already given its opinion.
 *
 * Registering the provider is also what makes `Format Document` in the Edit menu and
 * Shift+Alt+F work, since both run Monaco's own `editor.action.formatDocument`.
 */
import type * as monaco from "monaco-editor";
import { DEFAULT_OPTIONS, format, formatSupported } from "@adcode/format";
import type { LanguageTextEdit } from "../../shared/api.ts";

export interface Formatting {
  /** `adcode.formatting.formatter`. Off means the command does nothing at all. */
  setEnabled(enabled: boolean): void;
  /**
   * Format a document directly, for format-on-save.
   *
   * Save cannot go through Monaco's action: that is fire-and-forget, and the save would
   * race the edits it is meant to be waiting for. This resolves once the buffer is settled.
   */
  formatModel(model: monaco.editor.ITextModel): Promise<boolean>;
  dispose(): void;
}

export interface FormattingDeps {
  /**
   * Ask the language server. `null` means nothing answered.
   *
   * Passed in rather than reaching for `window.adcode` so this file can be reasoned about
   * without the bridge, and so the fallback path is the easy one to exercise.
   */
  readonly lspFormatting: (
    path: string,
    languageId: string,
    options: { tabSize: number; insertSpaces: boolean },
  ) => Promise<LanguageTextEdit[] | null>;
  /** Dismiss the suggestion list before the buffer is rewritten underneath it. */
  readonly hideSuggestions: () => void;
}

/** A file URI back to the path the main process understands. */
const pathOf = (model: monaco.editor.ITextModel): string | null =>
  model.uri.scheme === "file" ? model.uri.fsPath : null;

export function installFormatting(
  monacoApi: typeof monaco,
  deps: FormattingDeps,
): Formatting {
  let enabled = true;

  async function editsFor(
    model: monaco.editor.ITextModel,
  ): Promise<monaco.languages.TextEdit[]> {
    if (!enabled) return [];

    const languageId = model.getLanguageId();
    const path = pathOf(model);
    const { tabSize, insertSpaces } = model.getOptions();

    if (path !== null) {
      let fromServer: LanguageTextEdit[] | null = null;
      try {
        fromServer = await deps.lspFormatting(path, languageId, { tabSize, insertSpaces });
      } catch {
        // A bridge failure is a reason to fall back, never a reason to fail the save.
        fromServer = null;
      }

      if (fromServer !== null) {
        return fromServer.map((edit) => ({
          range: new monacoApi.Range(
            edit.startLine,
            edit.startColumn,
            edit.endLine,
            edit.endColumn,
          ),
          text: edit.text,
        }));
      }
    }

    if (!formatSupported(languageId)) return [];

    const original = model.getValue();
    const formatted = format(original, languageId, {
      ...DEFAULT_OPTIONS,
      indentWidth: tabSize,
      useTabs: !insertSpaces,
      // The file keeps the line endings it already has. Rewriting every line of a file
      // because the formatter has an opinion about CRLF is not formatting, it is a diff.
      lineEnding: model.getEOL() === "\r\n" ? "\r\n" : "\n",
    });

    if (formatted === original) return [];

    // One edit covering the document. The printers return whole files, and Monaco's undo
    // stack is better served by a single entry than by a reconstructed minimal diff.
    return [{ range: model.getFullModelRange(), text: formatted }];
  }

  const provider: monaco.languages.DocumentFormattingEditProvider = {
    displayName: "ADCode",
    provideDocumentFormattingEdits: (model) => editsFor(model),
  };

  const registrations = monacoApi.languages
    .getLanguages()
    .map((language) =>
      monacoApi.languages.registerDocumentFormattingEditProvider(language.id, provider),
    );

  return {
    setEnabled(next) {
      enabled = next;
    },

    async formatModel(model) {
      const edits = await editsFor(model);
      if (edits.length === 0) return false;

      /*
       * Close the suggest widget first.
       *
       * Format-on-save fires while the user is mid-type, which is exactly when the
       * suggestion list is open. Rewriting the buffer underneath it leaves Monaco's suggest
       * model asking `getWordAtPosition` about text that no longer exists, and it throws
       * "Token length and text length do not match!" from inside its own tokenizer.
       *
       * The widget was going to close on the next keystroke anyway; closing it deliberately
       * is the difference between that and an uncaught error on every save.
       */
      deps.hideSuggestions();

      /*
       * Pushed as an undo-stop-free edit operation so one Ctrl+Z undoes the formatting and
       * leaves the file saved-but-unformatted, rather than stepping back through it.
       */
      model.pushEditOperations(
        [],
        edits.map((edit) => ({ range: edit.range, text: edit.text })),
        () => null,
      );
      return true;
    },

    dispose() {
      for (const registration of registrations) registration.dispose();
    },
  };
}
